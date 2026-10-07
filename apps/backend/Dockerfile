# Multi-stage production build for AuraDrop Signaling Backend
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy monorepo configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/backend/ ./apps/backend/

# Install dependencies and build backend
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @auradrop/backend build

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=48280
ENV HOST=0.0.0.0

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/apps/backend/package.json ./apps/backend/
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

RUN pnpm install --prod --frozen-lockfile

EXPOSE 48280

CMD ["node", "apps/backend/dist/main.js"]
