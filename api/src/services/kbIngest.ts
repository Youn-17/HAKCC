/**
 * 把附件笔记和课程资料送进课程知识库。
 *
 * 单独一层是因为入库要知道 course_id，而附件笔记只有 space_id。
 * 这一步在三个地方被触发：上传后（后台）、每次解析出更好的正文之后
 * （MinerU 完成时正文会从粗糙变结构化，知识库要跟着换），以及附件换了文件之后。
 */
import { supabase } from '../config/supabase';
import { ingestDocument, type IngestResult } from './knowledgeBase';
import { canExtractText } from './documentText';
import type { CachedRender, DocumentNote, DocumentTextResult, RenderCache } from './documentPipeline';

async function courseIdOfSpace(spaceId: string): Promise<string | null> {
  const { data } = await supabase.from('spaces').select('course_id').eq('id', spaceId).maybeSingle();
  return (data?.course_id as string | null) ?? null;
}

/**
 * 笔记是软删除：删除只写 notes.deleted_at，kb_documents.note_id 上的级联删除不会触发，
 * 知识库那边得自己清（删除接口调 dropNoteFromKb，入库前后各查一次）。
 */
async function noteDeleted(noteId: string): Promise<boolean> {
  const { data, error } = await supabase.from('notes').select('deleted_at').eq('id', noteId).maybeSingle();
  // 查不成就抛。当成删了、让入库返回 null 的话，换文件那一轮会把还在的附件从知识库删掉
  if (error) throw new Error(error.message);
  return !data || data.deleted_at != null;
}

export async function ingestNoteIntoKb(
  note: DocumentNote & { title?: string | null; author_id?: string | null },
  text: DocumentTextResult,
): Promise<IngestResult | null> {
  if (!text.text.trim()) return null;
  // 解析要几秒到几分钟，这期间笔记可能被删了
  if (await noteDeleted(note.id)) return null;
  const courseId = await courseIdOfSpace(note.space_id);
  if (!courseId) return null;

  const result = await ingestDocument({
    courseId,
    spaceId: note.space_id,
    noteId: note.id,
    title: note.title || note.file_name || '未命名材料',
    fileName: note.file_name,
    mimeType: note.mime_type,
    textSource: text.source,
    content: text.text,
    createdBy: note.author_id ?? null,
  });
  // 删除撞在入库途中：删除接口先清了知识库，这里又写了回去。写完再看一眼，删了就清掉
  if (await noteDeleted(note.id)) await dropNoteFromKb(note.id);
  return result;
}

/**
 * MinerU 是异步的，提交完不会有人通知我们。上传后隔一段时间回来看几次，
 * 拿到结构化 Markdown 就重新入库。
 *
 * 退避的间隔按实测定：一篇论文大约几十秒。总共约 8 分钟，够绝大多数文档；
 * 还没好的那些，等学生打开 AI 侧栏时前端会接着轮询。
 * 不做持久化任务队列 —— 为一天几十份文档养一个队列不划算，
 * 进程重启由下面的 sweep 兜底。
 */
const POLL_DELAYS_MS = [25_000, 45_000, 90_000, 180_000, 240_000];

async function loadNoteForIngest(noteId: string) {
  const { data } = await supabase
    .from('notes')
    .select('id, space_id, file_url, file_name, mime_type, title, author_id')
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle();
  return data?.file_url ? data : null;
}

async function runIngestPass(noteId: string): Promise<{ pending: boolean }> {
  const note = await loadNoteForIngest(noteId);
  if (!note) return { pending: false };
  const { resolveDocumentText } = await import('./documentPipeline');
  const text = await resolveDocumentText(note as any);
  // MinerU 还在跑就先把粗略文本入库 —— 有总比没有强，好了再覆盖
  await ingestNoteIntoKb(note as any, text);
  return { pending: text.pending };
}

/**
 * 上传后的后台入库。整条链路都吞掉异常 —— 这是后台任务，
 * 失败了学生的上传本身不该受影响。
 */
function schedulePasses(id: string, pass: (id: string) => Promise<{ pending: boolean }>): void {
  void (async () => {
    try {
      const first = await pass(id);
      if (!first.pending) return;

      for (const delay of POLL_DELAYS_MS) {
        await new Promise(resolve => setTimeout(resolve, delay));
        try {
          const again = await pass(id);
          if (!again.pending) return;
        } catch (err: any) {
          console.error('[KB] poll pass failed:', id, err?.message);
          return;
        }
      }
    } catch (err: any) {
      console.error('[KB] background ingest failed:', id, err?.message);
    }
  })();
}

/**
 * 同一条附件的解析和入库一次只跑一轮：上传后那几轮、换了文件后那一轮都排在这里。
 * 入库是先删掉旧片段、再一片一片向量化（每片等一次外部接口），两轮交错时，
 * 前一轮的片段会在后一轮删完之后才插进来，和后一轮的一起留在库里。
 * 后端是单进程，排队放在内存里就够了。
 */
const noteQueues = new Map<string, Promise<void>>();

function oneAtATime<T>(noteId: string, task: () => Promise<T>): Promise<T> {
  const run = (noteQueues.get(noteId) ?? Promise.resolve()).then(task);
  const settled = run.then(() => undefined, () => undefined);
  noteQueues.set(noteId, settled);
  void settled.then(() => {
    if (noteQueues.get(noteId) === settled) noteQueues.delete(noteId);
  });
  return run;
}

export function scheduleKbIngest(noteId: string): void {
  schedulePasses(noteId, id => oneAtATime(id, () => runIngestPass(id)));
}

// ── 换了文件的附件 ──────────────────────────────────────────────────────────
//
// 查看器里给 Markdown 附件存新版本，是把笔记指向一个新文件。缓存的正文和知识库里的片段
// 都是按旧文件算的，不跟着换的话，空间 AI 检索到的一直是上传时那一版。

/** 排着队还没开跑的那一轮。它开跑时才读笔记当前的文件，这期间再换几次都不用另排。 */
const waitingRefresh = new Map<string, Promise<void>>();

/**
 * 按附件当前的文件重算正文、重新入库。后台跑，出错只记日志：保存已经成功了，不受它拖累。
 * 返回这一轮跑完的时刻，路由不等它，测试等。
 */
export function scheduleKbRefresh(noteId: string): Promise<void> {
  const waiting = waitingRefresh.get(noteId);
  if (waiting) return waiting;
  const run = oneAtATime(noteId, async () => {
    // 从这里起再换的文件，要另排一轮才读得到
    waitingRefresh.delete(noteId);
    await runRefreshPass(noteId);
  }).catch((err: any) => {
    console.error('[KB] refresh after file change failed:', noteId, err?.message);
  });
  waitingRefresh.set(noteId, run);
  return run;
}

async function runRefreshPass(noteId: string): Promise<void> {
  const note = await loadNoteForIngest(noteId);
  if (!note) return;
  const { refreshDocumentText } = await import('./documentPipeline');
  const text = await refreshDocumentText(note as any);
  const result = await ingestNoteIntoKb(note as any, text);
  // 新版本不到 80 字或是空的，ingestDocument 什么也不写，旧版本却还在库里，AI 会照着它答
  if (result === null || result.reason === 'too_short') await dropNoteFromKb(noteId);
}

export async function dropNoteFromKb(noteId: string): Promise<void> {
  // 片段随 kb_documents 级联删除
  const { error } = await supabase.from('kb_documents').delete().eq('note_id', noteId);
  if (error) throw new Error(error.message);
}

// ── 课程资料 ────────────────────────────────────────────────────────────────
//
// 课程资料不是笔记：不属于任何知识空间，document_renders 又外键到 notes，
// 所以解析缓存存在 course_materials 自己的同名列上。解析和 MinerU 的推进
// 走的仍是 documentPipeline 里同一份逻辑，入库走同一个 ingestDocument。

const MATERIAL_RENDER_COLUMNS = 'markdown, plain_text, text_source, mineru_task_id, mineru_state, mineru_error';

export function materialRenderCache(materialId: string): RenderCache {
  return {
    async load() {
      const { data } = await supabase
        .from('course_materials')
        .select(MATERIAL_RENDER_COLUMNS)
        .eq('id', materialId)
        .maybeSingle();
      return (data as CachedRender | null) ?? null;
    },
    async save(patch) {
      const { error } = await supabase
        .from('course_materials')
        .update({ ...patch, text_updated_at: new Date().toISOString() })
        .eq('id', materialId);
      if (error) console.error('[KB] material cache write failed:', materialId, error.message);
    },
  };
}

async function runMaterialIngestPass(materialId: string): Promise<{ pending: boolean }> {
  const { data: material } = await supabase
    .from('course_materials')
    .select('id, course_id, title, file_url, file_name, mime_type, uploaded_by')
    .eq('id', materialId)
    .maybeSingle();
  if (!material?.file_url) return { pending: false };

  const { resolveDocumentTextWith } = await import('./documentPipeline');
  const text = await resolveDocumentTextWith(material as any, materialRenderCache(materialId));
  if (text.text.trim()) {
    await ingestDocument({
      courseId: material.course_id as string,
      materialId: material.id as string,
      title: (material.title as string) || (material.file_name as string) || '未命名材料',
      fileName: material.file_name as string | null,
      mimeType: material.mime_type as string | null,
      textSource: text.source,
      content: text.text,
      createdBy: (material.uploaded_by as string | null) ?? null,
    });
  }
  return { pending: text.pending };
}

export function scheduleMaterialKbIngest(materialId: string): void {
  schedulePasses(materialId, runMaterialIngestPass);
}

/**
 * 教师在资料列表上看到的「这份资料去了哪」。
 *
 * 只说实际发生了什么：入库了但这门课没有能生成向量的服务，AI 就检索不到它，
 * 这种情况不能笼统地写成「已进入知识库」。
 */
export type MaterialKbState =
  | 'unsupported'   // 格式不在解析范围内（图片、音视频、PPT、Excel……）：只存文件
  | 'processing'    // 还在解析或入库
  | 'ready'         // 已入库，AI 能检索到
  | 'unsearchable'  // 已入库，但没有一片拿到向量，检索不到
  | 'no_text'       // 解析过了，没读出可用的正文（扫描版 PDF、空文档）
  | 'failed';       // 入库时出错

const MINERU_BUSY = new Set(['pending', 'running', 'converting']);

export function materialKbState(
  material: { mime_type: string | null; file_name: string | null; text_updated_at: string | null; mineru_state: string | null },
  doc: { status: string; chunks: number; embedded: number } | null,
): { state: MaterialKbState; refining: boolean } {
  // 本地抽的正文已经入库、MinerU 还在做结构化解析：能用，好了会自动替换
  const refining = MINERU_BUSY.has(material.mineru_state ?? '');
  if (!canExtractText(material.mime_type ?? '', material.file_name ?? '')) {
    return { state: 'unsupported', refining: false };
  }
  if (doc) {
    if (doc.status === 'failed') return { state: 'failed', refining: false };
    if (doc.status !== 'ready') return { state: 'processing', refining };
    if (doc.chunks === 0) return { state: 'no_text', refining };
    return { state: doc.embedded === 0 ? 'unsearchable' : 'ready', refining };
  }
  if (!material.text_updated_at || MINERU_BUSY.has(material.mineru_state ?? '')) {
    return { state: 'processing', refining: false };
  }
  return { state: 'no_text', refining: false };
}

/**
 * 启动时扫一遍卡在解析中的文档。
 *
 * 没有这一步，进程一重启，那些已提交但还没取回结果的 MinerU 任务就永远悬着 ——
 * 除非恰好有学生去打开那份文档。数量设上限，避免重启时打爆外部接口。
 */
export async function sweepPendingDocuments(limit = 20): Promise<number> {
  // 删掉的附件不续跑，也不能占名额：它们不再解析，会一直停在解析中，每次启动都把还在的挤出前 limit 份
  const { data } = await supabase
    .from('document_renders')
    .select('note_id, notes!inner(id)')
    .in('mineru_state', ['pending', 'running', 'converting'])
    .is('markdown', null)
    .is('notes.deleted_at', null)
    .limit(limit);

  const ids = (data ?? []).map(row => String(row.note_id));
  for (const noteId of ids) scheduleKbIngest(noteId);

  // 课程资料的解析状态存在它自己的行上。表还没建（迁移没跑）时查询报错，
  // data 为 null，这里什么也不做，不影响上面的附件。
  const { data: materials } = await supabase
    .from('course_materials')
    .select('id')
    .in('mineru_state', ['pending', 'running', 'converting'])
    .is('markdown', null)
    .limit(limit);
  const materialIds = (materials ?? []).map(row => String(row.id));
  for (const materialId of materialIds) scheduleMaterialKbIngest(materialId);

  const total = ids.length + materialIds.length;
  if (total) console.log(`[KB] sweep: 续跑 ${total} 份解析中的文档`);
  return total;
}
