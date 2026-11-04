FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN pnpm --filter server exec playwright install --with-deps chromium
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/corepack && cp -a /root/.cache/node/corepack/. /opt/corepack/
ENV COREPACK_HOME=/opt/corepack
FROM base AS app
COPY . .
RUN pnpm build
RUN mkdir -p /app/data /app/apps/web/node_modules/.vite-temp && chown -R node:node /app/data /app/apps/web/dist /app/apps/server/dist /app/apps/web/node_modules/.vite-temp
ENV NODE_ENV=production
USER node
EXPOSE 3100
CMD ["node", "apps/server/dist/apps/server/src/index.js"]
