import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { IsString, Matches } from 'class-validator';
import { InvalidPhoneError, normalizeCmPhone } from '@ardoise/pay-core';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma/prisma.service';

// ---------- Envoi de SMS ----------

export abstract class SmsSender {
  abstract send(phone: string, text: string): Promise<void>;
}

/** Dev / tests : le SMS est écrit dans les logs et gardé en mémoire. */
@Injectable()
export class ConsoleSmsSender extends SmsSender {
  private readonly log = new Logger('SMS');
  readonly outbox: Array<{ phone: string; text: string }> = [];
  /** quiet : en production le contenu (le code) n'est jamais écrit dans les logs. */
  constructor(private readonly quiet = false) {
    super();
  }
  async send(phone: string, text: string) {
    this.outbox.push({ phone, text });
    this.log.log(this.quiet ? `SMS non envoyé à ${phone} (aucun fournisseur SMS configuré)` : `→ ${phone} : ${text}`);
  }
}

/**
 * Africa's Talking (https://developers.africastalking.com) : POST /version1/messaging.
 * À valider avec un premier envoi réel sur un compte de test avant la mise en production.
 */
export class AfricasTalkingSmsSender extends SmsSender {
  constructor(
    private readonly cfg: AppConfig['africasTalking'],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }
  async send(phone: string, text: string) {
    const body = new URLSearchParams({ username: this.cfg.username, to: phone, message: text });
    if (this.cfg.senderId) body.set('from', this.cfg.senderId);
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/version1/messaging`, {
      method: 'POST',
      headers: {
        apiKey: this.cfg.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) throw new Error(`Africa's Talking HTTP ${res.status}`);
    const json = (await res.json()) as {
      SMSMessageData?: { Recipients?: Array<{ statusCode?: number; status?: string }> };
    };
    const r = json.SMSMessageData?.Recipients?.[0];
    // 100 = traité, 101 = envoyé, 102 = en file d'attente
    if (!r || ![100, 101, 102].includes(Number(r.statusCode))) {
      throw new Error(`Africa's Talking : envoi refusé (${r?.status ?? 'réponse vide'})`);
    }
  }
}

export function smsSenderFor(cfg: AppConfig): SmsSender {
  if (cfg.smsProvider === 'africastalking') return new AfricasTalkingSmsSender(cfg.africasTalking);
  return new ConsoleSmsSender(process.env.NODE_ENV === 'production');
}

// ---------- OTP ----------

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function toPhone(input: string): string {
  try {
    return normalizeCmPhone(input);
  } catch (e) {
    if (e instanceof InvalidPhoneError) throw new BadRequestException('Numéro de téléphone camerounais invalide');
    throw e;
  }
}

class RequestOtpDto {
  @IsString() phone: string;
}

class VerifyOtpDto {
  @IsString() phone: string;
  @Matches(/^\d{6}$/, { message: 'Le code doit contenir 6 chiffres' }) code: string;
}

export interface AuthPayload {
  sub: string; // merchantId
  phone: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: SmsSender,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async requestOtp(rawPhone: string) {
    const phone = toPhone(rawPhone);
    const last = await this.prisma.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new BadRequestException('Patientez une minute avant de redemander un code');
    }
    // Numéro de test : code fixe défini par l'exploitant, aucun SMS envoyé.
    const fixed = this.cfg.otpTestNumbers[phone];
    const code = fixed ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challenge = await this.prisma.otpChallenge.create({
      data: { phone, codeHash: sha256(`${phone}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    if (!fixed) {
      try {
        await this.sms.send(phone, `L'Ardoise : votre code est ${code}. Il expire dans 5 minutes.`);
      } catch (e) {
        // On libère le délai d'attente : l'utilisateur peut réessayer tout de suite.
        await this.prisma.otpChallenge.delete({ where: { id: challenge.id } });
        Logger.error(`Envoi du SMS impossible : ${(e as Error).message}`, 'SMS');
        throw new ServiceUnavailableException('Impossible d’envoyer le SMS pour le moment. Réessayez dans un instant.');
      }
    }
    return { phone, expiresInSeconds: OTP_TTL_MS / 1000, ...(this.cfg.otpDevEcho ? { devCode: code } : {}) };
  }

  async verifyOtp(rawPhone: string, code: string) {
    const phone = toPhone(rawPhone);
    const ch = await this.prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!ch || ch.attempts >= OTP_MAX_ATTEMPTS) throw new UnauthorizedException('Code expiré : demandez-en un nouveau');
    const ok = timingSafeEqual(Buffer.from(ch.codeHash, 'hex'), Buffer.from(sha256(`${phone}:${code}`), 'hex'));
    if (!ok) {
      await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('Code incorrect');
    }
    await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { consumedAt: new Date() } });
    const merchant = await this.prisma.merchant.upsert({ where: { phone }, create: { phone }, update: {} });
    const token = await this.jwt.signAsync({ sub: merchant.id, phone } satisfies AuthPayload);
    return { token, merchant };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  @HttpCode(200)
  request(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }
}

// ---------- Garde JWT ----------

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      req.auth = await this.jwt.verifyAsync<AuthPayload>(header.slice(7));
      return true;
    } catch {
      throw new UnauthorizedException('Session expirée');
    }
  }
}

/** Identifiant de la boutique connectée. */
export const MerchantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().auth.sub;
});

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({ secret: cfg.jwtSecret, signOptions: { expiresIn: '30d' } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtGuard, { provide: SmsSender, inject: [APP_CONFIG], useFactory: smsSenderFor }],
  exports: [JwtGuard, JwtModule, SmsSender],
})
export class AuthModule {}
