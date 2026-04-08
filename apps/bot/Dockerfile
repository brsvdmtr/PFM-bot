FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pfm/shared build
RUN pnpm --filter @pfm/bot build

ENV NODE_ENV=production

CMD ["node", "apps/bot/dist/index.js"]
