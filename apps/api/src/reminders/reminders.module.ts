import { Body, Controller, Get, HttpCode, Inject, Injectable, Logger, Module, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AuthModule, JwtGuard, MerchantId } from '../auth/auth';
import { APP_CONFIG, AppConfig } from '../config';
import { hashToken } from '../payments/payments.service';
import { PaymentsModule } from '../payments/payments.module';
import { ConsoleWhatsAppSender, ReminderMessenger, WhatsAppSender } from './messaging';
import { ReminderAction, RemindersService } from './reminders.service';
import { TEMPLATE_MAX_LENGTH, WINDOW_END_HOUR, WINDOW_START_HOUR } from './rules';

class SettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(WINDOW_START_HOUR) @Max(WINDOW_END_HOUR - 1) sendHour?: number;
  /** null : revenir au message par défaut. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(TEMPLATE_MAX_LENGTH) template?: string | null;
  @IsOptional() @IsIn(['WHATSAPP', 'SMS']) channel?: 'WHATSAPP' | 'SMS';
}

class ActionDto {
  @IsIn(['postpone', 'skip', 'send_now', 'set_channel']) action: ReminderAction;
  @IsOptional() @IsIn(['WHATSAPP', 'SMS']) channel?: 'WHATSAPP' | 'SMS';
}

@UseGuards(JwtGuard)
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  /** Écran « Relances » : programmées, envoyées, payées après relance, réglages. */
  @Get()
  overview(@MerchantId() merchantId: string) {
    return this.reminders.overview(merchantId);
  }

  @Patch('settings')
  settings(@MerchantId() merchantId: string, @Body() dto: SettingsDto) {
    return this.reminders.updateSettings(merchantId, dto);
  }

  /** « Modifier » une relance programmée : reporter, ignorer, changer de canal, envoyer maintenant. */
  @Patch(':id')
  act(@MerchantId() merchantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActionDto) {
    return this.reminders.act(merchantId, id, dto.action, dto.channel);
  }
}

@Controller('public/links')
export class PublicOptOutController {
  constructor(private readonly reminders: RemindersService) {}

  @Post(':token/opt-out')
  @HttpCode(200)
  optOut(@Param('token') token: string) {
    return this.reminders.optOut(hashToken(token));
  }
}

@Injectable()
export class RemindersJob {
  private readonly log = new Logger('RemindersJob');
  private running = false;
  constructor(
    private readonly reminders: RemindersService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Interval(5 * 60_000)
  async tick() {
    if (!this.cfg.enableJobs || this.running) return;
    this.running = true;
    try {
      const r = await this.reminders.runOnce();
      if (r.sent || r.failed || r.stuck) this.log.log(`Relances : ${r.sent} envoyées, ${r.deferred} reportées, ${r.failed} en échec`);
    } catch (e) {
      this.log.error(`Relances en échec : ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [RemindersController, PublicOptOutController],
  providers: [RemindersService, ReminderMessenger, RemindersJob, { provide: WhatsAppSender, useClass: ConsoleWhatsAppSender }],
  exports: [RemindersService],
})
export class RemindersModule {}
