FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
COPY packages/lcyt/package.json packages/lcyt/
COPY packages/lcyt-backend/package.json packages/lcyt-backend/
RUN npm ci --workspace=packages/lcyt --workspace=packages/lcyt-backend
COPY packages/lcyt/ packages/lcyt/
COPY packages/lcyt-backend/ packages/lcyt-backend/

FROM node:20-slim
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "packages/lcyt-backend/src/index.js"]
