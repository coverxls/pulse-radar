# 本地运行

## 前置条件

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20（推荐 20 LTS / 22） | 后端用了 ESM + Express 5 |
| pnpm | ≥ 10 | 仓库是 pnpm workspace，`npm install` 不会装全 |
| OpenRouter API Key | 可选 | 不填则 AI 判定降级为规则打分 |

## 1. 安装依赖

```bash
git clone https://github.com/coverxls/pulse-radar.git
cd pulse-radar
pnpm install
```

## 2. 生成 Prisma Client

```bash
pnpm db:generate
```

> **必须单独执行**。pnpm 10 默认不运行依赖的 install 脚本，`@prisma/client` 的自动生成会被跳过；如果跳过这一步，启动时会报 `@prisma/client did not initialize yet`。

## 3. 配置环境变量

```bash
cp server/.env.example server/.env
```

最少需要 `DATABASE_URL`；想用 AI 判定就填 `OPENROUTER_API_KEY`：

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 是 | — | SQLite 文件路径，如 `file:./dev.db` |
| `PORT` | 否 | `3001` | API 端口 |
| `CLIENT_URL` | 否 | `http://localhost:5173` | 允许的前端来源，多个用逗号分隔 |
| `CHECK_CRON` | 否 | `*/30 * * * *` | 定时扫描表达式，非法值会跳过定时任务并打日志 |
| `OPENROUTER_API_KEY` | 否 | — | 不填走规则降级 |
| `OPENROUTER_MODEL` | 否 | `deepseek/deepseek-v3.2` | 任意 OpenRouter 模型 id |
| `TWITTER_API_KEY` | 否 | — | twitterapi.io 的 Key，不填则跳过 Twitter |
| `SMTP_*` / `NOTIFY_EMAIL` | 否 | — | 不填则不发邮件，只走 WebSocket |

## 4. 初始化数据库

```bash
pnpm db:push      # 个人开发用：直接把 schema 同步到 SQLite
# 或
pnpm db:migrate   # 需要保留迁移历史时用
```

## 5. 启动

```bash
pnpm dev          # 同时起 API(:3001) 与 Web(:5173)
pnpm dev:server   # 只起后端
pnpm dev:web      # 只起前端
```

打开 http://localhost:5173 ，添加一个关键词（如 `Claude Sonnet`），点「手动扫描」。

首次扫描可能要 20~60 秒：六个源各自限速，叠加逐条模型判定。`curl http://localhost:3001/api/health` 可以看到 `scanner.running` 与 AI 用量。

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm test` | 服务端单测（无 Key 时跳过 AI 用例） |
| `pnpm typecheck` | 前后端类型检查 |
| `pnpm build` | 服务端 tsc + 前端 vite build |
| `pnpm lint` | 前端 ESLint |
| `pnpm db:studio` | Prisma Studio 看数据 |
| `pnpm --filter @pulseradar/server test:sources` | 逐个数据源连通性自测 |

## Docker

```bash
# 需要一个 .env（compose 会自动读取），至少填 OPENROUTER_API_KEY
docker compose up --build
```

- Web：http://localhost:8080 （nginx 托管静态产物，`/api` 与 `/socket.io` 反代到 api）
- API：http://localhost:3001
- 数据库：命名卷 `pulse-data`，容器内路径 `/data/pulse.db`

## 常见问题

**启动报 `@prisma/client did not initialize yet`**
先跑 `pnpm db:generate`。这是 pnpm 10 的默认行为，不是依赖坏了。

**端口冲突**
`PORT=3002 pnpm dev:server`，同时把 `client/vite.config.ts` 里代理目标改成 3002。

**扫描到 0 条**
按顺序排查：`/api/health` 里 `scanner.running` 是否卡在 `true`；日志里各源是否报错；关键词是否 `isActive`。B 站偶发 `412`（风控）属正常，换时间重试。

**没有 AI 也能用吗**
能。抓取、去重、入库、推送都是确定性的；AI 只影响「真假识别 + 相关性打分 + 摘要」。没 Key 时命中关键词给 50 分，刚好过阈值，会收到热点但排序质量下降。

**邮件没发出去**
只有 `high` / `urgent` 才发邮件；再确认 `SMTP_HOST/PORT/USER/PASS/NOTIFY_EMAIL` 齐全，`SMTP_SECURE` 在 465 端口时设为 `true`。
