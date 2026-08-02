FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Default dirs (overridden by volume + env on Railway)
RUN mkdir -p /data /data/uploads

ENV PORT=3000
ENV DATA_DIR=/data
ENV UPLOADS_DIR=/data/uploads

EXPOSE 3000

CMD ["node", "server.js"]
