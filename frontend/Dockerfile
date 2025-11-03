# Multi-stage build for ChatApp frontend (Vite + React)

FROM node:20-alpine AS builder
WORKDIR /workspace

# Copy workspace manifests (root + frontend)
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY frontend/package.json ./frontend/package.json

# Install deps for frontend workspace
RUN npm ci -w frontend

# Copy sources and build
COPY frontend ./frontend
WORKDIR /workspace/frontend
RUN npm run build

FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html

# Basic SPA nginx config with index fallback
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Static assets
COPY --from=builder /workspace/frontend/dist ./

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
