# 构建前端静态产物，再用 nginx 托管并反向代理 API
#   docker build -f client/Dockerfile -t pulse-radar-web .
FROM node:20-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json

RUN pnpm install --frozen-lockfile --filter @pulseradar/web...

COPY client ./client

RUN pnpm --filter @pulseradar/web build

FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html

EXPOSE 80
