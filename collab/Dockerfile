FROM node:22.22.3-bookworm AS build
WORKDIR /app
COPY collab/package*.json ./
RUN npm ci --omit=dev --nodedir=/usr/local && npm cache clean --force
FROM node:22.22.3-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY collab/package.json ./
COPY collab/src ./src
RUN mkdir /data && chown node:node /data
USER node
ENV COLLAB_DB_PATH=/data/documents.sqlite
EXPOSE 4310
CMD ["node", "src/server.mjs"]
