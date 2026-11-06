# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
# Build-Werkzeuge für better-sqlite3, falls kein Prebuild für die Plattform existiert
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build \
 && pnpm --filter @ultimate-dash/server deploy --prod --legacy /out \
 && cp -r apps/server/dist apps/server/drizzle /out/ \
 && cp -r apps/web/build /out/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_ROOT=/app/web
WORKDIR /app
COPY --from=build /out ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN mkdir -p /data && chown node:node /data
# Kein „USER node“: das Entrypoint-Skript korrigiert die Rechte am Datenordner
# und wechselt danach selbst zum Benutzer node.
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
