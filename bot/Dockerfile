FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
CMD ["node", "dist/index.js"]
