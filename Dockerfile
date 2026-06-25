FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./

RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build

RUN npm prune --production

# ============================================
# Production (Production stage)
# ============================================
FROM --platform=linux/amd64 node:20-alpine AS production

RUN apk add --no-cache dumb-init

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nestjs:nodejs /app/proto ./proto

RUN mkdir -p logs && chown nestjs:nodejs logs

USER nestjs

EXPOSE 3000
EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["dumb-init", "node", "dist/src/main"]

# ============================================
# 2. Dockerfile for Development
# ============================================
FROM --platform=$BUILDPLATFORM node:20-alpine AS dev

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
EXPOSE 50051

CMD ["npm", "run", "start:dev"]

