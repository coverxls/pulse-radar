# 构建前后端，需要仓库根目录作为构建上下文：
#   docker build -f server/Dockerfile -t pulse-radar-api .
FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先拷依赖清单，命中缓存时跳过重复安装
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json

RUN pnpm install --frozen-lockfile --filter @pulseradar/server...

COPY server ./server

RUN pnpm --filter @pulseradar/server db:generate \
 && pnpm --filter @pulseradar/server build

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/pulse.db
ENV PORT=3001
EXPOSE 3001
VOLUME ["/data"]

WORKDIR /app/server
# 启动前同步表结构（个人项目用 db push；正式项目应改为 migrate deploy）
CMD ["sh", "-c", "pnpm exec prisma db push --skip-generate && node dist/index.js"]
