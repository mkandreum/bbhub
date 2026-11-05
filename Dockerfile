# BBHub: portal ligero para BlackBerry OS 6
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-slim
WORKDIR /app
# ffmpeg: notas de voz y radio a MP3 para la 9300. curl: healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data TZ=Europe/Madrid
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "src/index.js"]
