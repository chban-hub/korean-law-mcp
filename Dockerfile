# Korean Law MCP Server - Docker 배포용

# --- Build Stage ---
# Node 22.12.0 LTS, pinned by immutable multi-architecture manifest digest.
FROM node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd AS builder

WORKDIR /app

COPY package*.json ./
# Kordoc keeps native OCR/ML helpers optional.  This server does not import
# them, so do not run transitive postinstall downloaders during image builds.
# Pure-JS annex parsing remains installed and is verified in CI.
RUN npm ci --ignore-scripts

COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json ./

RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

# --- Runtime Stage ---
FROM node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "build/index.js", "--mode", "sse", "--port", "3000"]
