FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pfm/db generate
RUN pnpm --filter @pfm/db build
RUN pnpm --filter @pfm/shared build
RUN pnpm --filter @pfm/api build

ENV NODE_ENV=production
EXPOSE 3002

CMD ["sh", "-c", "packages/db/node_modules/.bin/prisma db push --schema=packages/db/prisma/schema.prisma --accept-data-loss && node apps/api/dist/index.js"]
