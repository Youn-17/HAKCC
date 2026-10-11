import { Router, Request, Response } from 'express';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { supabase } from '../config/supabase';
import { ensureNoteAccess, getCourseStanding, isCourseStaff } from '../services/accessControl';
import { ARTIFACT_CSP, isUuid } from '../services/agentMaker';
import { artifactViewPath, verifyArtifactView } from '../services/artifactLinks';
import { importEpisodeText, recordEpisode } from '../services/studentMemory';

/**
 * 智能体做的网页（agentMaker.ts，迁移 090）：本人和本课教职能看，别人一律当作不存在。
 * 返回这一版的 HTML 和同一网页所有版本的编号。前端把 HTML 放进隔离的 iframe（sandbox="allow-scripts"，不给同源），
 * 网页里写着不能联网的内容安全策略，碰不到平台的登录和数据。
 */
const router = Router();

/** 不是本人：本课教职能看；网页导入到了笔记（ai_artifact_notes，迁移 092）的，能看到其中任一条笔记的人也能看 */
async function canViewThroughCourseOrNote(row: { course_id: string; group_id: string }, req: Request): Promise<boolean> {
  const standing = await getCourseStanding(String(row.course_id), req.user!);
  if (isCourseStaff(standing)) return true;
  const { data: links } = await supabase.from('ai_artifact_notes').select('note_id').eq('group_id', row.group_id).limit(20);
  for (const link of (links ?? []) as Array<{ note_id: string }>) {
    try {
      await ensureNoteAccess(link.note_id, req.user!);
      return true;
    } catch { /* 这条笔记看不到，试下一条 */ }
  }
  return false;
}

router.get('/artifacts/:id', verifyJWT, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  if (!isUuid(id)) throw new ApiError(400, 'invalid artifact id');
  const { data: row, error } = await supabase
    .from('ai_artifacts')
    .select('id, group_id, version, course_id, owner_id, title, html, sources, surface, model, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!row) throw new ApiError(404, 'Artifact not found');
  if (row.owner_id !== req.user!.id && !(await canViewThroughCourseOrNote(row, req))) {
    throw new ApiError(404, 'Artifact not found');
  }
  const { data: versions } = await supabase
    .from('ai_artifacts')
    .select('id, version, created_at')
    .eq('group_id', row.group_id)
    .order('version', { ascending: true });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    artifact: {
      id: row.id,
      groupId: row.group_id,
      version: row.version,
      title: row.title,
      html: row.html,
      sources: Array.isArray(row.sources) ? row.sources : [],
      model: row.model ?? null,
      createdAt: row.created_at,
      // 「在新窗口打开」：只读签名链接（artifactLinks.ts），前端拼上 API 域名
      viewPath: artifactViewPath(String(row.id)),
    },
    versions: (versions ?? []).map((v: { id: string; version: number; created_at: string }) => ({ id: v.id, version: v.version, createdAt: v.created_at })),
  });
});

/**
 * 把网页挂到一条笔记上（导入笔记时调，2026-10-11）：只有网页的主人能挂，而且得能改那条笔记（作者或本课教职），
 * 笔记和网页在同一门课。挂上以后看得到这条笔记的人都能打开这个网页（所有版本）。
 */
router.post('/artifacts/:id/attach', verifyJWT, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const noteId = String((req.body ?? {}).note_id ?? '');
  if (!isUuid(id) || !isUuid(noteId)) throw new ApiError(400, 'artifact id and note_id are required');
  const { data: row, error } = await supabase.from('ai_artifacts').select('id, group_id, course_id, owner_id').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!row || row.owner_id !== req.user!.id) throw new ApiError(404, 'Artifact not found');
  const note = await ensureNoteAccess(noteId, req.user!);
  if (note.author_id !== req.user!.id && !isCourseStaff(note.standing)) throw new ApiError(403, 'Only the author can import into this note');
  if (note.course_id !== row.course_id) throw new ApiError(400, 'The note is in another course');
  const { error: linkError } = await supabase.from('ai_artifact_notes').upsert({
    group_id: row.group_id, note_id: noteId, artifact_id: row.id, added_by: req.user!.id,
  }, { onConflict: 'group_id,note_id' });
  if (linkError) throw new ApiError(500, linkError.message);
  // 记成「关键时刻」（学生能在「AI 记得什么」里看、删；关了记忆就不记）
  void recordEpisode({
    userId: req.user!.id, courseId: String(row.course_id), type: 'imported',
    content: importEpisodeText('page', String(note.title ?? ''), (req.body ?? {}).lang !== 'en'),
    source: { note_id: noteId, artifact_id: row.id },
  });
  res.json({ ok: true });
});

/**
 * 在新标签页里打开网页：不要登录，凭签名链接看这一个网页。
 * 响应头的 CSP 带 sandbox（不给 allow-same-origin）：哪怕是顶层页面，也被关进匿名源，
 * 读不到 api 域名下的任何东西，也不能联网、提交表单、弹窗、跳转。
 */
router.get('/artifacts/:id/view', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const sendText = (status: number, text: string) => {
    res.status(status).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(text);
  };
  if (!isUuid(id)) return sendText(400, '链接不对。');
  const check = verifyArtifactView(id, req.query.exp, req.query.sig);
  if (check === 'bad') return sendText(403, '链接不对。请回到平台，在网页卡片上重新打开。');
  if (check === 'expired') return sendText(410, '链接已经过期。请回到平台，在网页卡片上重新打开。');
  const { data: row, error } = await supabase.from('ai_artifacts').select('html').eq('id', id).maybeSingle();
  if (error) return sendText(500, '网页暂时打不开，请稍后再试。');
  if (!row) return sendText(404, '这个网页已经不在了。');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', `sandbox allow-scripts; ${ARTIFACT_CSP}; frame-ancestors 'none'`);
  // no-transform：不让 Cloudflare 往页面里注入统计脚本之类的东西（反正也会被上面的策略拦下，只剩一堆报错）
  res.setHeader('Cache-Control', 'private, no-store, no-transform');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.send(String(row.html));
});

export default router;
