import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth';
import { APP_CONFIG, loadConfig } from './config';
import { LedgerService } from './ledger/ledger.service';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.service';
import { RemindersModule } from './reminders/reminders.module';
import { CustomerQueries, CustomersController } from './shop/customers';
import { EntriesController } from './shop/entries';
import { MeController } from './shop/me';
import { HealthController } from './health';
import { PayPageController } from './paypage/paypage';

@Global()
@Module({ providers: [{ provide: APP_CONFIG, useFactory: loadConfig }], exports: [APP_CONFIG] })
export class ConfigModule {}

@Module({
  imports: [ConfigModule, PrismaModule, ScheduleModule.forRoot(), AuthModule, PaymentsModule, RemindersModule],
  controllers: [HealthController, PayPageController, MeController, CustomersController, EntriesController],
  providers: [LedgerService, CustomerQueries],
})
export class AppModule {}
