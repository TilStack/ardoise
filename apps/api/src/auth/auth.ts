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
  async send(phone: string, text: string) {
    this.outbox.push({ phone, text });
    this.log.log(`→ ${phone} : ${text}`);
  }
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
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: { phone, codeHash: sha256(`${phone}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    await this.sms.send(phone, `L'Ardoise : votre code est ${code}. Il expire dans 5 minutes.`);
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
  providers: [AuthService, JwtGuard, { provide: SmsSender, useClass: ConsoleSmsSender }],
  exports: [JwtGuard, JwtModule, SmsSender],
})
export class AuthModule {}
