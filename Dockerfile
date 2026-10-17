FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p logs uploads
EXPOSE 3000
CMD ["sh", "-c", "node scripts/docker-init.js && node app.js"]
