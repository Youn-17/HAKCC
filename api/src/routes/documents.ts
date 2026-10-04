/**
 * 文档阅读页的后端：Word 转 HTML，以及文档批注。
 *
 * 转换按需进行并缓存 —— 上传时就转会把延迟加在每一次上传上，而多数文档
 * 从没被打开过。原 .docx 始终保留在存储里，这里产出的只是可读、可批注的呈现层。
 *
 * 顺带把 .docx 预览从微软的在线查看器上摘下来：那条路径会把文件地址交给
 * view.officeapps.live.com 去渲染，等于把学生作业送到第三方服务器。
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureSpaceAccess, isCourseStaff, type CourseStanding } from '../services/accessControl';
import { resolveDocumentText, type DocumentNote, type DocumentTextResult } from '../services/documentPipeline';
import { ingestNoteIntoKb } from '../services/kbIngest';
import { htmlToMarkdown } from '../services/htmlToMarkdown';
import { knowledgeBaseStats } from '../services/knowledgeBase';
import { ensureCourseInstructor } from '../services/accessControl';

const router = Router();

/** 换实现或修 bug 时改这个值，旧缓存自动失效，不必手工清表。 */
const RENDERER = 'mammoth-1';
const MAX_DOC_BYTES = 20 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 20_000;
const MAX_BODY = 5000;
const MAX_QUOTE = 1000;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function paramId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new ApiError(400, `${name} is required`);
  return value;
}

/** 附件笔记的文件信息 + 空间归属 + 调用者的课内身份，一次取齐。 */
async function loadDocumentNote(noteId: string, user: any) {
  const { data, error } = await supabase
    .from('notes')
    .select('id, space_id, file_url, file_name, mime_type, title, author_id')
    .eq('id', noteId)
    .is('deleted_at', null)
    .single();
  if (error || !data) throw new ApiError(404, 'Note not found');
  const { standing } = await ensureSpaceAccess(String(data.space_id), user);
  return { ...data, standing } as DocumentNote & {
    title: string | null;
    author_id: string | null;
    standing: CourseStanding;
  };
}

function isWord(mime: string, name: string): boolean {
  return mime === DOCX_MIME || /\.docx$/i.test(name);
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时`)), CONVERT_TIMEOUT_MS);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * 只读我们自己 bucket 里的地址。这个接口用服务端身份 fetch，
 * 放开任意 URL 就是一个现成的 SSRF 跳板。
 */
function assertOwnStorage(fileUrl: string): void {
  const { data } = supabase.storage.from('note-chat-attachments').getPublicUrl('');
  const prefix = data.publicUrl.replace(/\/$/, '');
  if (!fileUrl.startsWith(prefix)) throw new ApiError(400, '只支持读取本平台存储里的附件。');
}

// GET /api/notes/:noteId/document — Word 文档的可读、可编辑呈现（转换 + 缓存）
//
// 输出 Markdown 而不是 HTML：平台的编辑器、目录、批注都建立在 Markdown 上，
// Word 落到同一种表示，这些能力就自动共用；否则要为 Word 再养一套富文本链路。
// 原 .docx 不动，始终可下载。
router.get('/notes/:noteId/document', verifyJWT, async (req: Request, res: Response) => {
  const noteId = paramId(req.params.noteId, 'noteId');
  const note = await loadDocumentNote(noteId, req.user!);

  const mime = note.mime_type ?? '';
  const name = note.file_name ?? '';
  if (!isWord(mime, name)) throw new ApiError(400, '这个格式不需要转换。');
  if (!note.file_url) throw new ApiError(404, '附件没有文件地址。');

  const { data: cached } = await supabase
    .from('document_renders')
    .select('markdown, renderer, text_source')
    .eq('note_id', noteId)
    .maybeSingle();
  if (cached?.markdown && cached.renderer === RENDERER) {
    res.json({ markdown: cached.markdown, cached: true, edited: cached.text_source === 'edited' });
    return;
  }

  assertOwnStorage(note.file_url);
  const resp = await fetch(note.file_url);
  if (!resp.ok) throw new ApiError(404, `读取文档失败：HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > MAX_DOC_BYTES) throw new ApiError(413, '文档过大，无法在线转换。');

  let markdown: string;
  try {
    const mammoth = await import('mammoth');
    const result = await withTimeout(mammoth.convertToHtml({ buffer }), 'Word 转换');
    markdown = htmlToMarkdown(result.value ?? '');
  } catch (err: any) {
    console.error('[Documents] docx convert failed:', err?.message);
    throw new ApiError(422, '这份 Word 文档无法在线打开，可以下载后用 Word 查看。');
  }
  if (!markdown.trim()) throw new ApiError(422, '这份 Word 文档没有可显示的正文。');

  // 缓存失败不影响这次返回：下次再转一遍就是了
  const { error: cacheErr } = await supabase.from('document_renders').upsert({
    note_id: noteId,
    space_id: note.space_id,
    markdown,
    text_source: 'docx',
    source_mime: mime || DOCX_MIME,
    renderer: RENDERER,
    rendered_at: new Date().toISOString(),
    text_updated_at: new Date().toISOString(),
  });
  if (cacheErr) console.error('[Documents] cache write failed:', cacheErr.message);

  res.json({ markdown, cached: false, edited: false });
});

// PUT /api/notes/:noteId/document — 保存编辑后的 Word 文档
//
// 写在平台的呈现层，不回写 .docx：往返 .docx 会丢格式且极易损坏原件，
// 而原件是学生交上来的东西，不该被我们改。下载拿到的永远是他最初上传的那一份。
//
// 只有上传者和课程教职能改，和 .md 附件的保存（走 PUT /notes/:id）同一个口径。
// 这份正文还会重新进知识库，同空间的其他人改了，AI 答全课的问题时读到的就是他的版本。
router.put('/notes/:noteId/document', verifyJWT, async (req: Request, res: Response) => {
  const noteId = paramId(req.params.noteId, 'noteId');
  const note = await loadDocumentNote(noteId, req.user!);
  if (note.author_id !== req.user!.id && !isCourseStaff(note.standing)) {
    throw new ApiError(403, '只有上传者和课程教师可以修改这份文档。');
  }

  const markdown = String(req.body.markdown ?? '');
  if (!markdown.trim()) throw new ApiError(400, '内容不能为空。');
  if (markdown.length > 400_000) throw new ApiError(413, '内容过长。');

  const { error } = await supabase.from('document_renders').upsert({
    note_id: noteId,
    space_id: note.space_id,
    markdown,
    text_source: 'edited',
    source_mime: note.mime_type ?? null,
    renderer: RENDERER,
    rendered_at: new Date().toISOString(),
    text_updated_at: new Date().toISOString(),
  });
  if (error) throw new ApiError(500, error.message);

  // 编辑过的内容要重新进知识库，否则 AI 读到的还是旧版
  void ingestNoteIntoKb(note, { text: markdown, source: 'plain', pending: false })
    .catch(err => console.error('[Documents] KB re-ingest failed:', err?.message));

  res.json({ markdown, edited: true });
});

// ── 供 AI 阅读的正文 ────────────────────────────────────────────────────────

/**
 * GET /api/notes/:noteId/document-text — 给 AI 侧栏用的正文。
 *
 * 解析逻辑在 documentPipeline 里，上传时的后台任务走同一条 —— 两处各写一份，
 * 迟早会在一处修了 bug 而另一处没修。
 *
 * pending=true 时前端隔几秒再请求一次；结果都进缓存，之后开同一份文档直接命中。
 */
router.get('/notes/:noteId/document-text', verifyJWT, async (req: Request, res: Response) => {
  const noteId = paramId(req.params.noteId, 'noteId');
  const note = await loadDocumentNote(noteId, req.user!);

  const result = await resolveDocumentText(note);
  res.json(result);

  // 正文定下来就顺手进知识库。放在响应之后：入库慢一点无所谓，不该让学生等。
  if (!result.pending && result.text.trim().length >= 80) {
    void ingestNoteIntoKb(note, result).catch(err =>
      console.error('[Documents] KB ingest failed:', err?.message));
  }
});

// GET /api/courses/:courseId/knowledge-base — 这门课的知识库概况（教师端）
router.get('/courses/:courseId/knowledge-base', verifyJWT, async (req: Request, res: Response) => {
  const courseId = paramId(req.params.courseId, 'courseId');
  // 知识库汇集了全课程的材料，只对开课教师开放 —— 学生看自己那份文档就够了
  await ensureCourseInstructor(courseId, req.user!);
  res.json(await knowledgeBaseStats(courseId));
});

// ── 文档 AI 对话的留存 ──────────────────────────────────────────────────────

/**
 * 文档侧栏的对话原来只活在浏览器里 —— 关掉页面就没了，学生看不到自己问过什么，
 * 研究导出里也一片空白。可是「学生怎么向 AI 提问、AI 怎么答」恰恰是这项研究要看的东西。
 *
 * 复用 note_conversation_threads/messages 而不是另起一张表：文档本身就是一条附件笔记，
 * 挂在它上面天然属于这条笔记，而且研究导出已经在读这两张表，不必改导出逻辑。
 */
const DOC_CHAT_TARGET = 'ai';

async function ownDocThreads(noteId: string, userId: string, isStaff: boolean) {
  let query = supabase
    .from('note_conversation_threads')
    .select('id, title, provider_id, model, created_by, created_at, updated_at')
    .eq('note_id', noteId)
    .eq('target_type', DOC_CHAT_TARGET)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  // 普通成员只看自己的；课程教职能看全部 —— 他们本来就能从研究导出里拿到。
  // 教职按课内身份算：凭学生验证码入课的教师账号也只是成员，看不到同学和 AI 的对话。
  if (!isStaff) query = query.eq('created_by', userId);
  const { data } = await query;
  return data ?? [];
}

// GET /api/notes/:noteId/doc-chat — 这份文档下的历史对话
router.get('/notes/:noteId/doc-chat', verifyJWT, async (req: Request, res: Response) => {
  const noteId = paramId(req.params.noteId, 'noteId');
  const note = await loadDocumentNote(noteId, req.user!);
  const isStaff = isCourseStaff(note.standing);

  const threads = await ownDocThreads(noteId, req.user!.id, isStaff);
  if (threads.length === 0) { res.json({ threads: [] }); return; }

  const { data: messages } = await supabase
    .from('note_conversation_messages')
    .select('id, thread_id, sender_kind, content, created_at')
    .in('thread_id', threads.map(t => t.id))
    .order('created_at', { ascending: true });

  const byThread = new Map<string, any[]>();
  for (const m of messages ?? []) {
    const list = byThread.get(String(m.thread_id)) ?? [];
    list.push({
      id: m.id,
      role: m.sender_kind === 'assistant' ? 'assistant' : 'user',
      content: m.content,
      createdAt: m.created_at,
    });
    byThread.set(String(m.thread_id), list);
  }

  res.json({
    threads: threads.map(t => ({
      id: t.id,
      title: t.title,
      createdBy: t.created_by,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      messages: byThread.get(String(t.id)) ?? [],
    })),
    spaceId: note.space_id,
  });
});

// POST /api/notes/:noteId/doc-chat — 记一轮问答（没有 thread_id 就新开一段）
router.post('/notes/:noteId/doc-chat', verifyJWT, async (req: Request, res: Response) => {
  const noteId = paramId(req.params.noteId, 'noteId');
  const note = await loadDocumentNote(noteId, req.user!);

  const question = String(req.body.question ?? '').trim();
  const answer = String(req.body.answer ?? '').trim();
  if (!question || !answer) throw new ApiError(400, 'question 和 answer 都不能为空');

  const { data: space } = await supabase
    .from('spaces').select('course_id').eq('id', note.space_id).single();
  if (!space?.course_id) throw new ApiError(404, 'Space not found');

  let threadId = req.body.thread_id ? String(req.body.thread_id) : null;
  if (threadId) {
    // 只能往自己的会话里写 —— 否则会把别人的研究数据搅乱
    const { data: owned } = await supabase
      .from('note_conversation_threads')
      .select('id').eq('id', threadId).eq('note_id', noteId).eq('created_by', req.user!.id).maybeSingle();
    if (!owned) threadId = null;
  }

  if (!threadId) {
    const { data: created, error } = await supabase
      .from('note_conversation_threads')
      .insert({
        note_id: noteId,
        space_id: note.space_id,
        course_id: space.course_id,
        target_type: DOC_CHAT_TARGET,
        provider_id: req.body.provider_id ?? null,
        model: req.body.model ?? null,
        // 用第一个问题当标题，历史列表里一眼能认出是哪一段对话
        title: question.slice(0, 60),
        created_by: req.user!.id,
      })
      .select('id')
      .single();
    if (error || !created) throw new ApiError(500, error?.message ?? '无法创建会话');
    threadId = created.id as string;
  }

  const { error: msgErr } = await supabase.from('note_conversation_messages').insert([
    { thread_id: threadId, sender_id: req.user!.id, sender_kind: 'user', content: question },
    {
      thread_id: threadId, sender_id: null, sender_kind: 'assistant', content: answer,
      ai_metadata: { provider_id: req.body.provider_id ?? null, model: req.body.model ?? null, surface: 'document' },
    },
  ]);
  if (msgErr) throw new ApiError(500, msgErr.message);

  await supabase.from('note_conversation_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', threadId);

  res.json({ thread_id: threadId });
});

// ── 批注 ───────────────────────────────────────────────────────────────────

function annotationToApi(row: any, names: Map<string, { name: string; avatar: string | null }>) {
  const who = names.get(row.author_id);
  return {
    id: row.id,
    noteId: row.note_id,
    parentId: row.parent_id ?? null,
    authorId: row.author_id,
    authorName: who?.name ?? '',
    authorAvatar: who?.avatar ?? null,
    anchor: row.anchor ?? {},
    quote: row.quote ?? null,
    body: row.body,
    resolved: Boolean(row.resolved),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 批注要显示"谁批的"，而 doc_annotations.author_id 没有外键到 profiles
 * （和 views.creator_id、space_shapes.created_by 一致），内联查不了，单独取一次。
 */
async function loadAuthors(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, { name: string; avatar: string | null }>();
  if (unique.length === 0) return map;
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', unique);
  for (const row of data ?? []) {
    map.set(row.id as string, {
      name: (row.full_name as string) ?? '',
      avatar: (row.avatar_url as string | null) ?? null,
    });
  }
  return map;
}

// GET /api/notes/:noteId/annotations
router.get('/notes/:noteId/annotations', verifyJWT, async (req: Request, res: Response) => {
  const noteId = paramId(req.params.noteId, 'noteId');
  await loadDocumentNote(noteId, req.user!);

  const { data, error } = await supabase
    .from('doc_annotations')
    .select('*')
    .eq('note_id', noteId)
    .order('created_at', { ascending: true });
  if (error) throw new ApiError(500, error.message);

  const names = await loadAuthors((data ?? []).map((r: any) => r.author_id));
  res.json({ annotations: (data ?? []).map(row => annotationToApi(row, names)) });
});

// POST /api/notes/:noteId/annotations
router.post('/notes/:noteId/annotations', verifyJWT, async (req: Request, res: Response) => {
  const noteId = paramId(req.params.noteId, 'noteId');
  const note = await loadDocumentNote(noteId, req.user!);

  const body = String(req.body.body ?? '').trim();
  if (!body) throw new ApiError(400, '批注内容不能为空。');

  const parentId = req.body.parent_id ? String(req.body.parent_id) : null;
  if (parentId) {
    // 只允许一层回复：对回复的回复会长成没人读得完的线程
    const { data: parent } = await supabase
      .from('doc_annotations')
      .select('id, note_id, parent_id')
      .eq('id', parentId)
      .maybeSingle();
    if (!parent || parent.note_id !== noteId) throw new ApiError(404, '找不到要回复的批注。');
    if (parent.parent_id) throw new ApiError(400, '回复不能再被回复。');
  }

  const { data, error } = await supabase
    .from('doc_annotations')
    .insert({
      note_id: noteId,
      space_id: note.space_id,
      author_id: req.user!.id,
      parent_id: parentId,
      anchor: req.body.anchor ?? {},
      quote: req.body.quote ? String(req.body.quote).slice(0, MAX_QUOTE) : null,
      body: body.slice(0, MAX_BODY),
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);

  const names = await loadAuthors([data.author_id]);
  res.status(201).json({ annotation: annotationToApi(data, names) });
});

// PATCH /api/doc-annotations/:id — 改内容，或标记已解决
router.patch('/doc-annotations/:id', verifyJWT, async (req: Request, res: Response) => {
  const id = paramId(req.params.id, 'id');
  const { data: existing, error: findErr } = await supabase
    .from('doc_annotations')
    .select('id, space_id, author_id')
    .eq('id', id)
    .single();
  if (findErr || !existing) throw new ApiError(404, '批注不存在。');
  await ensureSpaceAccess(String(existing.space_id), req.user!);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (req.body.body !== undefined) {
    // 改内容只能改自己的；教师也不行 —— 改掉别人说过的话会让讨论记录失真
    if (existing.author_id !== req.user!.id) throw new ApiError(403, '只能修改自己的批注。');
    const body = String(req.body.body).trim();
    if (!body) throw new ApiError(400, '批注内容不能为空。');
    update.body = body.slice(0, MAX_BODY);
  }
  if (req.body.resolved !== undefined) {
    // 谁都可以标已解决：提出者确认解决了，被批注者改完了，教师收尾，都合理
    update.resolved = Boolean(req.body.resolved);
  }
  if (Object.keys(update).length === 1) throw new ApiError(400, 'Nothing to update');

  const { data, error } = await supabase
    .from('doc_annotations')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);

  const names = await loadAuthors([data.author_id]);
  res.json({ annotation: annotationToApi(data, names) });
});

// DELETE /api/doc-annotations/:id
router.delete('/doc-annotations/:id', verifyJWT, async (req: Request, res: Response) => {
  const id = paramId(req.params.id, 'id');
  const { data: existing, error: findErr } = await supabase
    .from('doc_annotations')
    .select('id, space_id, author_id')
    .eq('id', id)
    .single();
  if (findErr || !existing) throw new ApiError(404, '批注不存在。');
  const space = await ensureSpaceAccess(String(existing.space_id), req.user!);

  if (existing.author_id !== req.user!.id && !isCourseStaff(space.standing)) {
    throw new ApiError(403, '只能删除自己的批注。');
  }

  const { error } = await supabase.from('doc_annotations').delete().eq('id', id);
  if (error) throw new ApiError(500, error.message);
  res.json({ message: 'Annotation deleted' });
});

export default router;
