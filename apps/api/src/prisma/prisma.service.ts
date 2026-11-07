import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { APP_CONFIG, AppConfig } from '../config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: cfg.databaseUrl }) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** Client utilisable à l'intérieur d'une transaction interactive. */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
