# Image de production de l'API L'Ardoise (NestJS + Prisma).
# Construire depuis la racine du dépôt :  docker build -t ardoise-api .
FROM node:22-slim

# openssl : requis par Prisma pour les migrations. ca-certificates : appels HTTPS (NotchPay).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# 1) Dépendances (couche mise en cache tant que les package.json ne changent pas)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/pay-core/package.json packages/pay-core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# 2) Code et compilation (pay-core d'abord, l'API en dépend)
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @ardoise/pay-core build \
 && pnpm --filter @ardoise/api build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Applique les migrations en attente puis démarre l'API.
CMD ["sh", "-c", "pnpm --filter @ardoise/api db:deploy && pnpm --filter @ardoise/api start"]
