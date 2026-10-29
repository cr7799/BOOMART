# syntax=docker/dockerfile:1
# BOOMART - CTF runtime. Only the source needed to run the application is copied.
# Runtime flag and session secret MUST be provided when the container starts.
FROM node:24-bookworm-slim AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Isolated integration test stage, never used as the competition runtime image.
# Run: docker build --target test -t boomart-ctf:test .
#      docker run --rm boomart-ctf:test
FROM node:24-bookworm-slim AS test
WORKDIR /app
ENV NODE_ENV=test
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src/ ./src/
COPY --chown=node:node views/ ./views/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node test/ ./test/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["npm", "test"]

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/app/data/boomart.sqlite
COPY --from=production-deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src/ ./src/
COPY --chown=node:node views/ ./views/
COPY --chown=node:node public/ ./public/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/server.js"]

