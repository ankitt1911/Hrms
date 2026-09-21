FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
RUN mkdir -p /app/.data/private && chown -R node:node /app/.data
USER node
EXPOSE 5000
CMD ["node", "src/server.js"]
