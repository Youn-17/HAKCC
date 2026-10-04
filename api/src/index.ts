import { Agent, setGlobalDispatcher } from 'undici';
import app from './app';
import { sweepPendingDocuments } from './services/kbIngest';
import { purgeExpiredLoginLogs, LOGIN_LOG_RETENTION_DAYS } from './routes/loginLogs';
import { warmNoteSanitizer } from './services/noteHtml';

// 出站 HTTP 连接池。Node 自带 fetch 默认空闲 4 秒就关连接、建连超时 10 秒。
// 从香港到 DMX（www.dmxapi.cn）TCP 建连 1–4s、TLS 再 5–6s，压测里 16 路并发下
// 建连直接撞 10s 超时（ConnectTimeoutError）；Kimi 也要 2–4s。把连接养着复用，
// 一个班的请求就不必每次重新握手。同一个全局 symbol，Node 内置的 fetch 也会读到。
setGlobalDispatcher(new Agent({
  connect: { timeout: 30_000 },
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 300_000,
}));


const PORT = Number(process.env.PORT ?? 4000);

// Node 22 exits the process on an unhandled rejection. A single mishandled
// promise in one request would take the API down for every student mid-class,
// so log loudly and keep serving instead. This is a backstop, not a licence to
// leave rejections unhandled — each one logged here is a bug to fix.
process.on('unhandledRejection', (reason) => {
  console.error('[HAKCC API] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[HAKCC API] Uncaught exception:', err);
});

app.listen(PORT, () => {
  console.log(`[HAKCC API] Server running on http://localhost:${PORT}`);
  console.log(`[HAKCC API] Health: http://localhost:${PORT}/health`);

  // 笔记正文消毒跑在 worker 里。起不来的话每一次保存笔记都会失败，启动时就要在日志里看到
  warmNoteSanitizer()
    .then(() => console.log('[HAKCC API] note HTML sanitizer ready'))
    .catch(err => console.error('[HAKCC API] note HTML sanitizer failed to start — saving notes will fail:', err?.message));

  // 重启前提交给 MinerU、还没取回结果的解析任务会悬在那里，
  // 除非恰好有学生去打开那份文档。延后一点跑，别和启动抢资源。
  setTimeout(() => {
    void sweepPendingDocuments().catch(err =>
      console.error('[HAKCC API] KB sweep failed:', err?.message));
  }, 15_000);

  // 登录记录只留 180 天（隐私政策里承诺的期限）。每天清一次，启动后一分钟先清一遍。
  const purge = () => purgeExpiredLoginLogs()
    .then(n => { if (n > 0) console.log(`[HAKCC API] purged ${n} login records older than ${LOGIN_LOG_RETENTION_DAYS} days`); })
    .catch(err => console.error('[HAKCC API] login log purge failed:', err?.message));
  setTimeout(purge, 60_000);
  setInterval(purge, 24 * 60 * 60 * 1000);
});
