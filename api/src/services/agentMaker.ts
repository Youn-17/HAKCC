import { randomUUID } from 'node:crypto';
import { Script } from 'node:vm';
import { supabase } from '../config/supabase';
import { resolveCandidates, type Candidate } from './courseAi';
import { CONTINUE_PROMPT, streamProviderFinalAnswer, type AgentLoopMessage } from './agentLoop';
import { reportProviderFailure, reportProviderSuccess } from './modelRouter';
import type { ToolContext, ToolDefinition, ToolExecutionResult, ToolRegistry } from './agentTools';
import { KIT_GUIDE, injectArtifactKit, stripArtifactKit } from './artifactKit';
import { findTemplate, templateBrief } from './pageTemplates';

/**
 * 智能体「动手」的本事（2026-10-11 用户：智能体要能规划，能问学生选什么方案，能做出一个可以打开看的 HTML）。
 * 笔记 AI 助手和知识空间智能体共用四个工具：
 *   update_plan      列计划、做完一步勾一步（界面上是一份清单）
 *   ask_choice       给 2–4 个选项、停下来等学生选（这一轮到此结束，agentLoop 的 endTurn）
 *   create_artifact  把内容做成单文件网页：交给「智能体做网页」那一行的模型来写（写代码强的模型，课程设置里可改）
 *   revise_artifact  按学生的要求改已经做好的网页，存成新版本
 * 工具经 ToolContext.turn 把事件推给前端（agentPlan / agentQuestion / artifactStatus / artifact），
 * 一轮结束时路由把 turn 里的结果存进这条回答的 ai_metadata，回看历史时照样显示。
 * 网页存 ai_artifacts（迁移 090），在前端的隔离窗口里打开（sandbox、不能联网）。
 */

export const MAKER_TOOL_NAMES = ['update_plan', 'ask_choice', 'create_artifact', 'revise_artifact'] as const;

/** 带这几个工具的轮次：步数放到 8（列计划、查两三次、做网页、作答），整轮上限放到 330 秒（写网页本身限 200 秒） */
export const MAKER_MAX_ITERATIONS = 8;
export const MAKER_LOOP_TIMEOUT_MS = 330_000;

export const hasMakerTools = (toolNames: readonly string[]) =>
  toolNames.some(name => (MAKER_TOOL_NAMES as readonly string[]).includes(name));

export type PlanStatus = 'pending' | 'in_progress' | 'done';
export interface AgentPlan { steps: Array<{ title: string; status: PlanStatus }> }
export interface AgentQuestion { id: string; question: string; options: Array<{ label: string; detail?: string }>; allowOther: boolean }
export interface ArtifactSource { title: string; author?: string }
export interface AgentArtifactRef { id: string; groupId: string; title: string; version: number; kind: 'html'; bytes: number }

export interface AgentTurnState {
  emit: (event: Record<string, unknown>) => void;
  surface: 'note' | 'workspace' | 'personal';
  conversationId: string | null;
  plan: AgentPlan | null;
  question: AgentQuestion | null;
  artifacts: AgentArtifactRef[];
}

export function createTurnState(params: { emit: AgentTurnState['emit']; surface: AgentTurnState['surface']; conversationId: string | null }): AgentTurnState {
  return { ...params, plan: null, question: null, artifacts: [] };
}

/** 这一轮正常结束（没在等学生选）：还标着「进行中」的那一步算做完了 */
export function settlePlan(turn: AgentTurnState): AgentPlan | null {
  if (!turn.plan) return null;
  if (turn.question) return turn.plan;
  turn.plan = { steps: turn.plan.steps.map(s => (s.status === 'in_progress' ? { ...s, status: 'done' as const } : s)) };
  return turn.plan;
}

/** 存进 ai_metadata 的那几样（没有就不写） */
export function turnMetadata(turn: AgentTurnState): Record<string, unknown> {
  return {
    ...(turn.plan ? { plan: turn.plan } : {}),
    ...(turn.question ? { question: turn.question } : {}),
    ...(turn.artifacts.length ? { artifacts: turn.artifacts } : {}),
  };
}

// ── 提示词 ─────────────────────────────────────────────────────

export const MAKER_RULES = [
  '你还有几件「动手做事」的工具：',
  '1. 列计划（update_plan）：任务要分几步才能做完时（做网页、出题、整理对比、帮学生规划写作），先调用 update_plan 列出 3–6 步，每步一句话。之后每做完一步，在下一次调用别的工具时顺带调用 update_plan 更新状态。简单的问题直接回答，不要列计划。',
  '2. 让学生拿主意（ask_choice）：有几种做法、几种呈现方式、几种思路要学生定的时候，调用 ask_choice 给 2–4 个具体选项（每个选项一句话说清楚是什么、会得到什么），然后停下来等学生选，这一轮不再做别的事。涉及观点、结论、综合的地方，给选项和骨架，让学生自己写，不替学生下结论。学生已经说清楚的就直接做，不要为了问而问。',
  '3. 做成网页（create_artifact / revise_artifact）：学生要一个能打开看、能互动的东西（网页、概念图、对比表、时间线、自测题、小模拟、海报、学习单）时用。先用检索工具把要用的笔记和课程资料找出来，再调用 create_artifact。写网页的是另一个模型，它看不到这段对话，所以 brief 里要写全：目的、要放进去的全部内容（笔记里的原话或要点、作者）、版式、交互方式；sources 列出用到的笔记标题和作者。做好以后用一两句话告诉学生它是什么、怎么用；不要贴 HTML 代码，也不要写链接。学生要改已经做好的网页时，用 revise_artifact，带上它的 artifact_id 和具体的修改要求。',
].join('\n');

const STATUS_ZH: Record<PlanStatus, string> = { pending: '未做', in_progress: '正在做', done: '已做完' };

export interface MakerMemory {
  artifacts: AgentArtifactRef[];
  plan: AgentPlan | null;
  pendingQuestion: AgentQuestion | null;
}

/** 这段对话里之前做过的网页、上一轮的计划、上一轮还在等学生回答的问题 */
export function makerMemorySection(memory: MakerMemory): string {
  const lines: string[] = [];
  if (memory.artifacts.length) {
    lines.push('这段对话里已经做好的网页（要改就用 revise_artifact，带上 artifact_id）：');
    for (const a of memory.artifacts) lines.push(`- 《${a.title}》 artifact_id: ${a.id}（第 ${a.version} 版）`);
  }
  if (memory.plan?.steps.length) {
    lines.push('上一轮的计划（接着做，做完的用 update_plan 标成 done）：');
    memory.plan.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.title}（${STATUS_ZH[s.status]}）`));
  }
  if (memory.pendingQuestion) {
    const q = memory.pendingQuestion;
    lines.push(`上一轮你问了学生：「${q.question}」 选项：${q.options.map(o => o.label).join(' / ')}。学生这一条是在回答它，照学生的选择接着做。`);
  }
  return lines.join('\n');
}

function parseMetadataPlan(value: unknown): AgentPlan | null {
  const steps = (value as AgentPlan | null)?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return { steps: steps.filter(s => typeof s?.title === 'string').map(s => ({ title: s.title, status: (['pending', 'in_progress', 'done'] as const).includes(s.status) ? s.status : 'pending' })) };
}

function parseMetadataArtifacts(value: unknown): AgentArtifactRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is AgentArtifactRef => typeof a?.id === 'string' && typeof a?.title === 'string');
}

/** 从这段对话最近的回答里读出 MakerMemory（只读 ai_metadata） */
export async function loadMakerMemory(surface: 'note' | 'workspace', conversationId: string | null | undefined): Promise<MakerMemory> {
  const empty: MakerMemory = { artifacts: [], plan: null, pendingQuestion: null };
  if (!conversationId) return empty;
  const query = surface === 'note'
    ? supabase.from('note_conversation_messages').select('ai_metadata, created_at').eq('thread_id', conversationId).eq('sender_kind', 'assistant')
    : supabase.from('agent_messages').select('ai_metadata, created_at').eq('conversation_id', conversationId).eq('role', 'assistant');
  const { data, error } = await query.order('created_at', { ascending: false }).limit(30);
  if (error || !data) return empty;
  const byGroup = new Map<string, AgentArtifactRef>();
  let plan: AgentPlan | null = null;
  for (const row of data as Array<{ ai_metadata: Record<string, unknown> | null }>) {
    const meta = row.ai_metadata ?? {};
    for (const a of parseMetadataArtifacts(meta.artifacts)) {
      const key = a.groupId || a.id;
      const prior = byGroup.get(key);
      if (!prior || a.version > prior.version) byGroup.set(key, a);
    }
    if (!plan) plan = parseMetadataPlan(meta.plan);
  }
  const latest = (data[0] as { ai_metadata: Record<string, unknown> | null } | undefined)?.ai_metadata ?? {};
  const q = latest.question as AgentQuestion | undefined;
  return {
    artifacts: [...byGroup.values()].slice(0, 8),
    plan,
    pendingQuestion: q && typeof q.question === 'string' && Array.isArray(q.options) ? q : null,
  };
}

// ── 写网页 ─────────────────────────────────────────────────────

const BUILD_RULES = [
  '你是做网页的设计师兼前端工程师。把用户给的「制作说明」做成一个完整的单文件 HTML 网页，要精致、有质感、动效自然，像一份认真做过设计的作品，不要像模板。',
  '只输出 HTML 本身：从 <!doctype html> 开始，到 </html> 结束。不要写 markdown 代码块标记，不要写任何解释。',
  KIT_GUIDE,
  '设计要求：',
  '- 版面有层次：标题区、分块、留白充足；同类内容用卡片网格或页签组织，长内容用折叠。不要一屏堆满文字，也不要把所有东西塞进一张大表。',
  '- 动效要有，但要克制：标题区入场、内容块滚动出现（hk-reveal / data-hk-stagger）、悬停和点击反馈、切换时的过渡；数字用滚动计数，时间线、概念图连线用描线动画。不要无限循环的闪烁和弹跳。',
  '- 颜色用组件库的变量，主色深蓝，莫兰迪色做点缀；不用 emoji，不用霓虹色和花哨的渐变。',
  '- 手机和电脑都要好看：宽度自适应，手机上不出现横向滚动，可点的地方至少 44px 高。',
  '硬性要求：',
  '- 所有 CSS 和 JavaScript 都写在这个文件里。不加载任何外部资源：不引用 CDN、网络字体、外部图片，不用 fetch、XMLHttpRequest、WebSocket。要图形就用内联 SVG、CSS 或 canvas 自己画。',
  '- 网页在隔离的窗口里打开：不能用 localStorage、sessionStorage、cookie，不能用 alert、confirm、prompt，不能打开新窗口，没有表单提交。',
  '- 内容只用制作说明里给的材料，不编造事实、人名、数据。说明里给了出处的，在页面底部写「资料来源」列出来；页面底部用小字注明「由 AI 根据课程笔记生成，内容请核对」。',
  '- 学生自己该想的部分（观点、结论、反思）留出空位（hk-write、hk-blank）让学生写，不替学生写好。',
  '- 文字说人话，像老师给学生做的学习材料，不用「探索」「赋能」「一站式」这类空话。',
  '- 代码整洁，总长度尽量控制在 40KB 以内（组件库不算在内）。',
].join('\n');

const REVISE_RULES = '用户会给出这个网页现在的 HTML 和修改要求。按要求改好后输出完整的新 HTML（同样只输出 HTML）。没要求改的地方保持原样。';

export const ARTIFACT_CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

const MAX_ARTIFACT_BYTES = 500_000;
const BUILD_DEADLINE_MS = 200_000;
const BUILD_MAX_TOKENS = 8192;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** 模型的输出 → HTML：去掉代码块标记和前后的话 */
export function extractHtml(raw: string): string {
  let text = raw.replace(/^[ \t]*```[a-zA-Z]*[ \t]*$/gm, '').trim();
  const start = text.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) text = text.slice(start);
  const end = text.search(/<\/html\s*>/i);
  if (end >= 0) text = text.slice(0, text.indexOf('>', end) + 1);
  return text.trim();
}

/** 补齐文档骨架，写进内容安全策略（不能联网、不能提交表单）、编码和视口 */
export function finalizeArtifactHtml(html: string, title: string): { ok: true; html: string } | { ok: false; error: string } {
  if (html.length < 200 || !/<[a-z!]/i.test(html)) return { ok: false, error: '没有写出网页' };
  let doc = html;
  if (!/<html[\s>]/i.test(doc)) doc = `<html lang="zh-CN"><head><title>${escapeHtml(title)}</title></head><body>\n${doc}\n</body></html>`;
  if (!/<head[\s>]/i.test(doc)) doc = doc.replace(/<html([^>]*)>/i, '<html$1><head></head>');
  const meta = [
    ...(/<meta[^>]+charset/i.test(doc) ? [] : ['<meta charset="utf-8">']),
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`,
    ...(/<meta[^>]+name=["']?viewport/i.test(doc) ? [] : ['<meta name="viewport" content="width=device-width, initial-scale=1">']),
  ];
  doc = doc.replace(/<head([^>]*)>/i, `<head$1>\n${meta.join('\n')}`);
  // 每个网页都带上组件库（样式和动效，artifactKit.ts）；放在这几个 meta 后面、网页自己的样式前面
  doc = injectArtifactKit(doc);
  if (!/^<!doctype/i.test(doc.trimStart())) doc = `<!doctype html>\n${doc}`;
  if (Buffer.byteLength(doc) > MAX_ARTIFACT_BYTES) return { ok: false, error: '网页太大（超过 500KB）' };
  return { ok: true, html: doc };
}

/**
 * 网页里模型自己写的脚本有没有语法错误：只用 vm.Script 解析、不执行；组件库、非 JS 的 <script>（JSON 数据等）跳过。
 * 2026-10-11 线上一页观点地图的脚本报 Unexpected identifier，节点全都点不动。
 */
export function scriptSyntaxErrors(html: string): string[] {
  const errors: string[] = [];
  const re = /<script(?![^>]*data-hakcc-kit)([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const attrs = match[1];
    const code = match[2];
    if (/\bsrc\s*=/i.test(attrs) || !code.trim()) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && type !== 'text/javascript' && type !== 'application/javascript') continue;
    try {
      new Script(code, { filename: 'page.js' });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return errors;
}

async function streamText(candidate: Candidate, messages: AgentLoopMessage[], deadline: number, onProgress?: (chars: number) => void, already = 0): Promise<string> {
  let text = '';
  let lastReport = 0;
  for await (const chunk of streamProviderFinalAnswer({
    providerId: candidate.providerId,
    model: candidate.model,
    apiKey: candidate.apiKey,
    endpointUrl: candidate.endpointUrl,
    messages,
    maxTokens: BUILD_MAX_TOKENS,
    temperature: 0.4,
    disableThinking: true,
  })) {
    if (chunk.type !== 'token') continue;
    text += chunk.content;
    if (onProgress && Date.now() - lastReport > 600) {
      lastReport = Date.now();
      onProgress(already + text.length);
    }
    if (Date.now() > deadline) throw new Error('写网页超时');
  }
  return text;
}

export type BuildResult = { ok: true; html: string; providerId: string; model: string; ms: number } | { ok: false; error: string };

export async function buildArtifactHtml(params: {
  courseId: string;
  title: string;
  brief: string;
  sources: ArtifactSource[];
  previous?: { html: string; instructions: string };
  onProgress?: (chars: number) => void;
  /** 选了模板（pageTemplates.ts）：照它的结构写 */
  templateGuide?: string;
}): Promise<BuildResult> {
  const candidates = (await resolveCandidates(params.courseId, 'html_artifact')).slice(0, 2);
  if (candidates.length === 0) return { ok: false, error: '这门课没有配置能写网页的 AI' };
  const sourceLines = params.sources.length
    ? params.sources.map(s => `- 《${s.title}》${s.author ? `（${s.author}）` : ''}`).join('\n')
    : '（没有列出）';
  const user = params.previous
    ? [`修改要求：\n${params.previous.instructions}`, `网页标题：${params.title}`, `原来的制作说明：\n${params.brief || '（没有记录）'}`, `资料来源：\n${sourceLines}`, `现在的 HTML（组件库已经去掉，存的时候会自动加回去）：\n${stripArtifactKit(params.previous.html).slice(0, 150_000)}`].join('\n\n')
    : [`网页标题：${params.title}`, `制作说明：\n${params.brief}`, params.templateGuide ?? '', `资料来源：\n${sourceLines}`].filter(Boolean).join('\n\n');
  const messages: AgentLoopMessage[] = [
    { role: 'system', content: params.previous ? `${BUILD_RULES}\n\n${REVISE_RULES}` : BUILD_RULES },
    { role: 'user', content: user },
  ];

  const started = Date.now();
  const deadline = started + BUILD_DEADLINE_MS;
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      let raw = await streamText(candidate, messages, deadline, params.onProgress);
      // 写到长度上限停了（没写到 </html>）：接着写，最多两段
      for (let i = 0; i < 2 && !/<\/html\s*>/i.test(raw) && raw.length > 500; i += 1) {
        raw += await streamText(candidate, [...messages, { role: 'assistant', content: raw }, { role: 'user', content: CONTINUE_PROMPT }], deadline, params.onProgress, raw.length);
      }
      const checked = finalizeArtifactHtml(extractHtml(raw), params.title);
      if (!checked.ok) {
        failures.push(`${candidate.providerId}: ${checked.error}`);
        continue;
      }
      let html = checked.html;
      // 脚本有语法错误：把浏览器会报的错交回去修一次。修不好、超时就留原来那版（内容照样看得见，只是自己写的交互不动）
      const errors = scriptSyntaxErrors(html);
      if (errors.length > 0 && deadline - Date.now() > 45_000) {
        try {
          const fixed = await streamText(candidate, [
            ...messages,
            { role: 'assistant', content: stripArtifactKit(html) },
            { role: 'user', content: `这个网页里的脚本有语法错误，浏览器报：${errors.slice(0, 3).join('；')}。请修好后输出完整的 HTML（同样只输出 HTML，不要解释）。` },
          ], deadline, params.onProgress);
          const again = finalizeArtifactHtml(extractHtml(fixed), params.title);
          if (again.ok && scriptSyntaxErrors(again.html).length === 0) html = again.html;
        } catch (err) {
          console.warn('[agentMaker] script repair failed:', err instanceof Error ? err.message : err);
        }
      }
      reportProviderSuccess(candidate.providerId);
      return { ok: true, html, providerId: candidate.providerId, model: candidate.model, ms: Date.now() - started };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${candidate.providerId}: ${message.slice(0, 120)}`);
      reportProviderFailure(candidate.providerId, /429/.test(message) ? 'rate_limit' : /超时|timed out|abort/i.test(message) ? 'timeout' : 'server');
      if (Date.now() > deadline) break;
    }
  }
  return { ok: false, error: `网页没有写成：${failures.join('；')}` };
}

// ── 存取 ───────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

export interface ArtifactRow {
  id: string;
  group_id: string;
  version: number;
  course_id: string;
  space_id: string | null;
  owner_id: string;
  surface: string;
  conversation_id: string | null;
  title: string;
  brief: string | null;
  html: string;
  sources: ArtifactSource[];
  provider_id: string | null;
  model: string | null;
  created_at: string;
}

async function saveArtifact(params: {
  groupId: string;
  version: number;
  ctx: ToolContext;
  turn: AgentTurnState;
  title: string;
  brief: string | null;
  sources: ArtifactSource[];
  html: string;
  providerId: string;
  model: string;
  templateSlug?: string | null;
}): Promise<AgentArtifactRef> {
  const id = params.version === 1 ? params.groupId : randomUUID();
  const { error } = await supabase.from('ai_artifacts').insert({
    id,
    group_id: params.groupId,
    version: params.version,
    course_id: params.ctx.courseId,
    space_id: isUuid(params.ctx.spaceId) ? params.ctx.spaceId : null,
    owner_id: params.ctx.userId,
    surface: params.turn.surface,
    conversation_id: isUuid(params.turn.conversationId) ? params.turn.conversationId : null,
    note_id: params.turn.surface === 'note' && isUuid(params.ctx.noteId) ? params.ctx.noteId : null,
    kind: 'html',
    title: params.title,
    brief: params.brief,
    html: params.html,
    sources: params.sources,
    provider_id: params.providerId,
    model: params.model,
    ...(params.templateSlug ? { template_slug: params.templateSlug } : {}),
  });
  if (error) throw new Error(`网页存不进去：${error.message}`);
  return { id, groupId: params.groupId, title: params.title, version: params.version, kind: 'html', bytes: Buffer.byteLength(params.html) };
}

/** 本人在这门课里做的某个网页的最新版本（按任一版本的 id 找） */
async function loadLatestOwned(artifactId: string, userId: string, courseId: string): Promise<ArtifactRow | null> {
  const { data: row } = await supabase.from('ai_artifacts').select('group_id, owner_id, course_id').eq('id', artifactId).maybeSingle();
  if (!row || row.owner_id !== userId || row.course_id !== courseId) return null;
  const { data } = await supabase.from('ai_artifacts').select('*').eq('group_id', row.group_id).order('version', { ascending: false }).limit(1).maybeSingle();
  return (data as ArtifactRow | null) ?? null;
}

// ── 工具 ───────────────────────────────────────────────────────

const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** 学生点了选项卡上的哪一个（存进这条提问的 ai_metadata.choice，研究编码用） */
export interface StudentChoice { questionId: string; label: string; other?: boolean }

export function parseStudentChoice(value: unknown): StudentChoice | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const label = clip(v.label, 80);
  if (!isUuid(v.question_id) || !label) return null;
  return { questionId: v.question_id, label, ...(v.other === true ? { other: true } : {}) };
}
const notHere = (name: string): ToolExecutionResult => ({ success: false, data: null, error: `${name} 在这里用不了` });

export function parseSources(value: unknown): ArtifactSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((s): ArtifactSource[] => {
    const title = clip(typeof s === 'string' ? s : (s as { title?: unknown })?.title, 80);
    if (!title) return [];
    const author = typeof s === 'object' && s ? clip((s as { author?: unknown }).author, 40) : '';
    return [author ? { title, author } : { title }];
  });
}

export async function executeUpdatePlan(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> {
  const turn = ctx.turn;
  if (!turn) return notHere('update_plan');
  const steps = (Array.isArray(args.steps) ? args.steps : []).slice(0, 8).flatMap((s): AgentPlan['steps'] => {
    const title = clip(typeof s === 'string' ? s : (s as { title?: unknown })?.title, 40);
    const status = (s as { status?: unknown })?.status;
    return title ? [{ title, status: status === 'done' || status === 'in_progress' ? status : 'pending' }] : [];
  });
  if (steps.length === 0) return { success: false, data: null, error: 'steps 至少要有一步' };
  turn.plan = { steps };
  turn.emit({ agentPlan: turn.plan });
  return { success: true, data: { ok: true, steps: steps.length, note: '计划已经显示给学生。接着做下一步；做完一步时，在下一次调用别的工具时顺带更新它的状态。' } };
}

export async function executeAskChoice(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> {
  const turn = ctx.turn;
  if (!turn) return notHere('ask_choice');
  const question = clip(args.question, 200);
  const options = (Array.isArray(args.options) ? args.options : []).slice(0, 4).flatMap((o): AgentQuestion['options'] => {
    const label = clip(typeof o === 'string' ? o : (o as { label?: unknown })?.label, 40);
    if (!label) return [];
    const detail = typeof o === 'object' && o ? clip((o as { detail?: unknown }).detail, 140) : '';
    return [detail ? { label, detail } : { label }];
  });
  if (!question || options.length < 2) return { success: false, data: null, error: 'ask_choice 要一句问题和 2–4 个选项' };
  turn.question = { id: randomUUID(), question, options, allowOther: args.allow_other !== false };
  turn.emit({ agentQuestion: turn.question });
  return { success: true, data: { asked: true, reply: question }, endTurn: true };
}

export async function executeCreateArtifact(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> {
  const turn = ctx.turn;
  if (!turn) return notHere('create_artifact');
  if (turn.artifacts.length >= 3) return { success: false, data: null, error: '这一轮已经做了 3 个网页，先请学生看看' };
  const title = clip(args.title, 40) || '未命名网页';
  const brief = String(args.brief ?? '').trim().slice(0, 16_000);
  if (brief.length < 20) return { success: false, data: null, error: 'brief 要写清楚网页做什么、放哪些内容' };
  const sources = parseSources(args.sources);
  // 技能库：智能体选了模板就把它的结构说明交给写网页的模型（第五步）
  const template = await findTemplate(ctx.courseId, args.template).catch(() => null);
  turn.emit({ artifactStatus: { stage: 'writing', title, chars: 0 } });
  const built = await buildArtifactHtml({
    courseId: ctx.courseId, title, brief, sources,
    ...(template ? { templateGuide: templateBrief(template) } : {}),
    onProgress: chars => turn.emit({ artifactStatus: { stage: 'writing', title, chars } }),
  });
  if (!built.ok) {
    turn.emit({ artifactStatus: { stage: 'failed', title, error: built.error } });
    return { success: false, data: null, error: built.error };
  }
  const ref = await saveArtifact({ groupId: randomUUID(), version: 1, ctx, turn, title, brief, sources, html: built.html, providerId: built.providerId, model: built.model, templateSlug: template?.slug ?? null });
  turn.artifacts.push(ref);
  turn.emit({ artifact: ref });
  return {
    success: true,
    data: {
      artifact_id: ref.id, title, version: 1,
      note: '网页已经做好，卡片显示在你这段回答的上方，学生点开就能看、能下载。用一两句话告诉学生它是什么、怎么用、内容来自哪些笔记。不要贴 HTML 代码，不要写链接。',
    },
  };
}

export async function executeReviseArtifact(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> {
  const turn = ctx.turn;
  if (!turn) return notHere('revise_artifact');
  const artifactId = String(args.artifact_id ?? '').trim();
  const instructions = String(args.instructions ?? '').trim().slice(0, 4000);
  if (!isUuid(artifactId) || !instructions) return { success: false, data: null, error: 'revise_artifact 要 artifact_id 和修改要求' };
  const current = await loadLatestOwned(artifactId, ctx.userId, ctx.courseId);
  if (!current) return { success: false, data: null, error: '找不到这个网页：只能改自己在这门课里做的网页' };
  turn.emit({ artifactStatus: { stage: 'writing', title: current.title, chars: 0, revising: true } });
  const sources = parseSources(current.sources);
  const built = await buildArtifactHtml({
    courseId: ctx.courseId, title: current.title, brief: current.brief ?? '', sources,
    previous: { html: current.html, instructions },
    onProgress: chars => turn.emit({ artifactStatus: { stage: 'writing', title: current.title, chars, revising: true } }),
  });
  if (!built.ok) {
    turn.emit({ artifactStatus: { stage: 'failed', title: current.title, error: built.error } });
    return { success: false, data: null, error: built.error };
  }
  const ref = await saveArtifact({
    groupId: current.group_id, version: current.version + 1, ctx, turn,
    title: current.title, brief: current.brief, sources, html: built.html, providerId: built.providerId, model: built.model,
  });
  turn.artifacts.push(ref);
  turn.emit({ artifact: ref });
  return {
    success: true,
    data: { artifact_id: ref.id, title: ref.title, version: ref.version, note: `已经改好，第 ${ref.version} 版的卡片显示在你这段回答的上方（旧版本保留，打开后可以切换）。用一两句话说明改了什么。` },
  };
}

const UPDATE_PLAN_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'update_plan',
    description: '列出或更新这项任务的计划（3–6 步）。任务要分几步才能完成时先调用一次；之后每做完一步，在下一次调用别的工具时顺带调用它，把那一步标成 done、下一步标成 in_progress。学生在界面上看得到这份清单。简单的问题不要用。',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '这一步做什么，一句话，20 字以内' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
            },
            required: ['title', 'status'],
          },
        },
      },
      required: ['steps'],
    },
  },
};

const ASK_CHOICE_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ask_choice',
    description: '需要学生拿主意时调用：给 2–4 个具体选项，然后停下来等学生选（这一轮到此结束）。用在：选哪种呈现方式、先做哪一部分、几种思路选一个、做完以后下一步做什么。涉及观点和结论的地方用它让学生自己定，不要替学生决定。学生已经说清楚的不要再问。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '问学生的一句话' },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '选项名，12 字以内' },
              detail: { type: 'string', description: '一句话说明这个选项是什么、选了会得到什么' },
            },
            required: ['label'],
          },
        },
        allow_other: { type: 'boolean', description: '允许学生写自己的想法（默认允许）' },
      },
      required: ['question', 'options'],
    },
  },
};

const CREATE_ARTIFACT_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_artifact',
    description: '把内容做成一个能打开、能互动的网页（概念图、对比表、时间线、自测题、小模拟、海报、学习单等），显示在对话里给学生打开、下载。先用检索工具找到要用的笔记和课程资料再调用。写网页的是另一个模型，看不到这段对话，brief 必须自带全部内容。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '网页标题，20 字以内' },
        brief: { type: 'string', description: '制作说明：目的和使用场景；要放进去的全部内容（笔记里的原话或要点、作者、数据）；版式；交互方式（比如点开节点看原话、答完题显示解析）' },
        template: { type: 'string', description: '可选：照哪个网页模板的结构写（提示词里列的英文名，如 compare_table、self_quiz）；都不合适就不填' },
        sources: {
          type: 'array',
          description: '用到的笔记或资料',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, author: { type: 'string' } },
            required: ['title'],
          },
        },
      },
      required: ['title', 'brief'],
    },
  },
};

const REVISE_ARTIFACT_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'revise_artifact',
    description: '按学生的要求修改这段对话里已经做好的网页，存成新版本（旧版本保留）。',
    parameters: {
      type: 'object',
      properties: {
        artifact_id: { type: 'string', description: '要改的网页的 artifact_id' },
        instructions: { type: 'string', description: '要改什么，写具体' },
      },
      required: ['artifact_id', 'instructions'],
    },
  },
};

export function registerMakerTools(registry: ToolRegistry): void {
  registry.registerTool('update_plan', UPDATE_PLAN_DEF, executeUpdatePlan, 'all');
  registry.registerTool('ask_choice', ASK_CHOICE_DEF, executeAskChoice, 'all');
  registry.registerTool('create_artifact', CREATE_ARTIFACT_DEF, executeCreateArtifact, 'all');
  registry.registerTool('revise_artifact', REVISE_ARTIFACT_DEF, executeReviseArtifact, 'all');
}
