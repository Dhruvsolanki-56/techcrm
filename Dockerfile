# syntax=docker/dockerfile:1
# Multi-stage build: compile the React app and the API, then ship only what is needed to run.

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY packages packages
COPY server server
COPY web web
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY web/package.json web/
# production dependencies of the server only (better-sqlite3 compiles here)
RUN npm ci --omit=dev --workspace server --include-workspace-root=false

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 CRM_DATA_DIR=/data TRUST_PROXY=1 WEB_DIST=/app/web/dist
WORKDIR /app
RUN addgroup -S crm && adduser -S crm -G crm && mkdir /data && chown crm:crm /data
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY package.json ./
COPY server/package.json server/
USER crm
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/dist/main.js"]
