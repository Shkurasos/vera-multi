# syntax=docker/dockerfile:1
# Мульти-стейдж: сначала собираем Web (Vite), потом кладём в образ Server.
FROM node:20-alpine AS web
WORKDIR /app/Web
COPY Web/package*.json ./
RUN npm ci
COPY Web/ ./
RUN npm run build

# Node 24: встроенный node:sqlite (зашифрованное хранилище Server/store/).
# argon2/bcrypt — N-API, ставятся prebuild-бинарниками и под glibc.
FROM node:24-bookworm-slim AS server
WORKDIR /app/Server
COPY Server/package*.json ./
RUN npm ci --omit=dev
COPY Server/ ./
# Собранный фронт кладём туда же, где server.js ищет ../Web/dist
COPY --from=web /app/Web/dist /app/Web/dist
COPY --from=web /app/Web/src/store/cases.json /app/Web/src/store/cases.json
COPY --from=web /app/Web/src/store/reactionSkins.json /app/Web/src/store/reactionSkins.json

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    UPLOADS_DIR=/data/uploads \
    DB_FILE=/data/vera.json \
    STORE_FILE=/data/vera-store.db
EXPOSE 3000
CMD ["node", "server.js"]
