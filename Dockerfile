# ==========================================
# Stage 1: Budowanie frontendu (React + Vite)
# ==========================================
FROM node:22-alpine AS client-builder

WORKDIR /app/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

RUN npm run build

# ==========================================
# Stage 2: Obraz produkcyjny (Node.js + static UI)
# ==========================================
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV STATIC_DIR=/app/public

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/index.js ./index.js
COPY server/auth ./auth
COPY server/db ./db
COPY server/scripts ./scripts
COPY --from=client-builder /app/client/dist ./public

RUN chown -R node:node /app
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "index.js"]
