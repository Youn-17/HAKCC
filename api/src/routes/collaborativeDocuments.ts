import { Router, Request } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureSpaceAccess, isCourseStaff } from '../services/accessControl';
import { fetchExperimentMode } from '../services/experimentCondition';
import { dropNoteFromKb } from '../services/kbIngest';

const router = Router();
const enabled = () => process.env.COLLAB_ENABLED === 'true';
function configuration() {
  if (!enabled()) throw new ApiError(503, '协作文档试点尚未开启');
  const url = process.env.COLLAB_INTERNAL_URL;
  const secret = process.env.COLLAB_SECRET;
  const websocketUrl = process.env.COLLAB_PUBLIC_WS_URL;
  if (!url || !secret || secret.length < 32 || !websocketUrl) throw new ApiError(503, '协作文档服务尚未配置');
  return { url: url.replace(/\/$/, ''), secret, websocketUrl };
}
async function internal(id: string, action = '', method = 'GET', body?: unknown) {
  const config = configuration();
  let response: globalThis.Response;
  try {
    response = await fetch(`${config.url}/internal/documents/${encodeURIComponent(id)}${action}`, {
      method, headers: { Authorization: `Bearer ${config.secret}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new ApiError(503, '协作文档服务暂时不可用'); }
  if (!response.ok) {
    if (response.status === 404 && /^\/snapshots\/[1-9][0-9]*$/.test(action)) {
      throw new ApiError(404, '版本不存在或已超过保留期限');
    }
    throw new ApiError(503, '协作文档服务处理失败');
  }
  return response;
}
export async function documentAccess(id: string, user: NonNullable<Request['user']>) {
  configuration();
  const { data: note, error } = await supabase.from('notes')
    .select('id, space_id, author_id, title, metadata').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new ApiError(500, '读取协作文档失败');
  if (!note || note.metadata?.collaborative_document?.version !== 1) throw new ApiError(404, '协作文档不存在');
  const access = await ensureSpaceAccess(note.space_id, user);
  // Shared-space writing follows the same experiment restriction as Note creation.
  const blocked = !access.group_id && !isCourseStaff(access.standing) && await fetchExperimentMode(access.course_id);
  return { note, canEdit: !blocked };
}
router.get('/collaborative-documents/:id/access', verifyJWT, async (req, res) => {
  const { note, canEdit } = await documentAccess(String(req.params.id), req.user!);
  res.json({ documentId: note.id, title: note.title, canEdit,
    user: { id: req.user!.id, name: req.user!.name || '空间成员', color: '#2563eb' } });
});
router.get('/collaborative-documents/:id/session', verifyJWT, async (req, res) => {
  const { note, canEdit } = await documentAccess(String(req.params.id), req.user!);
  res.json({ documentId: note.id, title: note.title, websocketUrl: configuration().websocketUrl, canEdit,
    user: { id: req.user!.id, name: req.user!.name || '空间成员', color: '#2563eb' } });
});
router.post('/spaces/:spaceId/collaborative-documents', verifyJWT, async (req, res) => {
  configuration();
  const spaceId = String(req.params.spaceId);
  const access = await ensureSpaceAccess(spaceId, req.user!);
  if (!access.group_id && !isCourseStaff(access.standing) && await fetchExperimentMode(access.course_id)) {
    throw new ApiError(403, '实验模式下请在自己的小组空间创建协作文档');
  }
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (!title || title.length > 200) throw new ApiError(400, '标题须为 1–200 字');
  const viewId = typeof req.body.viewId === 'string' ? req.body.viewId : 'view-welcome';
  if (viewId !== 'view-welcome') {
    const { data: view, error } = await supabase.from('views').select('id').eq('id', viewId).eq('space_id', spaceId).maybeSingle();
    if (error || !view) throw new ApiError(404, '当前视图不属于这个空间');
  }
  const coordinate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(-100000, Math.min(100000, value)) : 0;
  const { data: note, error } = await supabase.from('notes').insert({
    space_id: spaceId, author_id: req.user!.id, type: 'attachment', title,
    summary: '协作文档 · 双击进入多人编辑', x: coordinate(req.body.x),
    y: coordinate(req.body.y), views: [viewId], tags: [], cited_note_ids: [],
    metadata: { collaborative_document: { version: 1 } },
  }).select('*, users!author_id(id,name,email,avatar)').single();
  if (error || !note) throw new ApiError(500, '创建文档卡片失败');
  try { await internal(note.id, '', 'POST', { title }); }
  catch (error) {
    // Compensate only this newly created card; retries create a fresh document.
    const { error: cleanupError } = await supabase.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', note.id);
    if (cleanupError) console.error('[Collaboration] provisioning compensation failed for', note.id);
    else await dropNoteFromKb(note.id).catch(() => console.error('[Collaboration] compensation KB cleanup failed for', note.id));
    throw error;
  }
  await supabase.from('note_metrics_realtime').insert({ note_id: note.id });
  await supabase.from('events').insert({ actor_id: req.user!.id, actor_role: req.user!.role,
    event_type: 'note_created', object_type: 'note', object_id: note.id, space_id: spaceId,
    metadata_json: { type: 'attachment', collaborative_document: true } });
  res.status(201).json(note);
});
router.get('/collaborative-documents/:id/export', verifyJWT, async (req, res) => {
  await documentAccess(String(req.params.id), req.user!);
  const response = await internal(String(req.params.id), '/export');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', 'attachment; filename="document.docx"');
  res.send(Buffer.from(await response.arrayBuffer()));
});
router.get('/collaborative-documents/:id/snapshots', verifyJWT, async (req, res) => {
  await documentAccess(String(req.params.id), req.user!);
  res.json(await (await internal(String(req.params.id), '/snapshots')).json());
});
router.get('/collaborative-documents/:id/snapshots/:snapshotId', verifyJWT, async (req, res) => {
  await documentAccess(String(req.params.id), req.user!);
  const id = String(req.params.snapshotId);
  if (!/^[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new ApiError(400, '无效的版本标识');
  res.json(await (await internal(String(req.params.id), `/snapshots/${id}`)).json());
});
router.post('/collaborative-documents/:id/snapshots', verifyJWT, async (req, res) => {
  const access = await documentAccess(String(req.params.id), req.user!);
  if (!access.canEdit) throw new ApiError(403, '文档为只读');
  res.status(201).json(await (await internal(String(req.params.id), '/snapshots', 'POST')).json());
});
export default router;
