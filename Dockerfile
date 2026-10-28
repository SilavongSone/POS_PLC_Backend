# syntax=docker/dockerfile:1
# Production image for the PLC POS API.
#   docker build -t plc-pos-api .
#   docker build --target migrate -t plc-pos-migrate .   # runs migrations + seed

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate && pnpm build

# One-shot job: apply migrations and (idempotent) seed, then exit.
FROM build AS migrate
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm prisma db seed"]

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
