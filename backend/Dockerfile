# Multi-stage build for ChatApp backend
# Context: set to repo root or chatapp/, this Dockerfile assumes it lives in chatapp/backend

FROM node:20-alpine AS builder
WORKDIR /workspace

# Copy manifests for root + workspaces (so npm can resolve workspaces)
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

# Install all deps (dev + prod) at root for workspaces, then build backend, then prune dev deps at root
RUN npm ci

# Build backend
COPY backend ./backend
WORKDIR /workspace/backend
RUN npm run build

# Prune dev deps at root (keep only production deps needed at runtime)
WORKDIR /workspace
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3025

# Copy runtime files and production node_modules from builder root
RUN mkdir -p ./backend
COPY --from=builder /workspace/backend/mcp.config.json ./backend/mcp.config.json
COPY --from=builder /workspace/backend/dist ./dist
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/backend/node_modules ./node_modules
COPY --from=builder /workspace/backend/package.json ./package.json

# Sanity check required runtime deps exist
RUN node -e "require.resolve('@fastify/cors')" && \
    node -e "require.resolve('better-sqlite3')"

EXPOSE 3025
CMD ["node", "dist/server.js"]
