# API 参考

Base URL：`http://localhost:3001`，所有接口前缀 `/api`。请求与响应均为 JSON（`DELETE` 成功返回 `204`）。

错误统一返回：

```json
{ "error": "Failed to fetch hotspots" }
```

| 状态码 | 含义 |
| --- | --- |
| 200 / 201 / 204 | 成功 / 已创建 / 无内容 |
| 400 | 参数缺失或非法 |
| 404 | 资源不存在 |
| 409 | 冲突（关键词重复） |
| 500 | 服务端异常（数据源或数据库错误） |

## 健康检查

### GET /api/health

```json
{
  "status": "ok",
  "uptimeSeconds": 132,
  "timestamp": "2026-10-28T06:01:45.310Z",
  "scanner": { "running": false, "lastRunAt": "2026-10-28T06:00:12.000Z" },
  "ai": { "calls": 24, "failures": 0, "promptTokens": 18230, "completionTokens": 4120, "avgLatencyMs": 1840 }
}
```

`scanner.running` 可用于判断是否有一轮扫描正在跑；`ai` 是进程内累计值，重启归零。

## 扫描

### POST /api/check-hotspots

手动触发一轮全量扫描（只扫激活的关键词）。若已有扫描在跑，本次会直接返回成功但实际跳过（单飞锁），需要精确状态请配合 `/api/health`。

```bash
curl -X POST http://localhost:3001/api/check-hotspots
# { "message": "Hotspot check completed" }
```

## 关键词

### GET /api/keywords

```json
[
  {
    "id": "4360f6a8-2003-422e-b702-f6f5e2fbca57",
    "text": "DeepSeek Harness",
    "category": "AI",
    "isActive": true,
    "createdAt": "2026-10-28T06:01:45.371Z",
    "updatedAt": "2026-10-28T06:01:45.371Z",
    "_count": { "hotspots": 10 }
  }
]
```

### GET /api/keywords/:id

返回关键词详情，附带最近 20 条热点。

### POST /api/keywords

```json
{ "text": "Claude Sonnet 4.6", "category": "大模型" }
```

`text` 必填、去重（重复返回 `409`），`category` 可选。

### PUT /api/keywords/:id

可改 `text` / `category` / `isActive`，只传需要修改的字段。

### PATCH /api/keywords/:id/toggle

切换启停状态，返回更新后的关键词。

### DELETE /api/keywords/:id

删除关键词；关联热点保留，`keywordId` 置空。

## 热点

### GET /api/hotspots

查询参数：

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `page` / `limit` | 默认 1 / 20 | 分页 |
| `source` | `twitter` `bing` `hackernews` `sogou` `bilibili` `weibo` | 来源过滤 |
| `importance` | `low` `medium` `high` `urgent` | 重要程度 |
| `keywordId` | 关键词 id | 按监控词过滤 |
| `isReal` | `true` / `false` | 真假过滤 |
| `timeRange` | `1h` `today` `7d` `30d` | 相对时间范围（按入库时间） |
| `timeFrom` / `timeTo` | ISO 时间 | 自定义区间（与 `timeRange` 互斥，优先 `timeRange`） |
| `sortBy` | `createdAt` `publishedAt` `relevance` `importance` `hot` | 排序字段 |
| `sortOrder` | `asc` / `desc` | 默认 `desc` |

`importance` 与 `hot` 是自定义排序，先在库内取出后在内存里排，再切片分页。

```json
{
  "data": [
    {
      "id": "2e57ee5c-...",
      "title": "DeepSeek 能替你干点啥",
      "content": "...",
      "url": "https://www.bilibili.com/video/BV1vuxu6EEKk",
      "source": "bilibili",
      "sourceId": "BV1vuxu6EEKk",
      "isReal": true,
      "relevance": 72,
      "relevanceReason": "直接介绍该工具的使用方式",
      "keywordMentioned": true,
      "importance": "medium",
      "summary": "此内容与【DeepSeek Harness】的关联：...",
      "viewCount": 66,
      "likeCount": 10,
      "commentCount": 43,
      "danmakuCount": null,
      "authorName": "不确定体验局",
      "publishedAt": "2026-10-28T00:00:00.000Z",
      "createdAt": "2026-10-28T06:01:52.631Z",
      "keyword": { "id": "4360f6a8-...", "text": "DeepSeek Harness", "category": "AI" }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 10, "totalPages": 1 }
}
```

### GET /api/hotspots/stats

```json
{ "total": 10, "today": 10, "urgent": 0, "bySource": { "bilibili": 10 } }
```

### GET /api/hotspots/:id

单条详情，附带完整 `keyword` 对象。

### POST /api/hotspots/search

即时搜索（不入库），用于「全网搜索」页签。

```json
{ "query": "MCP 协议", "sources": ["bing", "twitter"] }
```

对前 10 条结果顺带做一次 AI 分析，返回 `{ "results": [ { ...item, "analysis": {...} } ] }`。

### DELETE /api/hotspots/:id

删除单条热点。

## 通知

### GET /api/notifications

参数：`page`（默认 1）、`limit`（默认 50）、`unreadOnly`（`true` 只返回未读）。

```json
{
  "data": [{ "id": "...", "type": "hotspot", "title": "发现新热点: ...", "content": "...", "isRead": false, "hotspotId": "...", "createdAt": "..." }],
  "unreadCount": 3,
  "pagination": { "page": 1, "limit": 50, "total": 3, "totalPages": 1 }
}
```

### PATCH /api/notifications/:id/read

标记单条已读。

### PATCH /api/notifications/read-all

全部标记已读。

### DELETE /api/notifications/:id ｜ DELETE /api/notifications

删除单条 / 清空全部。

## 设置

键值对存储，前端设置页直接读写。

### GET /api/settings

```json
{ "notifyEmail": "me@example.com", "enableEmail": "true" }
```

### PUT /api/settings

```json
{ "enableEmail": "false" }
```

批量 upsert。

### GET /api/settings/:key ｜ PUT /api/settings/:key

单个键的读取与写入（`{ "value": "..." }`）。

## WebSocket

连接地址与 API 同源（`http://localhost:3001`），客户端通过 Vite 代理走 `/socket.io`。

| 方向 | 事件 | 载荷 | 说明 |
| --- | --- | --- | --- |
| C → S | `subscribe` | `string[]`（关键词文本） | 加入 `keyword:{text}` 房间 |
| C → S | `unsubscribe` | `string[]` | 退出房间 |
| S → C | `hotspot:new` | Hotspot 对象 | 命中某个关键词时推给该房间 |
| S → C | `notification` | `{ type, title, content, hotspotId, importance }` | 全局通知流 |

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');
socket.emit('subscribe', ['Claude Sonnet 4.6']);
socket.on('hotspot:new', hotspot => console.log(hotspot.title));
```
