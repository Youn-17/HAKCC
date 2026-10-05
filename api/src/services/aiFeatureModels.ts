/**
 * 课程里每个 AI 功能用哪个模型。
 *
 * 教师在「AI 设置」里看得到平台上所有用到 AI 的地方、谁会触发、现在用的是哪个模型，
 * 并能给每个功能单独指定一个（不指定就是「自动」）。另外能限定学生在笔记 AI 助手的
 * 下拉框里可以选哪些模型。
 *
 * 一个功能用哪个模型，按这个顺序定：
 *   1. 教师指定的（这门课还配着那家的 key、那个模型也还在启用列表里才算数）；
 *   2. 默认规则：学生在等的功能先用 DeepSeek Flash（52 人同时用实测全部成功，中位 0.2–0.7 秒；
 *      DMX 同一轮中位 10–17 秒）；生图先用 DMX（聊天里的绘图指令也走它）；
 *   3. 调用处原来的候选链。
 * 前两步只决定谁排第一。调用处原有的健康度冷却、并发满时换家、失败换下一家都照旧。
 *
 * 设置存在 teacher_ai_configs.trigger_settings.ai_models：和「AI 触发设置」同一行、
 * 同一套选行规则（最新的那条非空设置行），不需要改表。
 *
 * 这个模块只依赖模型目录和数据库，刻意不依赖 modelRouter / aiProviderConfig ——
 * 路由测试常把那两个整体换成只有几个函数的假模块。健康度排序、解密密钥留给调用处。
 */
import { supabase } from '../config/supabase';
import {
  DMX_IMAGE_MODELS,
  MINIMAX_IMAGE_MODELS,
  NATIVE_MODELS,
  TASK_TIERS,
  defaultEnabledModels,
  normalizeDeepSeekModel,
  normalizeEnabledModels,
  preferredNativeModel,
} from './modelCatalog';

// ── 功能清单 ──────────────────────────────────────────────────

export type AiFeatureId =
  | 'note_partner'
  | 'note_feedback'
  | 'prompt_refine'
  | 'note_image'
  | 'workspace_agent'
  | 'discussion_digest'
  | 'view_topics'
  | 'doc_ai'
  | 'riseabove_room'
  | 'turing_test'
  | 'support'
  | 'personal_agent'
  | 'practice'
  | 'teacher_agents'
  | 'teaching_log'
  | 'qualitative_coding'
  | 'embedding'
  | 'web_search'
  | 'pdf_parse';

/** 设置页上的分组：学生写笔记时 / 知识空间与讨论 / 学生仪表盘 / 教师端 / 后台（不在这里选） */
export type AiFeatureGroup = 'note' | 'space' | 'dashboard' | 'teacher' | 'background';
export type AiFeatureKind = 'chat' | 'image' | 'embedding' | 'search' | 'parse';
type DmxTier = 'fast' | 'chat' | 'agent';

export interface AiFeatureDef {
  id: AiFeatureId;
  group: AiFeatureGroup;
  /** 谁的操作会让它调用模型 */
  who: 'student' | 'teacher' | 'both';
  kind: AiFeatureKind;
  /** 走 DMX 时用哪一档（modelCatalog.TASK_TIERS） */
  dmxTier?: DmxTier;
  /** 学生在等着看结果：没指定时先用快的、并发高的 */
  realtime: boolean;
  /** 教师能不能在这里给它指定模型 */
  selectable: boolean;
  /** 排第一的失败或排满时，调用处会不会自动换下一家 */
  failover: boolean;
  /** 没指定模型时，在一家里挑 flash / air 这类快档（求助原来就这样挑） */
  preferFastModel?: boolean;
  /** 没指定时的厂商顺序。和调用处原来的顺序一致，调用处也从这里取 */
  order: readonly string[];
  /** 调用处只接得了这几家（其余厂商的请求格式它不会发）；不写 = 不限 */
  providers?: readonly string[];
  label: { zh: string; en: string };
  desc: { zh: string; en: string };
  /** 不能在这里选时，说明用什么、在哪里改 */
  fixedNote?: { zh: string; en: string };
}

/**
 * 学生在等的对话。DeepSeek 最快、并发最宽；智谱 Coding Plan 同时最多 6 路；
 * Kimi 每分钟 100 次；DMX 最慢，只做溢出（2026-09-05 四把 key 压测）。
 */
export const REALTIME_PROVIDER_ORDER = [
  'deepseek', 'zhipu', 'moonshot', 'alibaba', 'openai', 'anthropic', 'google', 'minimax',
  'doubao', 'openrouter', 'baidu', 'xai', 'dmxapi', 'dmx',
] as const;

/** 反馈、讨论室、训练场、学生个人对话原来的顺序：原厂 key 在前，DMX 溢出。 */
export const NATIVE_FIRST_PROVIDER_ORDER = [
  'zhipu', 'deepseek', 'dmxapi', 'dmx', 'openai', 'anthropic', 'google', 'alibaba',
  'openrouter', 'doubao', 'moonshot', 'baidu', 'xai',
] as const;

/** 教师端先走 DeepSeek（2026-09-10 定）：智谱那 6 路并发留给学生。 */
export const TEACHER_PROVIDER_ORDER = [
  'deepseek', 'zhipu', 'dmxapi', 'dmx', 'moonshot', 'minimax', 'openai', 'anthropic',
  'google', 'alibaba', 'openrouter', 'doubao', 'baidu', 'xai',
] as const;

/** courseAi.callCourseChat 原来的顺序。 */
export const COURSE_CHAT_PROVIDER_ORDER = [
  'zhipu', 'deepseek', 'dmxapi', 'dmx', 'openai', 'moonshot', 'minimax', 'anthropic', 'google',
] as const;

/** 质性编码原来的顺序：DMX 在前（批量编码不赶时间，DMX 不限并发）。 */
export const CODING_PROVIDER_ORDER = [
  'dmxapi', 'dmx', 'openai', 'deepseek', 'zhipu', 'alibaba', 'moonshot',
] as const;

export const IMAGE_PROVIDER_ORDER = ['minimax', 'dmx', 'dmxapi'] as const;

/**
 * 学生笔记 AI 助手下拉框列得出的厂商（和 components/NoteEditorModal.tsx 的 DEFAULT_PROVIDER_MODELS 一致）。
 * 没有 MiniMax：那把 key 是配来生图的，学生下拉框从来不列它。
 */
export const PARTNER_PROVIDERS = [
  'deepseek', 'zhipu', 'moonshot', 'alibaba', 'openai', 'anthropic', 'google',
  'doubao', 'xai', 'baidu', 'openrouter', 'dmx', 'dmxapi',
] as const;

export const AI_FEATURES: readonly AiFeatureDef[] = [
  // ── 学生写笔记时 ──
  {
    id: 'note_partner', group: 'note', who: 'both', kind: 'chat', dmxTier: 'fast',
    realtime: true, selectable: true, failover: false,
    order: REALTIME_PROVIDER_ORDER,
    providers: PARTNER_PROVIDERS,
    label: { zh: '笔记 AI 助手对话', en: 'Note AI partner chat' },
    desc: {
      zh: '笔记页左侧的 AI 助手，也包括采纳反馈后生成的对话式笔记里的追问。学生下拉框里的「默认」就是这一行；带图提问时会换成同一家能看图的模型。',
      en: 'The AI partner beside the note editor, including follow-ups in dialogue notes. "Default" in the students\' menu is this row; a question with an image switches to a vision model from the same provider.',
    },
  },
  {
    id: 'note_feedback', group: 'note', who: 'both', kind: 'chat', dmxTier: 'fast',
    realtime: true, selectable: true, failover: true,
    order: NATIVE_FIRST_PROVIDER_ORDER,
    label: { zh: 'AI 反馈与支架建议', en: 'AI feedback and scaffold suggestion' },
    desc: {
      zh: '写作停顿时判断要不要给反馈，点「请求反馈」也走这里。反馈卡上的支架建议是同一次调用生成的。',
      en: 'Decides whether to give feedback when the writer pauses, and answers "Request feedback". The suggested scaffold comes from the same call.',
    },
  },
  {
    id: 'prompt_refine', group: 'note', who: 'both', kind: 'chat', dmxTier: 'fast',
    realtime: true, selectable: true, failover: false,
    order: REALTIME_PROVIDER_ORDER,
    label: { zh: '优化提问', en: 'Refine question' },
    desc: {
      zh: 'AI 助手输入框里的「优化提问」：只把问题改写通顺，不回答。',
      en: '"Refine question" in the AI partner: rewrites the question clearly without answering it.',
    },
  },
  {
    id: 'note_image', group: 'note', who: 'both', kind: 'image',
    realtime: true, selectable: true, failover: true,
    order: IMAGE_PROVIDER_ORDER,
    label: { zh: '生成图片', en: 'Image generation' },
    desc: {
      zh: '任何 AI 对话里说「画一张……」时直接出图，笔记 AI 助手里的「画图」按钮，以及各个助手在对话中调用画图工具。',
      en: 'A "draw …" request in any AI chat, the "draw" button in the AI partner, and any assistant calling its image tool.',
    },
  },
  // ── 知识空间与讨论 ──
  {
    id: 'workspace_agent', group: 'space', who: 'both', kind: 'chat', dmxTier: 'fast',
    realtime: true, selectable: true, failover: true,
    order: REALTIME_PROVIDER_ORDER,
    label: { zh: '知识空间 AI 助手', en: 'Workspace AI assistant' },
    desc: {
      zh: '知识空间顶部「助手」打开的侧栏，读整个空间或选中的笔记来回答。侧栏里手选了模型就用手选的，选「默认」时用这一行。',
      en: 'The side panel opened from "Assistant" in a knowledge space. A model picked in the panel wins; "Default" uses this row.',
    },
  },
  {
    id: 'discussion_digest', group: 'space', who: 'both', kind: 'chat', dmxTier: 'chat',
    realtime: true, selectable: true, failover: true,
    order: NATIVE_FIRST_PROVIDER_ORDER,
    label: { zh: '讨论速览', en: 'Discussion digest' },
    desc: {
      zh: '助手侧栏里的「讨论速览」：按当前 View、本组或选中的笔记列出有哪些观点和问题，只列不下结论。',
      en: 'Lists the ideas and questions in a view, a group or a selection, without drawing conclusions.',
    },
  },
  {
    id: 'view_topics', group: 'space', who: 'both', kind: 'chat', dmxTier: 'fast',
    realtime: false, selectable: true, failover: true, preferFastModel: true,
    order: REALTIME_PROVIDER_ORDER,
    label: { zh: '画布顶上的讨论主题', en: 'Discussion topics above the canvas' },
    desc: {
      zh: '画布顶部问题后面滚动显示的「这个视图在聊什么」：按视图里的笔记总结 3 到 6 个主题，笔记有变化时最快 3 分钟更新一次。只写在讨论什么，不下结论。',
      en: 'The rolling topics after the question above the canvas: 3 to 6 topics from the notes in the view, refreshed at most every 3 minutes as notes change. It says what is being discussed and draws no conclusions.',
    },
  },
  {
    id: 'doc_ai', group: 'space', who: 'both', kind: 'chat', dmxTier: 'fast',
    realtime: true, selectable: true, failover: false,
    order: REALTIME_PROVIDER_ORDER,
    label: { zh: '文档 AI 助手', en: 'Document AI assistant' },
    desc: {
      zh: '打开附件或课程资料时，右侧「AI 助手」只针对这份文档回答。',
      en: 'The "AI assistant" beside an open attachment or course material; answers only about that document.',
    },
  },
  {
    id: 'riseabove_room', group: 'space', who: 'student', kind: 'chat', dmxTier: 'chat',
    realtime: true, selectable: true, failover: true,
    order: NATIVE_FIRST_PROVIDER_ORDER,
    label: { zh: '讨论室 AI 同学', en: 'Rise Above room AI classmates' },
    desc: {
      zh: '「综合升华」讨论室里被 @ 的 AI 同学发言，以及讨论停住时贴出的「系统注意到的」提示卡。',
      en: 'Replies from AI classmates students @ in a Rise Above room, and the notice card posted when the talk stalls.',
    },
  },
  {
    id: 'turing_test', group: 'space', who: 'student', kind: 'chat',
    realtime: true, selectable: false, failover: false,
    order: TEACHER_PROVIDER_ORDER,
    label: { zh: '图灵测试 AI 成员', en: 'Turing test AI members' },
    desc: {
      zh: '图灵测试匿名群聊里扮成同学发言的 AI。',
      en: 'The AI members posing as classmates in a Turing test group chat.',
    },
    fixedNote: {
      zh: '在每个图灵测试活动的设置里单独选，新建活动默认 DeepSeek Flash。',
      en: 'Chosen in each Turing test activity; new activities default to DeepSeek Flash.',
    },
  },
  {
    id: 'support', group: 'space', who: 'student', kind: 'chat', dmxTier: 'fast',
    realtime: true, selectable: true, failover: true, preferFastModel: true,
    order: REALTIME_PROVIDER_ORDER,
    label: { zh: '使用帮助（AI 先答）', en: 'Help (AI answers first)' },
    desc: {
      zh: '学生点页面右边的「使用帮助」问平台怎么用，AI 按使用手册回答，答不上来可以转给教师。',
      en: 'Students ask how to use the platform from the Help button on the right edge; AI answers from the manual and can hand over to the teacher.',
    },
  },
  // ── 学生仪表盘 ──
  {
    id: 'personal_agent', group: 'dashboard', who: 'student', kind: 'chat', dmxTier: 'chat',
    realtime: true, selectable: true, failover: true,
    order: NATIVE_FIRST_PROVIDER_ORDER,
    label: { zh: '学生的「AI 对话」', en: 'Students\' "AI chat"' },
    desc: {
      zh: '学生仪表盘里的 AI 对话。学生在对话设置里手选了模型就用手选的，默认「自动」时用这一行。',
      en: 'The AI chat in the student dashboard. A model the student picks wins; the default "Auto" uses this row.',
    },
  },
  {
    id: 'practice', group: 'dashboard', who: 'student', kind: 'chat', dmxTier: 'fast',
    realtime: true, selectable: true, failover: true,
    order: NATIVE_FIRST_PROVIDER_ORDER,
    label: { zh: '思维练习、编程练习、计算思维工具', en: 'Thinking, coding and CT practice' },
    desc: {
      zh: '仪表盘的思维练习助手、编程练习助手和探究里的计算思维工具：出题、判分、给提示。前两个不属于某一门课，学生在几门课里时，用第一门指定了模型的课的设置。',
      en: 'The thinking and coding practice assistants and the CT tool: tasks, grading and hints. The first two are not tied to a course; for students in several courses, the first course with a choice applies.',
    },
  },
  // ── 教师端 ──
  {
    id: 'teacher_agents', group: 'teacher', who: 'teacher', kind: 'chat', dmxTier: 'agent',
    realtime: false, selectable: true, failover: true,
    order: TEACHER_PROVIDER_ORDER,
    label: { zh: '教师的 AI 对话、备课、学情分析、教学评估', en: 'Teacher AI chat, lesson prep, analytics, assessment' },
    desc: {
      zh: '教师端四个 AI 入口和「生成教案」。在助手设置里手选了模型就用手选的，默认「自动」时用这一行。',
      en: 'The four teacher AI entries and lesson plan generation. A model picked there wins; the default "Auto" uses this row.',
    },
  },
  {
    id: 'teaching_log', group: 'teacher', who: 'teacher', kind: 'chat', dmxTier: 'chat',
    realtime: false, selectable: true, failover: true,
    order: COURSE_CHAT_PROVIDER_ORDER,
    label: { zh: 'AI 教学日志', en: 'AI teaching log' },
    desc: {
      zh: '教学安排里给已上完的课次生成一段概述。',
      en: 'Writes a summary for a session that has been held.',
    },
  },
  {
    id: 'qualitative_coding', group: 'teacher', who: 'teacher', kind: 'chat', dmxTier: 'chat',
    realtime: false, selectable: true, failover: false,
    order: CODING_PROVIDER_ORDER,
    providers: CODING_PROVIDER_ORDER,
    label: { zh: '质性编码建议', en: 'Qualitative coding suggestions' },
    desc: {
      zh: '研究区质性编码里的「AI 编码建议」「AI 批量预编码」「语义相似片段」。',
      en: '"AI code suggestions", "AI batch pre-coding" and "similar segments" in qualitative coding.',
    },
  },
  // ── 后台 ──
  {
    id: 'embedding', group: 'background', who: 'both', kind: 'embedding',
    realtime: false, selectable: false, failover: false,
    order: ['openai', 'dmx', 'dmxapi'],
    label: { zh: '课程资料检索（向量）', en: 'Course material retrieval (embeddings)' },
    desc: {
      zh: '课程资料和笔记切块算向量，AI 回答前先检索课程材料。',
      en: 'Course materials and notes are embedded so AI can look them up before answering.',
    },
    fixedNote: {
      zh: '固定用 text-embedding-3-small，走这门课的 DMX 或 OpenAI key；换模型会让已经算好的向量对不上。',
      en: 'Always text-embedding-3-small through the course\'s DMX or OpenAI key; another model would not match the vectors already stored.',
    },
  },
  {
    id: 'web_search', group: 'background', who: 'both', kind: 'search',
    realtime: false, selectable: false, failover: false,
    order: ['tavily'],
    label: { zh: '网页检索', en: 'Web search' },
    desc: {
      zh: 'AI 助手打开「网页证据」或用「证据检验」时先搜网页再回答。',
      en: 'Searches the web first when "web evidence" or the evidence mode is on.',
    },
    fixedNote: {
      zh: '只用 Tavily，这门课配了 Tavily 的 key 才开放。',
      en: 'Tavily only; available once the course has a Tavily key.',
    },
  },
  {
    id: 'pdf_parse', group: 'background', who: 'both', kind: 'parse',
    realtime: false, selectable: false, failover: false,
    order: [],
    label: { zh: 'PDF 解析', en: 'PDF parsing' },
    desc: {
      zh: '打开 PDF 附件时先转成 AI 能读的文字，文档 AI 助手和课程资料检索都用它。',
      en: 'Turns an opened PDF into text the AI can read, for the document assistant and material retrieval.',
    },
    fixedNote: {
      zh: '服务器配置了 MinerU 就用它（文件地址交给 mineru.net 解析），否则在本平台服务器上直接提取文字。不用课程的 key。',
      en: 'Uses MinerU when the server has it configured (the file address is sent to mineru.net), otherwise extracts text on this server. No course key involved.',
    },
  },
];

const FEATURES_BY_ID = new Map<AiFeatureId, AiFeatureDef>(AI_FEATURES.map(f => [f.id, f]));

export function getAiFeature(id: AiFeatureId): AiFeatureDef {
  const def = FEATURES_BY_ID.get(id);
  if (!def) throw new Error(`Unknown AI feature: ${id}`);
  return def;
}

export function isAiFeatureId(value: unknown): value is AiFeatureId {
  return typeof value === 'string' && FEATURES_BY_ID.has(value as AiFeatureId);
}

// ── 课程的配置行与设置 ────────────────────────────────────────

export interface CourseAiRow {
  id?: string;
  course_id?: string;
  provider_id: string;
  api_key_encrypted?: string | null;
  endpoint_url?: string | null;
  is_verified?: boolean | null;
  enabled_models?: unknown;
  configured_at?: string | null;
  trigger_settings?: unknown;
}

export interface ModelRef {
  providerId: string;
  model: string;
}

/**
 * 有模型菜单的入口。教师可以在课程 AI 设置里多选：这个入口的菜单里只显示哪些模型（2026-09-29 用户要求）。
 * id 和功能表里对应的那一行相同：「默认」用的就是那一行现在的模型。
 */
export type PickerSurface = 'note_partner' | 'workspace_agent' | 'personal_agent';
export const PICKER_SURFACES: readonly PickerSurface[] = ['note_partner', 'workspace_agent', 'personal_agent'];
export function isPickerSurface(id: string): id is PickerSurface {
  return (PICKER_SURFACES as readonly string[]).includes(id);
}
type OtherPickerSurface = Exclude<PickerSurface, 'note_partner'>;
const OTHER_PICKER_SURFACES: readonly OtherPickerSurface[] = ['workspace_agent', 'personal_agent'];

export interface AiModelSettings {
  /** 教师给各功能指定的模型；没有的就是「自动」 */
  features: Partial<Record<AiFeatureId, ModelRef>>;
  /** 笔记 AI 助手下拉框里能选的模型；null = 这门课启用的全部对话模型。存在 partner_models（最早只有这一个入口） */
  partnerModels: ModelRef[] | null;
  /** 知识空间助手、学生首页「AI 对话」的菜单各自显示哪些；没有这个键 = 不限。存在 picker_models */
  pickerModels?: Partial<Record<OtherPickerSurface, ModelRef[]>>;
}

/** 某个入口的名单；null = 不限 */
export function pickerAllowlist(settings: AiModelSettings, surface: PickerSurface): ModelRef[] | null {
  if (surface === 'note_partner') return settings.partnerModels;
  return settings.pickerModels?.[surface] ?? null;
}

/** trigger_settings 里存这份设置的键。 */
export const AI_MODELS_SETTINGS_KEY = 'ai_models';

export const COURSE_AI_ROW_COLUMNS =
  'id, provider_id, api_key_encrypted, endpoint_url, is_verified, enabled_models, configured_at, trigger_settings';

const EMPTY_SETTINGS: AiModelSettings = { features: {}, partnerModels: null };

export function isDmx(providerId: string): boolean {
  return providerId === 'dmx' || providerId === 'dmxapi';
}

export function hasProviderKey(row: Pick<CourseAiRow, 'api_key_encrypted'>): boolean {
  return typeof row.api_key_encrypted === 'string' && row.api_key_encrypted.trim().length > 0;
}

function parseRef(value: unknown): ModelRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const providerId = typeof v.provider_id === 'string' ? v.provider_id.trim() : '';
  const model = typeof v.model === 'string' ? v.model.trim() : '';
  if (!providerId || !model) return null;
  return { providerId, model: normalizeModelFor(providerId, model) };
}

function normalizeModelFor(providerId: string, model: string): string {
  return providerId === 'deepseek' || isDmx(providerId) ? normalizeDeepSeekModel(model, providerId) : model;
}

export function parseAiModelSettings(triggerSettings: unknown): AiModelSettings {
  if (!triggerSettings || typeof triggerSettings !== 'object') return EMPTY_SETTINGS;
  const raw = (triggerSettings as Record<string, unknown>)[AI_MODELS_SETTINGS_KEY];
  if (!raw || typeof raw !== 'object') return EMPTY_SETTINGS;
  const stored = raw as Record<string, unknown>;

  const features: Partial<Record<AiFeatureId, ModelRef>> = {};
  if (stored.features && typeof stored.features === 'object') {
    for (const [id, value] of Object.entries(stored.features as Record<string, unknown>)) {
      if (!isAiFeatureId(id)) continue;
      const ref = parseRef(value);
      if (ref) features[id] = ref;
    }
  }
  const partnerModels = Array.isArray(stored.partner_models)
    ? stored.partner_models.map(parseRef).filter((r): r is ModelRef => r !== null)
    : null;
  const pickerModels: Partial<Record<OtherPickerSurface, ModelRef[]>> = {};
  const storedPickers = stored.picker_models && typeof stored.picker_models === 'object'
    ? stored.picker_models as Record<string, unknown> : {};
  for (const surface of OTHER_PICKER_SURFACES) {
    const list = storedPickers[surface];
    if (!Array.isArray(list)) continue;
    const refs = list.map(parseRef).filter((r): r is ModelRef => r !== null);
    if (refs.length > 0) pickerModels[surface] = refs;
  }
  return {
    features,
    partnerModels: partnerModels && partnerModels.length > 0 ? partnerModels : null,
    pickerModels,
  };
}

export function serializeAiModelSettings(settings: AiModelSettings): Record<string, unknown> {
  const features: Record<string, { provider_id: string; model: string }> = {};
  for (const [id, ref] of Object.entries(settings.features)) {
    if (ref) features[id] = { provider_id: ref.providerId, model: ref.model };
  }
  const pickerModels: Record<string, Array<{ provider_id: string; model: string }>> = {};
  for (const surface of OTHER_PICKER_SURFACES) {
    const list = settings.pickerModels?.[surface];
    if (list && list.length > 0) pickerModels[surface] = list.map(r => ({ provider_id: r.providerId, model: r.model }));
  }
  return {
    features,
    partner_models: settings.partnerModels
      ? settings.partnerModels.map(r => ({ provider_id: r.providerId, model: r.model }))
      : null,
    picker_models: pickerModels,
  };
}

function hasSettings(row: Pick<CourseAiRow, 'trigger_settings'>): boolean {
  const s = row.trigger_settings;
  return Boolean(s && typeof s === 'object' && Object.keys(s as object).length > 0);
}

/**
 * 设置存在哪一行：最新的那条非空设置行，一条都没有就用最新的一行。
 * 与 routes/ai.ts 的触发设置读写、noteAiFeedback 的 fetchTriggerSettings 同一个口径 ——
 * 两份设置在同一行上，谁先写都不会把对方写到另一行去。
 */
export function pickSettingsRow<T extends Pick<CourseAiRow, 'trigger_settings' | 'configured_at'>>(rows: readonly T[]): T | undefined {
  const newestFirst = [...rows].sort((a, b) => String(b.configured_at ?? '').localeCompare(String(a.configured_at ?? '')));
  return newestFirst.find(hasSettings) ?? newestFirst[0];
}

export function settingsFromRows(rows: readonly CourseAiRow[]): AiModelSettings {
  return parseAiModelSettings(pickSettingsRow(rows)?.trigger_settings);
}

export async function loadCourseAiRows(courseId: string): Promise<CourseAiRow[]> {
  const { data, error } = await supabase
    .from('teacher_ai_configs')
    .select(COURSE_AI_ROW_COLUMNS)
    .eq('course_id', courseId);
  if (error) throw new Error(error.message);
  return (data ?? []) as CourseAiRow[];
}

// ── 某家能提供哪些模型 ────────────────────────────────────────

/** 这一行在某类功能下能选的模型。对话：教师启用的（空就用目录默认）；生图：该家的生图型号。 */
export function modelsForRow(row: Pick<CourseAiRow, 'provider_id' | 'enabled_models'>, kind: AiFeatureKind): string[] {
  const pid = row.provider_id;
  if (kind === 'image') {
    if (pid === 'minimax') return MINIMAX_IMAGE_MODELS.map(m => m.id);
    if (isDmx(pid)) return DMX_IMAGE_MODELS.map(m => m.id);
    return [];
  }
  if (kind !== 'chat' || pid === 'tavily') return [];
  const enabled = normalizeEnabledModels(pid, row.enabled_models);
  return enabled.length ? enabled : defaultEnabledModels(pid);
}

function usableRows(rows: readonly CourseAiRow[], kind: AiFeatureKind): CourseAiRow[] {
  const seen = new Set<string>();
  const out: CourseAiRow[] = [];
  for (const row of rows) {
    if (!hasProviderKey(row) || seen.has(row.provider_id)) continue;
    if (modelsForRow(row, kind).length === 0) continue;
    seen.add(row.provider_id);
    out.push(row);
  }
  return out;
}

/** 某个功能能用的配置行：有 key、这类功能下有模型、调用处接得了这一家。 */
function featureRows(def: AiFeatureDef, rows: readonly CourseAiRow[]): CourseAiRow[] {
  const usable = usableRows(rows, def.kind);
  return def.providers ? usable.filter(r => def.providers!.includes(r.provider_id)) : usable;
}

/** 课程所有对话模型（学生下拉框、教师选择的候选）。按学生在等的功能的顺序排，DMX 在最后。 */
export function chatModelOptions(rows: readonly CourseAiRow[]): ModelRef[] {
  return sortByOrder(usableRows(rows, 'chat'), REALTIME_PROVIDER_ORDER)
    .flatMap(row => modelsForRow(row, 'chat').map(model => ({ providerId: row.provider_id, model })));
}

export function modelOptionsFor(featureId: AiFeatureId, rows: readonly CourseAiRow[]): ModelRef[] {
  const def = getAiFeature(featureId);
  if (!def.selectable) return [];
  const order = def.kind === 'chat' ? REALTIME_PROVIDER_ORDER : def.order;
  return sortByOrder(featureRows(def, rows), order)
    .flatMap(row => modelsForRow(row, def.kind).map(model => ({ providerId: row.provider_id, model })));
}

export function sortByOrder<T extends { provider_id: string }>(rows: readonly T[], order: readonly string[]): T[] {
  const rank = (pid: string) => {
    const i = order.indexOf(pid);
    return i === -1 ? order.length : i;
  };
  return [...rows].sort((a, b) => rank(a.provider_id) - rank(b.provider_id));
}

const FAST_DEEPSEEK = new Set((NATIVE_MODELS.deepseek ?? []).filter(m => m.fast).map(m => m.id));
/** 名字上看得出是快档的（求助原来就按这个挑） */
const FAST_MODEL_NAME = /flash|air|turbo|mini/i;

/**
 * 某一行在某功能下没被指定模型时用哪个。和调用处原来的挑法一致：
 * DMX 走任务分档的第一个，原厂 key 按目录挑它启用的；求助这类只要快的，挑 flash / air 档。
 */
export function defaultModelForRow(def: AiFeatureDef, row: CourseAiRow): string | null {
  if (def.kind === 'image') {
    if (row.provider_id === 'minimax') return MINIMAX_IMAGE_MODELS[0].id;
    if (isDmx(row.provider_id)) return DMX_IMAGE_MODELS[0].id;
    return null;
  }
  if (def.kind !== 'chat') return null;
  const models = modelsForRow(row, 'chat');
  if (def.preferFastModel) return models.find(m => FAST_MODEL_NAME.test(m)) ?? models[0] ?? null;
  if (isDmx(row.provider_id)) return TASK_TIERS[def.dmxTier ?? 'chat'][0];
  return preferredNativeModel(row.provider_id, models);
}

// ── 解析 ──────────────────────────────────────────────────────

export interface FeatureChoice extends ModelRef {
  /** teacher = 教师在设置里指定的；default = 默认规则挑的 */
  source: 'teacher' | 'default';
}

/**
 * 生图默认先用哪家：DMX。平台负责人 2026-09-29 定的：DMX 的 key 就用来画图，
 * 聊天里说「画一张……」自动出图（drawIntent），其余对话用别的模型。DMX 的 qwen-image-plus 实测 6–8 秒，
 * MiniMax image-01 要 35 秒左右。服务器上显式设 AI_IMAGE_PREFER=minimax 才改成 MiniMax 优先；课程也可以在设置页指定。
 */
export function defaultImageProvider(value: string | undefined = process.env.AI_IMAGE_PREFER): 'minimax' | 'dmx' {
  return (value ?? '').trim().toLowerCase() === 'minimax' ? 'minimax' : 'dmx';
}

function isChoiceUsable(def: AiFeatureDef, rows: readonly CourseAiRow[], ref: ModelRef, settings: AiModelSettings): boolean {
  const row = featureRows(def, rows).find(r => r.provider_id === ref.providerId);
  if (!row) return false;
  if (!modelsForRow(row, def.kind).includes(ref.model)) return false;
  // 有菜单名单的入口：「默认」也只能落在名单里——教师不让这里出现的模型，选「默认」也不该用到它
  const allow = isPickerSurface(def.id) ? pickerAllowlist(settings, def.id) : null;
  if (allow) return allow.some(p => sameRef(p, ref));
  return true;
}

export function sameRef(a: ModelRef, b: ModelRef): boolean {
  return a.providerId === b.providerId
    && normalizeModelFor(a.providerId, a.model) === normalizeModelFor(b.providerId, b.model);
}

function defaultRuleChoice(def: AiFeatureDef, rows: readonly CourseAiRow[]): ModelRef | null {
  const usable = featureRows(def, rows);
  if (def.kind === 'image') {
    const provider = defaultImageProvider();
    const row = usable.find(r => (provider === 'dmx' ? isDmx(r.provider_id) : r.provider_id === 'minimax'));
    const model = row ? defaultModelForRow(def, row) : null;
    return row && model ? { providerId: row.provider_id, model } : null;
  }
  if (def.kind === 'chat' && def.realtime) {
    const deepseek = usable.find(r => r.provider_id === 'deepseek');
    const fast = deepseek ? modelsForRow(deepseek, 'chat').find(m => FAST_DEEPSEEK.has(m)) : undefined;
    if (fast) return { providerId: 'deepseek', model: fast };
  }
  return null;
}

/**
 * 某个功能排第一的模型：教师指定且可用 → 默认规则 → null（交给调用处原来的候选链）。
 * 有菜单名单的入口（笔记 AI 助手、知识空间助手、学生首页 AI 对话）限定了名单时，结果只会落在名单里。
 */
export function featureChoice(
  featureId: AiFeatureId,
  rows: readonly CourseAiRow[],
  settings: AiModelSettings = settingsFromRows(rows),
): FeatureChoice | null {
  const def = getAiFeature(featureId);
  if (!def.selectable) return null;
  const picked = settings.features[featureId];
  if (picked && isChoiceUsable(def, rows, picked, settings)) {
    return { providerId: picked.providerId, model: normalizeModelFor(picked.providerId, picked.model), source: 'teacher' };
  }
  const fallback = defaultRuleChoice(def, rows);
  if (fallback && isChoiceUsable(def, rows, fallback, settings)) return { ...fallback, source: 'default' };
  if (isPickerSurface(def.id) && pickerAllowlist(settings, def.id)) {
    // 限定了名单、默认规则挑的又不在名单里：按顺序取名单里第一个还能用的
    const allowed = orderedPickerOptions(def.id, rows, settings)[0];
    if (allowed) return { ...allowed, source: 'default' };
  }
  return null;
}

/**
 * 某个功能的候选配置行：能用的（有 key、这类功能下有模型）按功能顺序排，选中的那家排最前。
 * 调用处拿去做健康度排序（orderConfigsByHealth），再按 choiceModelFor / 原规则挑模型。
 */
export function featureCandidateRows(
  featureId: AiFeatureId,
  rows: readonly CourseAiRow[],
  settings: AiModelSettings = settingsFromRows(rows),
): { rows: CourseAiRow[]; choice: FeatureChoice | null } {
  const def = getAiFeature(featureId);
  const choice = featureChoice(featureId, rows, settings);
  return { rows: preferChoice(sortByOrder(featureRows(def, rows), def.order), choice), choice };
}

/** 把选中的那家排到最前，其余保持原顺序。调用处之后照旧做健康度排序。 */
export function preferChoice<T extends { provider_id: string }>(rows: readonly T[], choice: ModelRef | null): T[] {
  if (!choice) return [...rows];
  return [
    ...rows.filter(r => r.provider_id === choice.providerId),
    ...rows.filter(r => r.provider_id !== choice.providerId),
  ];
}

/** 选中的那家用选中的模型；别家返回 null，由调用处按原来的规则挑。 */
export function choiceModelFor(choice: ModelRef | null, providerId: string): string | null {
  return choice && choice.providerId === providerId ? choice.model : null;
}

// ── 各入口的模型菜单里显示哪些 ────────────────────────────────

/** 某个入口菜单里的模型，按顺序：教师限定了就只有名单里还能用的，否则是这门课全部对话模型。 */
export function orderedPickerOptions(
  surface: PickerSurface,
  rows: readonly CourseAiRow[],
  settings: AiModelSettings = settingsFromRows(rows),
): ModelRef[] {
  const all = modelOptionsFor(surface, rows);
  const allow = pickerAllowlist(settings, surface);
  if (!allow) return all;
  return all.filter(option => allow.some(p => sameRef(p, option)));
}

export interface PartnerModelPolicy {
  /** null = 不限（这门课启用的全部对话模型都可选） */
  allowed: ModelRef[] | null;
  /** 菜单里「默认」对应的模型（限定了名单时一定在名单里） */
  defaultModel: ModelRef | null;
}

export function pickerPolicy(
  surface: PickerSurface,
  rows: readonly CourseAiRow[],
  settings: AiModelSettings = settingsFromRows(rows),
): PartnerModelPolicy {
  const options = orderedPickerOptions(surface, rows, settings);
  const current = planFeature(surface, rows, settings).current;
  return {
    allowed: pickerAllowlist(settings, surface) ? options : null,
    defaultModel: current ? { providerId: current.providerId, model: current.model } : options[0] ?? null,
  };
}

/**
 * 这次请求实际该用哪个模型。
 * 'auto'（或名单外的选择——比如教师刚改了名单、页面还没刷新）一律落到「默认」那个；
 * 名单内的照选的来。这门课一个对话模型都没有时返回 null。
 */
export function resolvePickerSelection(
  surface: PickerSurface,
  rows: readonly CourseAiRow[],
  requested: { providerId?: string | null; model?: string | null },
): (ModelRef & { coerced: boolean }) | null {
  const settings = settingsFromRows(rows);
  const options = orderedPickerOptions(surface, rows, settings);
  const providerId = requested.providerId ?? '';
  const model = requested.model ?? '';
  const isAuto = providerId === 'auto' || model === 'auto' || !providerId || !model;
  if (!isAuto) {
    const wanted = { providerId, model: normalizeModelFor(providerId, model) };
    if (options.some(o => sameRef(o, wanted))) return { ...wanted, coerced: false };
    // 名单外、但这个入口不限名单且配着这家：保持原行为，照选的发（旧线程里可能是自定义模型）
    if (!pickerAllowlist(settings, surface) && usableRows(rows, 'chat').some(r => r.provider_id === providerId)) {
      return { ...wanted, coerced: false };
    }
  }
  const policy = pickerPolicy(surface, rows, settings);
  if (!policy.defaultModel) return null;
  return { ...policy.defaultModel, coerced: !isAuto };
}

/**
 * 把某个入口的菜单名单套到发给前端的配置列表上：限定了名单时，每家只留名单里还能用的模型，
 * 一个不剩的厂商整个拿掉；不限就原样返回。菜单就是按这份列表画的。
 */
export function applyPickerToConfigs<T extends { providerId: string; enabledModels: string[] }>(
  surface: PickerSurface,
  rows: readonly CourseAiRow[],
  configs: readonly T[],
): T[] {
  const settings = settingsFromRows(rows);
  if (!pickerAllowlist(settings, surface)) return [...configs];
  const allowed = orderedPickerOptions(surface, rows, settings);
  return configs.flatMap(cfg => {
    const models = allowed.filter(ref => ref.providerId === cfg.providerId).map(ref => ref.model);
    return models.length > 0 ? [{ ...cfg, enabledModels: models }] : [];
  });
}

/** 笔记 AI 助手（最早只有它有名单）：保留原来的函数名，调用处和测试不用改。 */
export function orderedPartnerOptions(rows: readonly CourseAiRow[], settings: AiModelSettings = settingsFromRows(rows)): ModelRef[] {
  return orderedPickerOptions('note_partner', rows, settings);
}

export function partnerModelPolicy(rows: readonly CourseAiRow[]): PartnerModelPolicy {
  return pickerPolicy('note_partner', rows);
}

export function resolvePartnerSelection(
  rows: readonly CourseAiRow[],
  requested: { providerId?: string | null; model?: string | null },
): (ModelRef & { coerced: boolean }) | null {
  return resolvePickerSelection('note_partner', rows, requested);
}

// ── 给设置页看的：每个功能现在用什么 ─────────────────────────

export interface FeaturePlan {
  id: AiFeatureId;
  /** 教师保存的选择（可能已不可用） */
  saved: ModelRef | null;
  /** 保存的选择现在用不了（没有那家的 key，或模型不在启用列表里） */
  savedUnavailable: boolean;
  /** 现在排第一的 */
  current: (ModelRef & { source: 'teacher' | 'default' | 'auto' | 'fixed' | 'activity_default' }) | null;
  /** 第一个失败或排满时依次换的（最多两个） */
  fallbacks: ModelRef[];
}

function fixedCurrent(def: AiFeatureDef, rows: readonly CourseAiRow[]): ModelRef | null {
  const keyed = rows.filter(hasProviderKey);
  if (def.kind === 'embedding') {
    const row = keyed.find(r => r.provider_id === 'openai' || isDmx(r.provider_id));
    return row ? { providerId: row.provider_id, model: 'text-embedding-3-small' } : null;
  }
  if (def.kind === 'search') {
    return keyed.some(r => r.provider_id === 'tavily') ? { providerId: 'tavily', model: 'tavily-search' } : null;
  }
  if (def.kind === 'parse') {
    // 与 services/mineru.ts 的 isMinerUConfigured 同一个判断
    return process.env.MINERU_TOKEN ? { providerId: 'mineru', model: 'mineru' } : { providerId: 'local', model: 'pdf-parse' };
  }
  if (def.id === 'turing_test') {
    const deepseek = usableRows(rows, 'chat').find(r => r.provider_id === 'deepseek');
    return deepseek ? { providerId: 'deepseek', model: 'deepseek-flash' } : null;
  }
  return null;
}

export function planFeature(featureId: AiFeatureId, rows: readonly CourseAiRow[], settings: AiModelSettings = settingsFromRows(rows)): FeaturePlan {
  const def = getAiFeature(featureId);
  const saved = settings.features[featureId] ?? null;
  if (!def.selectable) {
    const fixed = fixedCurrent(def, rows);
    // 图灵测试的模型在每个活动里单独选，这里只能给出新建活动时的默认
    const source = featureId === 'turing_test' ? 'activity_default' as const : 'fixed' as const;
    return { id: featureId, saved: null, savedUnavailable: false, current: fixed ? { ...fixed, source } : null, fallbacks: [] };
  }
  const choice = featureChoice(featureId, rows, settings);
  const savedUnavailable = Boolean(saved && (!choice || choice.source !== 'teacher'));

  const chain = preferChoice(sortByOrder(featureRows(def, rows), def.order), choice)
    .map(row => ({ providerId: row.provider_id, model: choiceModelFor(choice, row.provider_id) ?? defaultModelForRow(def, row) }))
    .filter((ref): ref is ModelRef => Boolean(ref.model));
  const [first, ...rest] = chain;
  return {
    id: featureId,
    saved,
    savedUnavailable,
    current: first ? { ...first, source: choice && sameRef(choice, first) ? choice.source : 'auto' } : null,
    fallbacks: def.failover ? rest.slice(0, 2) : [],
  };
}

export function planAllFeatures(rows: readonly CourseAiRow[]): FeaturePlan[] {
  const settings = settingsFromRows(rows);
  return AI_FEATURES.map(def => planFeature(def.id, rows, settings));
}

// ── 保存 ──────────────────────────────────────────────────────

export interface AiModelSettingsPatch {
  /** 功能 → 模型；null 表示改回「自动」 */
  features?: Partial<Record<AiFeatureId, ModelRef | null>>;
  /** 笔记 AI 助手菜单里的模型；null 表示不限 */
  partnerModels?: ModelRef[] | null;
  /** 知识空间助手、学生首页 AI 对话菜单里的模型；某个键为 null 表示那个入口不限 */
  pickerModels?: Partial<Record<OtherPickerSurface, ModelRef[] | null>>;
}

export class AiModelSettingsError extends Error {}

/**
 * 校验并合并一次修改。只接受这门课现在真的能用的选择 —— 选了一个没有 key 的厂商，
 * 保存下来也只会在运行时被跳过，教师却以为生效了。
 */
export function applyAiModelSettingsPatch(
  current: AiModelSettings,
  patch: AiModelSettingsPatch,
  rows: readonly CourseAiRow[],
): AiModelSettings {
  const features = { ...current.features };
  for (const [id, value] of Object.entries(patch.features ?? {})) {
    if (!isAiFeatureId(id)) throw new AiModelSettingsError(`不认识的功能：${id}`);
    const def = getAiFeature(id);
    if (!def.selectable) throw new AiModelSettingsError(`「${def.label.zh}」不能在这里选模型`);
    if (value === null) {
      delete features[id];
      continue;
    }
    const ref = { providerId: value.providerId, model: normalizeModelFor(value.providerId, value.model) };
    if (!modelOptionsFor(id, rows).some(o => sameRef(o, ref))) {
      throw new AiModelSettingsError(`这门课现在用不了 ${ref.providerId} · ${ref.model}：没有这家的 key，或这个模型没有启用`);
    }
    features[id] = ref;
  }

  /** 校验一份菜单名单：只收这个入口现在能用的，去重，至少留一个 */
  const validList = (surface: PickerSurface, list: ModelRef[]): ModelRef[] => {
    const options = modelOptionsFor(surface, rows);
    const picked: ModelRef[] = [];
    for (const value of list) {
      const ref = { providerId: value.providerId, model: normalizeModelFor(value.providerId, value.model) };
      if (!options.some(o => sameRef(o, ref))) {
        throw new AiModelSettingsError(`这门课现在用不了 ${ref.providerId} · ${ref.model}`);
      }
      if (!picked.some(p => sameRef(p, ref))) picked.push(ref);
    }
    if (picked.length === 0) throw new AiModelSettingsError(`「${getAiFeature(surface).label.zh}」的菜单里至少要留一个模型`);
    return picked;
  };

  let partnerModels = current.partnerModels;
  if (patch.partnerModels !== undefined) {
    partnerModels = patch.partnerModels === null ? null : validList('note_partner', patch.partnerModels);
  }
  const pickerModels: Partial<Record<OtherPickerSurface, ModelRef[]>> = { ...(current.pickerModels ?? {}) };
  for (const [surface, list] of Object.entries(patch.pickerModels ?? {}) as Array<[string, ModelRef[] | null | undefined]>) {
    if (!(OTHER_PICKER_SURFACES as readonly string[]).includes(surface)) {
      throw new AiModelSettingsError(`不认识的入口：${surface}`);
    }
    const key = surface as OtherPickerSurface;
    if (list === undefined) continue;
    if (list === null) delete pickerModels[key];
    else pickerModels[key] = validList(key, list);
  }
  return { features, partnerModels, pickerModels };
}
