FROM node:22-bookworm-slim AS webbuild
WORKDIR /build/web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS apibuild
WORKDIR /build
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src/ ./src/
RUN ./node_modules/.bin/tsc -p tsconfig.json

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080 STORAGE_DIR=/data
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && apt-get update && apt-get install -y --no-install-recommends python3 python3-pip git ca-certificates \
 && pip3 install --break-system-packages --no-cache-dir telethon==1.42.0 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r nexdrive && useradd -r -g nexdrive nexdrive
COPY --from=apibuild /build/dist ./dist
COPY --from=webbuild /build/web/dist ./web/dist
COPY db/ ./db/
COPY plugins/ ./plugins/
RUN mkdir -p /data && chown nexdrive:nexdrive /data
USER nexdrive
EXPOSE 8080
CMD ["node","dist/server.js"]
