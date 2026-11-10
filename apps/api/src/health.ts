import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Contrôle complet : l'API ET la base répondent. À utiliser ponctuellement. */
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }

  /**
   * Contrôle léger, sans base de données : pour la surveillance régulière (UptimeRobot, contrôle
   * de santé de l'hébergeur). N'interroge pas la base, donc ne l'empêche pas de se mettre en veille.
   */
  @Get('ping')
  ping() {
    return { status: 'ok' };
  }
}
