import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cron from 'node-cron';

import { prisma } from './db.js';
import keywordsRouter from './routes/keywords.js';
import hotspotsRouter from './routes/hotspots.js';
import settingsRouter from './routes/settings.js';
import notificationsRouter from './routes/notifications.js';
import { runHotspotCheck, getCheckState } from './jobs/hotspotChecker.js';
import { aiUsage } from './services/ai.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173';
const CHECK_CRON = process.env.CHECK_CRON ?? '*/30 * * * *';
const allowedOrigins = CLIENT_URL.split(',').map(origin => origin.trim()).filter(Boolean);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Routes
app.use('/api/keywords', keywordsRouter);
app.use('/api/hotspots', hotspotsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/notifications', notificationsRouter);

// Health check：返回进程状态 + 最近一次扫描状态 + AI 调用用量，方便容器/监控探活
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    scanner: getCheckState(),
    ai: {
      calls: aiUsage.calls,
      failures: aiUsage.failures,
      promptTokens: aiUsage.promptTokens,
      completionTokens: aiUsage.completionTokens,
      avgLatencyMs: aiUsage.calls > 0 ? Math.round(aiUsage.totalLatencyMs / aiUsage.calls) : 0
    }
  });
});

// Manual trigger for hotspot check
app.post('/api/check-hotspots', async (_req, res) => {
  try {
    await runHotspotCheck(io);
    res.json({ message: 'Hotspot check completed' });
  } catch (error) {
    console.error('Manual hotspot check failed:', error);
    res.status(500).json({ error: 'Failed to run hotspot check' });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('subscribe', (keywords: string[]) => {
    keywords.forEach(kw => socket.join(`keyword:${kw}`));
    console.log(`Socket ${socket.id} subscribed to:`, keywords);
  });

  socket.on('unsubscribe', (keywords: string[]) => {
    keywords.forEach(kw => socket.leave(`keyword:${kw}`));
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// 定时扫描：cron 表达式可通过 CHECK_CRON 配置（默认每 30 分钟）
if (!cron.validate(CHECK_CRON)) {
  console.error(`❌ 非法 CHECK_CRON 表达式："${CHECK_CRON}"，定时扫描未启动，仅支持手动触发`);
} else {
  cron.schedule(CHECK_CRON, async () => {
    console.log('🔄 Running scheduled hotspot check...');
    try {
      await runHotspotCheck(io);
      console.log('✅ Scheduled hotspot check completed');
    } catch (error) {
      console.error('❌ Scheduled hotspot check failed:', error);
    }
  });
}

export { io };

httpServer.listen(PORT, () => {
  console.log(`
  📡 PulseRadar API 已启动
  🔗 http://localhost:${PORT}
  🔌 WebSocket ready
  ⏰ 扫描计划: ${CHECK_CRON}
  🌐 允许的前端来源: ${allowedOrigins.join(', ')}
  `);
});

// Graceful shutdown：先断开 WebSocket 与数据库连接，再退出进程
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);
  io.close();
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
