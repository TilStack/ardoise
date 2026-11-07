import { execSync } from 'node:child_process';

export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ardoise:ardoise@localhost:5432/ardoise_test';
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
