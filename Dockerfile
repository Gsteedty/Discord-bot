FROM node:20-alpine
WORKDIR /app
COPY artifacts/api-server/dist ./dist
COPY artifacts/api-server/economy.json ./economy.json
COPY artifacts/api-server/perms.json ./perms.json
CMD ["node", "dist/index.mjs"]
