FROM node:20-alpine
RUN npm install -g pnpm@9
WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @workspace/api-server run build
CMD ["node", "artifacts/api-server/dist/index.mjs"]
