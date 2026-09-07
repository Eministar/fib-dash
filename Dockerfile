# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for FIB HR Dashboard
# Works standalone (docker run) or with docker-compose.

ARG NODE_VERSION=22

# ─────────── Stage 1: deps ───────────
FROM node:${NODE_VERSION}-alpine AS deps
RUN apk add --no-cache libc6-compat git openssh-client
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund --loglevel=error

# ─────────── Stage 2: builder ───────────
FROM node:${NODE_VERSION}-alpine AS builder
RUN apk add --no-cache libc6-compat git
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ─────────── Stage 3: runner (production) ───────────
FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache libc6-compat git openssh-client
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Standalone-Output (nicht aktiv, weil wir start.js benutzen)
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/start.js ./start.js

# Persistente Uploads und vom Setup geschriebene Konfiguration
RUN mkdir -p /app/uploads /app/config && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "start.js"]
