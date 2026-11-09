FROM oven/bun:1.4.4-slim AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run check && bun test && bun run build

FROM base AS production-dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    APP_ORIGIN=http://localhost:3000 \
    SESSION_SECRET_FILE=/data/session.key \
    CREDENTIALS_FILE=/data/credentials.enc
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun server/index.ts server/runtime.ts ./server/
COPY --chown=bun:bun package.json ./
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/healthz'); process.exit(response.ok ? 0 : 1)"]
CMD ["bun", "run", "start"]
