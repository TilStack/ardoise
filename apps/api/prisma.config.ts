import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` n'a pas besoin d'une vraie base ; migrate, si (DATABASE_URL obligatoire).
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/unset' },
});
