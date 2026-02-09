# Servicio de renderizado HTML con Puppeteer para Cloud Run.
# Escala a cero: solo pagas cuando el tracker usa headless (p. ej. Back Market).
FROM node:20-bookworm-slim

# Chromium y dependencias (sin descargar la versión de Puppeteer).
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./

EXPOSE 8080
CMD ["node", "server.mjs"]
