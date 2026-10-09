import 'express-async-errors';
import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import authRouter from './routes/auth';
import spacesRouter from './routes/spaces';
import notesRouter from './routes/notes';
import relationsRouter from './routes/relations';
import eventsRouter from './routes/events';
import metricsRouter from './routes/metrics';
import notificationsRouter from './routes/notifications';
import groupsRouter from './routes/groups';
import aiRouter from './routes/ai';
import triggersRouter from './routes/triggers';
import courseSettingsRouter from './routes/courseSettings';
import courseKnowledgeBaseRouter from './routes/courseKnowledgeBase';
import scaffoldsRouter from './routes/scaffolds';
import viewsRouter from './routes/views';
import documentsRouter from './routes/documents';
import collaborativeDocumentsRouter from './routes/collaborativeDocuments';
import courseSessionsRouter from './routes/courseSessions';
import researchRouter from './routes/research';
import feedbackRouter from './routes/feedback';
import adminRouter from './routes/admin';
import loginLogsRouter from './routes/loginLogs';
import platformFeedbackRouter from './routes/platformFeedback';
import dashboardRouter from './routes/dashboard';
import noteConversationsRouter from './routes/noteConversations';
import noteAiFeedbackRouter from './routes/noteAiFeedback';
import workspaceAgentRouter from './routes/workspaceAgent';
import personalAgentRouter from './routes/personalAgent';
import filesRouter from './routes/files';
import codingRouter from './routes/coding';
import researchAdvancedRouter from './routes/researchAdvanced';
import researchChartsRouter from './routes/researchCharts';
import lessonPlansRouter from './routes/lessonPlans';
import teacherMemoryRouter from './routes/teacherMemory';
import agentRunsRouter from './routes/agentRuns';
import turingTestRouter from './routes/turingTest';
import shapesRouter from './routes/shapes';
import riseAboveRouter from './routes/riseAbove';
import thinkingTrainerRouter from './routes/thinkingTrainer';
import codingTrainerRouter from './routes/codingTrainer';
import ctToolRouter from './routes/ctTool';
import supportRoutes from './routes/support';
import viewTopicsRouter from './routes/viewTopics';
import { errorHandler, notFound } from './middleware/errorHandler';
import { rateLimitKey, ipOnlyKey } from './middleware/rateLimitKey';

dotenv.config();

const app = express();
const frontendOrigins = process.env.FRONTEND_URL
  ? [
      ...process.env.FRONTEND_URL.split(',').map((origin) => origin.trim()).filter(Boolean),
      'capacitor://localhost',
      'ionic://localhost',
    ]
  : (() => {
      if (process.env.NODE_ENV === 'production') {
        console.warn('[SECURITY] FRONTEND_URL not set in production — CORS allows only localhost origins. Set FRONTEND_URL to your domain.');
      }
      return ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'capacitor://localhost', 'ionic://localhost'];
    })();

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const authRateLimitMax = positiveIntEnv('AUTH_RATE_LIMIT_MAX', 50);
const apiRateLimitMax = positiveIntEnv('API_RATE_LIMIT_MAX', 1200);

// Trust nginx proxy (required for express-rate-limit behind reverse proxy)
app.set('trust proxy', 1);
app.set('etag', false);

// ── Security ──────────────────────────────────────────────────
app.use(helmet());


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: authRateLimitMax,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Login/register run before authentication, so a bearer token here is
  // attacker-controlled input — bucket by IP only or brute-force protection
  // can be sidestepped with a forged token per attempt.
  keyGenerator: ipOnlyKey,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: apiRateLimitMax,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

app.use(cors({
  origin: frontendOrigins,
  credentials: true,
  // 跨域下浏览器默认只让 JS 读六个标准响应头，自定义的得显式暴露。
  // Server-Timing 是笔记列表的分段耗时，X-Speech-* 是语音合成用了哪个模型、
  // 计了多少字符——不暴露的话前端读到的全是 null。
  exposedHeaders: ['Server-Timing', 'X-Speech-Model', 'X-Speech-Chars'],
}));

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ── Body parsing ──────────────────────────────────────────────
// Uploads arrive as base64 data URLs, which inflate the payload by ~33%.
app.use('/api/note-conversations', express.json({ limit: '10mb' }));
app.use(/^\/api\/spaces\/[^/]+\/attachments$/, express.json({ limit: '40mb' }));
// 编辑后的 Markdown 也是 data URL，上限要和附件上传一致，否则大文档改完存不回去
app.use(/^\/api\/notes\/[^/]+\/markdown-versions$/, express.json({ limit: '40mb' }));
// 头像上限 5MB，base64 后约 6.7MB —— 6mb 的全局上限会把合法头像挡在门外。
app.use('/api/auth/me/avatar', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRouter);
app.use('/api', apiLimiter);
app.use('/api', spacesRouter);
app.use('/api', loginLogsRouter);
app.use('/api', platformFeedbackRouter);
app.use('/api', notesRouter);
app.use('/api', relationsRouter);
app.use('/api/events', eventsRouter);
app.use('/api', metricsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api', groupsRouter);
app.use('/api', courseSettingsRouter);
app.use('/api', courseKnowledgeBaseRouter);
app.use('/api', scaffoldsRouter);
app.use('/api', viewsRouter);
app.use('/api', documentsRouter);
app.use('/api', collaborativeDocumentsRouter);
app.use('/api', courseSessionsRouter);
app.use('/api', aiRouter);
app.use('/api', noteConversationsRouter);
app.use('/api', noteAiFeedbackRouter);
app.use('/api', triggersRouter);
app.use('/api', researchRouter);
app.use('/api', feedbackRouter);
app.use('/api', workspaceAgentRouter);
app.use('/api', personalAgentRouter);
app.use('/api/admin', adminRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', filesRouter);
app.use('/api', codingRouter);
app.use('/api', researchAdvancedRouter);
app.use('/api', researchChartsRouter);
app.use('/api', lessonPlansRouter);
app.use('/api', teacherMemoryRouter);
app.use('/api', agentRunsRouter);
app.use('/api', turingTestRouter);
app.use('/api', shapesRouter);
app.use('/api', riseAboveRouter);
app.use('/api', thinkingTrainerRouter);
app.use('/api', codingTrainerRouter);
app.use('/api', ctToolRouter);
app.use('/api', supportRoutes);
app.use('/api', viewTopicsRouter);

// ── Error handling ────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
