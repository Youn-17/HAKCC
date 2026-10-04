import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { logEvent } from '../services/eventService';
import { ensureCourseInstructor, isCourseMember } from '../services/accessControl';

/**
 * 登录记录。
 *
 * 每次登录都会往 events 写一条 user_login（时间、登录方式；不记 IP 和设备）。
 * 这里把它按人整理出来给三种人看：平台管理员看全站，课程创建者 / 课程管理员看本课成员，
 * 学生看自己。目的只有账号安全和教学管理，隐私政策里写明了；
 * 每次查看本身也记一条 login_log_viewed，谁看过谁的记录可追溯。
 * 记录只保留 180 天（见 purgeExpiredLoginLogs）。
 */
const router = Router();

export const LOGIN_LOG_RETENTION_DAYS = 180;
const MAX_DAYS = LOGIN_LOG_RETENTION_DAYS;

type LoginRow = { actor_id: string; created_at: string; metadata_json: Record<string, unknown> | null };

function clampDays(raw: unknown, fallback = 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_DAYS);
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function loginMethod(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return 'password';
  if (typeof meta.provider === 'string') return meta.provider;
  if (typeof meta.source === 'string') return meta.source;
  return 'password';
}

/** 按人汇总：最近一次登录、窗口内次数。一次查询拿全窗口的行再在内存里归并，行数最多几千。 */
async function summarize(userIds: string[], days: number) {
  if (userIds.length === 0) return new Map<string, { lastLoginAt: string; count: number }>();
  const out = new Map<string, { lastLoginAt: string; count: number }>();
  for (let i = 0; i < userIds.length; i += 200) {
    const chunk = userIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('events')
      .select('actor_id, created_at')
      .eq('event_type', 'user_login')
      .in('actor_id', chunk)
      .gte('created_at', sinceIso(days))
      .order('created_at', { ascending: false })
      .limit(20_000);
    if (error) throw new ApiError(500, error.message);
    for (const row of (data ?? []) as Array<{ actor_id: string; created_at: string }>) {
      const cur = out.get(row.actor_id);
      if (!cur) out.set(row.actor_id, { lastLoginAt: row.created_at, count: 1 });
      else cur.count += 1;
    }
  }
  // 窗口之外的「最后一次」：窗口内一次都没有的人，也想知道他上次是什么时候来的
  const missing = userIds.filter(id => !out.has(id));
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200);
    const { data } = await supabase
      .from('events')
      .select('actor_id, created_at')
      .eq('event_type', 'user_login')
      .in('actor_id', chunk)
      .order('created_at', { ascending: false })
      .limit(2000);
    for (const row of (data ?? []) as Array<{ actor_id: string; created_at: string }>) {
      if (!out.has(row.actor_id)) out.set(row.actor_id, { lastLoginAt: row.created_at, count: 0 });
    }
  }
  return out;
}

async function listForUser(userId: string, limit: number) {
  const { data, error } = await supabase
    .from('events')
    .select('actor_id, created_at, metadata_json')
    .eq('event_type', 'user_login')
    .eq('actor_id', userId)
    .gte('created_at', sinceIso(MAX_DAYS))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new ApiError(500, error.message);
  return ((data ?? []) as LoginRow[]).map(r => ({ at: r.created_at, method: loginMethod(r.metadata_json) }));
}

function recordView(req: Request, scope: 'platform' | 'course' | 'self', objectId: string, extra: Record<string, unknown> = {}) {
  logEvent({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'login_log_viewed',
    object_type: scope === 'course' ? 'course' : 'user',
    object_id: objectId,
    space_id: '',
    metadata_json: { scope, ...extra },
  });
}

// ── 学生本人 ──────────────────────────────────────────────────
router.get('/auth/me/logins', verifyJWT, async (req: Request, res: Response) => {
  const logins = await listForUser(req.user!.id, 50);
  res.json({ logins, retentionDays: LOGIN_LOG_RETENTION_DAYS });
});

// ── 课程创建者 / 课程管理员 ──────────────────────────────────
router.get('/courses/:courseId/login-logs', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const days = clampDays(req.query.days);

  const { data: members, error } = await supabase
    .from('course_members')
    .select('user_id')
    .eq('course_id', courseId);
  if (error) throw new ApiError(500, error.message);
  const ids = (members ?? []).map((m: any) => m.user_id as string);
  const summary = await summarize(ids, days);

  recordView(req, 'course', courseId, { days, members: ids.length });
  res.json({
    days,
    retentionDays: LOGIN_LOG_RETENTION_DAYS,
    members: ids.map(id => ({ userId: id, lastLoginAt: summary.get(id)?.lastLoginAt ?? null, count: summary.get(id)?.count ?? 0 })),
  });
});

router.get('/courses/:courseId/login-logs/:userId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const userId = String(req.params.userId);
  await ensureCourseInstructor(courseId, req.user!);
  // 只能看本课成员的；不是成员就当不存在，别让课程管理员拿课程 id 去翻别人
  const { data: course } = await supabase.from('courses').select('instructor_id').eq('id', courseId).maybeSingle();
  const inCourse = course?.instructor_id === userId || await isCourseMember(courseId, userId);
  if (!inCourse) throw new ApiError(404, 'Not a member of this course');

  const logins = await listForUser(userId, 100);
  recordView(req, 'course', courseId, { targetUserId: userId });
  res.json({ logins, retentionDays: LOGIN_LOG_RETENTION_DAYS });
});

// ── 平台管理员 ────────────────────────────────────────────────
router.get('/admin/login-logs', verifyJWT, requireRole('admin'), async (req: Request, res: Response) => {
  const days = clampDays(req.query.days);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  let query = supabase
    .from('profiles')
    .select('id, full_name, email, role, status')
    .order('full_name', { ascending: true })
    .limit(500);
  if (q) query = query.or(`full_name.ilike.%${q.replace(/[%,()]/g, '')}%,email.ilike.%${q.replace(/[%,()]/g, '')}%`);
  const { data: profiles, error } = await query;
  if (error) throw new ApiError(500, error.message);

  const ids = (profiles ?? []).map((p: any) => p.id as string);
  const summary = await summarize(ids, days);

  recordView(req, 'platform', req.user!.id, { days, users: ids.length, q: q || undefined });
  res.json({
    days,
    retentionDays: LOGIN_LOG_RETENTION_DAYS,
    users: (profiles ?? []).map((p: any) => ({
      userId: p.id,
      name: p.full_name,
      email: p.email,
      role: p.role,
      status: p.status,
      lastLoginAt: summary.get(p.id)?.lastLoginAt ?? null,
      count: summary.get(p.id)?.count ?? 0,
    })),
  });
});

router.get('/admin/login-logs/:userId', verifyJWT, requireRole('admin'), async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const logins = await listForUser(userId, 200);
  recordView(req, 'platform', userId, { targetUserId: userId });
  res.json({ logins, retentionDays: LOGIN_LOG_RETENTION_DAYS });
});

/** 每天跑一次：超过保留期的登录记录删掉。查看留痕（login_log_viewed）另算，不在这里删。 */
export async function purgeExpiredLoginLogs(): Promise<number> {
  const { data, error } = await supabase
    .from('events')
    .delete()
    .eq('event_type', 'user_login')
    .lt('created_at', sinceIso(LOGIN_LOG_RETENTION_DAYS))
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export default router;
