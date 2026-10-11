/**
 * 智能体一轮里除了文字以外的东西（2026-10-11）：计划清单、选项卡、做好的网页、正在写网页的进度。
 * 笔记 AI 助手和知识空间智能体共用。流里的事件（agentPlan / agentQuestion / artifactStatus / artifact，
 * 后端 agentMaker.ts）和存下来的 ai_metadata（plan / question / artifacts）都在这里还原成同一个样子。
 */

export type PlanStatus = 'pending' | 'in_progress' | 'done';
export interface AgentPlan { steps: Array<{ title: string; status: PlanStatus }> }
export interface AgentQuestionOption { label: string; detail?: string }
export interface AgentQuestion { id: string; question: string; options: AgentQuestionOption[]; allowOther: boolean }
export interface AgentArtifactRef { id: string; groupId: string; title: string; version: number; kind: 'html'; bytes: number }
export interface ArtifactProgress { stage: 'writing' | 'failed'; title: string; chars: number; revising?: boolean; error?: string }

export interface AgentExtras {
  plan?: AgentPlan;
  question?: AgentQuestion;
  artifacts?: AgentArtifactRef[];
  /** 只在这一轮还没答完时有 */
  progress?: ArtifactProgress;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function parsePlan(value: unknown): AgentPlan | undefined {
  if (!isRecord(value) || !Array.isArray(value.steps)) return undefined;
  const steps = value.steps.flatMap((s): AgentPlan['steps'] => {
    if (!isRecord(s)) return [];
    const title = str(s.title, 60);
    const status: PlanStatus = s.status === 'done' || s.status === 'in_progress' ? s.status : 'pending';
    return title ? [{ title, status }] : [];
  });
  return steps.length ? { steps } : undefined;
}

export function parseQuestion(value: unknown): AgentQuestion | undefined {
  if (!isRecord(value)) return undefined;
  const id = str(value.id, 64);
  const question = str(value.question);
  const options = (Array.isArray(value.options) ? value.options : []).flatMap((o): AgentQuestionOption[] => {
    if (!isRecord(o)) return [];
    const label = str(o.label, 60);
    const detail = str(o.detail, 160);
    return label ? [detail ? { label, detail } : { label }] : [];
  });
  if (!id || !question || options.length < 2) return undefined;
  return { id, question, options, allowOther: value.allowOther !== false };
}

function parseArtifact(value: unknown): AgentArtifactRef | null {
  if (!isRecord(value)) return null;
  const id = str(value.id, 64);
  const title = str(value.title, 120);
  const version = Number(value.version);
  if (!id || !title || !Number.isFinite(version)) return null;
  return { id, groupId: str(value.groupId, 64) || id, title, version, kind: 'html', bytes: Number(value.bytes) || 0 };
}

export function parseArtifacts(value: unknown): AgentArtifactRef[] {
  return (Array.isArray(value) ? value : []).map(parseArtifact).filter((a): a is AgentArtifactRef => a !== null);
}

/** 同一个网页改了几版：卡片只留最新那一版（查看时还能切回旧版） */
export function latestArtifacts(list: readonly AgentArtifactRef[]): AgentArtifactRef[] {
  const byGroup = new Map<string, AgentArtifactRef>();
  for (const a of list) {
    const prior = byGroup.get(a.groupId);
    if (!prior || a.version >= prior.version) byGroup.set(a.groupId, a);
  }
  return [...byGroup.values()];
}

/** 存下来的 ai_metadata → AgentExtras（没有就返回空对象） */
export function extrasFromMetadata(meta: Record<string, unknown> | null | undefined): AgentExtras {
  if (!meta) return {};
  const plan = parsePlan(meta.plan);
  const question = parseQuestion(meta.question);
  const artifacts = latestArtifacts(parseArtifacts(meta.artifacts));
  return {
    ...(plan ? { plan } : {}),
    ...(question ? { question } : {}),
    ...(artifacts.length ? { artifacts } : {}),
  };
}

export function hasExtras(extras: AgentExtras | undefined): boolean {
  return Boolean(extras && (extras.plan || extras.question || extras.artifacts?.length || extras.progress));
}

/** 流里的一条事件：是这几种之一就返回更新后的 AgentExtras，不是就返回 null（交给原来的处理） */
export function applyAgentEvent(extras: AgentExtras, event: Record<string, unknown>): AgentExtras | null {
  if ('agentPlan' in event) {
    const plan = parsePlan(event.agentPlan);
    return plan ? { ...extras, plan } : extras;
  }
  if ('agentQuestion' in event) {
    const question = parseQuestion(event.agentQuestion);
    return question ? { ...extras, question } : extras;
  }
  if ('artifactStatus' in event) {
    const s = event.artifactStatus;
    if (!isRecord(s)) return extras;
    return {
      ...extras,
      progress: {
        stage: s.stage === 'failed' ? 'failed' : 'writing',
        title: str(s.title, 120),
        chars: Number(s.chars) || 0,
        ...(s.revising === true ? { revising: true } : {}),
        ...(typeof s.error === 'string' ? { error: s.error.slice(0, 200) } : {}),
      },
    };
  }
  if ('artifact' in event) {
    const artifact = parseArtifact(event.artifact);
    if (!artifact) return extras;
    const { progress: _done, ...rest } = extras;
    return { ...rest, artifacts: latestArtifacts([...(extras.artifacts ?? []), artifact]) };
  }
  return null;
}

/** AgentExtras → 存进前端消息 aiMetadata 的那几个键（和后端 ai_metadata 同名，回答写完时被服务端那份覆盖） */
export function extrasToMetadata(extras: AgentExtras): Record<string, unknown> {
  return {
    plan: extras.plan,
    question: extras.question,
    artifacts: extras.artifacts,
    artifact_progress: extras.progress,
  };
}

/** 前端消息 aiMetadata（可能还在写）→ AgentExtras：比 extrasFromMetadata 多认一个写网页的进度 */
export function extrasFromLiveMetadata(meta: Record<string, unknown> | null | undefined): AgentExtras {
  const base = extrasFromMetadata(meta);
  const p = meta?.artifact_progress;
  if (isRecord(p) && typeof p.title === 'string') {
    return { ...base, progress: { stage: p.stage === 'failed' ? 'failed' : 'writing', title: p.title, chars: Number(p.chars) || 0, ...(p.revising === true ? { revising: true } : {}), ...(typeof p.error === 'string' ? { error: p.error } : {}) } };
  }
  return base;
}

/** 学生点了一个选项：发出去的那句话 */
export function choiceReplyText(option: AgentQuestionOption, lang: 'zh' | 'en'): string {
  if (lang === 'zh') return option.detail ? `我选：${option.label}（${option.detail}）` : `我选：${option.label}`;
  return option.detail ? `I choose: ${option.label} (${option.detail})` : `I choose: ${option.label}`;
}

/** 这条回答后面学生又说过话了，选项卡就算答过了；能认出点的是哪个就标出来 */
export function answeredLabel(question: AgentQuestion, laterUserText: string | null | undefined, choiceLabel?: string | null): string | null {
  if (laterUserText == null) return null;
  if (choiceLabel) return choiceLabel;
  const hit = question.options.find(o => laterUserText.startsWith(`我选：${o.label}`) || laterUserText.startsWith(`I choose: ${o.label}`));
  return hit ? hit.label : '';
}

/**
 * 「自由提问」里说的是不是要动手做的事：要做网页、出题、整理成表或图、做模拟、帮着规划。是的话转给「动手做」模式。
 * 只看说法，宁缺毋滥：漏掉的学生照常得到普通回答，也可以在模式里选「动手做」；画图另有判断（drawRouting），不在这里。
 */
const MAKE_ZH = /(做|生成|制作|整理|设计|搭建|编|出|弄)[^。！？!?\n]{0,16}?(网页|页面|html|H5|测验|小测|自测|测试题|练习题|选择题|题目|闪卡|概念图|思维导图|知识图|知识地图|时间线|时间轴|对比表|比较表|表格|海报|模拟|仿真|小游戏|互动|交互|可视化|图表|学习单|复习卡|演示页)/i;
const PLAN_ZH = /(帮我|帮忙|请你?|给我)(规划|计划|安排|拆解|拆分)|规划一下|分几步|做个计划|列个计划/;
const MAKE_EN = /\b(make|build|create|generate|design)\b.{0,40}\b(web ?page|html|quiz|flash ?cards?|concept map|mind map|timeline|comparison table|poster|simulation|interactive|game|chart)\b|\b(plan|break down)\b.{0,20}\b(steps|my (essay|note|project))\b/i;

export function looksLikeMakerTask(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return MAKE_ZH.test(t) || PLAN_ZH.test(t) || MAKE_EN.test(t);
}

export function formatChars(chars: number, lang: 'zh' | 'en'): string {
  if (chars < 1000) return lang === 'zh' ? `${chars} 字` : `${chars} chars`;
  const k = (chars / 1000).toFixed(chars < 10_000 ? 1 : 0);
  return lang === 'zh' ? `${k}k 字` : `${k}k chars`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
}

/** 下载用的文件名：网页标题，去掉文件名里不能有的字符 */
export function artifactFileName(title: string, version: number): string {
  const base = title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
  return version > 1 ? `${base}-v${version}.html` : `${base}.html`;
}

/** 和后端 agentMaker.ARTIFACT_CSP 一样：不能联网、不能提交表单，只许内联的样式和脚本 */
export const ARTIFACT_CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/** 放进 iframe 之前再写一遍内容安全策略（后端存的时候写过一次；两份策略同时生效，取更严的） */
export function sandboxedDocument(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${meta}`) : `${meta}${html}`;
}
