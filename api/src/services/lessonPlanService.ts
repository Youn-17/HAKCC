import { supabase } from '../config/supabase';
import { streamCompletion, type AgentStreamEvent, type AgentLoopMessage } from './agentLoop';
import { stripHtml, summarizeContent } from './agentTools';
import { detectTriggers, type TriggerResult } from './triggerEngine';
import { decryptProviderApiKey } from './aiProviderConfig';
import { generateWordDoc } from './fileGenerator';
import { getTeacherContext } from './teacherMemoryService';
import { filterStudentIds } from './learnerProfileService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassroomContext {
  recentNotes: Array<{
    id: string;
    title: string;
    contentSnippet: string;
    authorId: string;
    createdAt: string;
  }>;
  participation: {
    totalNotes: number;
    uniqueAuthors: number;
    notesPerAuthor: Record<string, number>;
  };
  triggers: Array<{
    type: string;
    label: string;
    severity: string;
    responseStrategy: string;
    rationale: string;
    noteId: string;
  }>;
  courseGoals: Array<{ title: string; description: string | null; priority: number }>;
  courseMaterials: Array<{ title: string; description: string | null; fileName: string }>;
  learnerProfiles: {
    total: number;
    high: number;
    medium: number;
    low: number;
    minimal: number;
  };
}

export type PlanType = 'full_plan' | 'resources' | 'activities' | 'analysis' | 'inquiry_activity';

export interface LessonPlanObjectives {
  teaching_goals: string[];
  key_points: string[];
  difficulties: string[];
}

export interface LessonPlanActivity {
  title: string;
  duration_min: number;
  phase: string;
  description: string;
  teacher_actions: string[];
  student_actions: string[];
  kb_principle: string;
  scaffolding_notes: string;
}

export interface DiscussionPrompt {
  prompt: string;
  purpose: string;
  expected_depth: string;
}

export interface RubricRow {
  dimension: string;
  excellent: string;
  good: string;
  developing: string;
}

export interface LessonPlanAssessment {
  rubric: RubricRow[];
  formative_checks: string[];
}

export interface AITrigger {
  type: string;
  when: string;
  action: string;
  example_feedback: string;
}

export interface LessonPlanResource {
  type: string;
  title: string;
  content: string;
}

export interface LessonPlanReflection {
  teacher_reflection: string[];
  student_reflection: string[];
}

export interface InquirySetup {
  activity_name: string;
  theoretical_basis: string;
  learning_objectives: string[];
  group_size: number;
  ai_participants: number;
  materials: string[];
  tech_requirements: string[];
  room_setup: string;
}

export interface InquiryRound {
  round_number: number;
  duration_min: number;
  theme: string;
  questions: Array<{
    question: string;
    category: string;
    difficulty: string;
    evaluation_hint: string;
  }>;
  student_instructions: string;
  evaluation_criteria: string[];
}

export interface InquiryEvaluation {
  dimensions: Array<{
    name: string;
    description: string;
    indicators: string[];
  }>;
  worksheet_prompts: string[];
  scoring_guide: string;
}

export interface InquiryKBReflection {
  principle_connections: Array<{
    principle: string;
    connection: string;
    forum_prompt: string;
  }>;
  rise_above_prompt: string;
  community_knowledge_question: string;
}

export interface LessonPlanContent {
  objectives?: LessonPlanObjectives;
  activities?: LessonPlanActivity[];
  discussion_prompts?: DiscussionPrompt[];
  assessment?: LessonPlanAssessment;
  ai_triggers?: AITrigger[];
  resources?: LessonPlanResource[];
  reflection?: LessonPlanReflection;
  inquiry_setup?: InquirySetup;
  inquiry_rounds?: InquiryRound[];
  inquiry_evaluation?: InquiryEvaluation;
  inquiry_kb_reflection?: InquiryKBReflection;
}

export type LessonPlanStreamEvent =
  | { type: 'context_ready'; context: ClassroomContext }
  | { type: 'section_start'; section: string }
  | { type: 'token'; content: string }
  | { type: 'section_complete'; section: string; data: unknown }
  | { type: 'done'; plan: LessonPlanContent }
  | { type: 'error'; error: string };

export interface GenerateParams {
  courseId: string;
  spaceId?: string;
  planType: PlanType;
  topic?: string;
  durationMinutes: number;
  kbPrinciples: string[];
  contextNotes?: string;
  providerId: string;
  model: string;
  apiKey: string;
  endpointUrl?: string | null;
  lang: 'zh' | 'en';
  courseTitle: string;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Phase 1: Gather classroom context (no LLM)
// ---------------------------------------------------------------------------

export async function gatherClassroomContext(
  courseId: string,
  spaceId?: string,
): Promise<ClassroomContext> {
  const targetSpaceId = spaceId ?? await resolveDefaultSpace(courseId);

  const [notesRes, goalsRes, materialsRes, profilesRes, triggerRes] = await Promise.all([
    supabase
      .from('notes')
      .select('id, title, content, author_id, created_at')
      .eq('space_id', targetSpaceId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('course_goals')
      .select('title, description, priority')
      .eq('course_id', courseId)
      .order('priority', { ascending: false }),
    supabase
      .from('course_materials')
      .select('title, description, file_name')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('learner_profiles')
      .select('user_id, scaffolding_level')
      .eq('course_id', courseId),
    targetSpaceId ? safeDetectTriggers(targetSpaceId) : Promise.resolve([]),
  ]);

  const notes = (notesRes.data ?? []) as Array<{
    id: string; title: string | null; content: string | null;
    author_id: string; created_at: string;
  }>;

  const recentNotes = notes.map((n) => ({
    id: n.id,
    title: n.title ?? 'Untitled',
    contentSnippet: summarizeContent(stripHtml(n.content ?? ''), 200),
    authorId: n.author_id,
    createdAt: n.created_at,
  }));

  const authorCounts: Record<string, number> = {};
  for (const n of notes) {
    authorCounts[n.author_id] = (authorCounts[n.author_id] ?? 0) + 1;
  }

  // 只统计学生。教师用 AI 备课也会（历史上）留下画像行，
  // 混进来会把全班的支架水平分布带偏，而这个分布正是备课建议的依据。
  const rawProfiles = (profilesRes.data ?? []) as Array<{ user_id: string; scaffolding_level: number }>;
  const studentIds = await filterStudentIds(rawProfiles.map((p) => p.user_id));
  const profiles = rawProfiles.filter((p) => studentIds.has(p.user_id));
  let high = 0, medium = 0, low = 0, minimal = 0;
  for (const p of profiles) {
    const lv = p.scaffolding_level ?? 50;
    if (lv >= 75) high++;
    else if (lv >= 50) medium++;
    else if (lv >= 25) low++;
    else minimal++;
  }

  const triggers = (triggerRes as TriggerResult[]).map((t) => ({
    type: t.trigger_type,
    label: t.label.zh,
    severity: t.severity,
    responseStrategy: t.response_strategy,
    rationale: t.rationale,
    noteId: t.note_id,
  }));

  return {
    recentNotes,
    participation: {
      totalNotes: notes.length,
      uniqueAuthors: Object.keys(authorCounts).length,
      notesPerAuthor: authorCounts,
    },
    triggers,
    courseGoals: (goalsRes.data ?? []).map((g: any) => ({
      title: g.title as string,
      description: g.description as string | null,
      priority: (g.priority as number) ?? 0,
    })),
    courseMaterials: (materialsRes.data ?? []).map((m: any) => ({
      title: m.title as string,
      description: m.description as string | null,
      fileName: (m.file_name as string) ?? '',
    })),
    learnerProfiles: { total: profiles.length, high, medium, low, minimal },
  };
}

async function resolveDefaultSpace(courseId: string): Promise<string> {
  const { data } = await supabase
    .from('spaces')
    .select('id')
    .eq('course_id', courseId)
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? '';
}

async function safeDetectTriggers(spaceId: string): Promise<TriggerResult[]> {
  try {
    return await detectTriggers(spaceId);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Phase 2: LLM streaming generation
// ---------------------------------------------------------------------------

export async function* generateLessonPlanStream(
  params: GenerateParams,
): AsyncGenerator<LessonPlanStreamEvent> {
  const context = await gatherClassroomContext(params.courseId, params.spaceId);
  yield { type: 'context_ready', context };

  // Inject cross-module teacher memory
  let crossModuleCtx = '';
  if (params.userId) {
    try {
      crossModuleCtx = await getTeacherContext({
        userId: params.userId,
        courseId: params.courseId,
        excludeSource: 'lesson_prep',
        lang: params.lang,
      });
    } catch { /* non-critical */ }
  }

  const basePrompt = buildSystemPrompt(params, context);
  const systemPrompt = crossModuleCtx
    ? `${basePrompt}\n\n${crossModuleCtx}`
    : basePrompt;
  const userMessage = buildUserMessage(params);

  const messages: AgentLoopMessage[] = [
    { role: 'user', content: userMessage },
  ];

  let fullText = '';

  try {
    const stream = streamCompletion({
      providerId: params.providerId,
      model: params.model,
      apiKey: params.apiKey,
      endpointUrl: params.endpointUrl,
      systemPrompt,
      messages,
      // 完整教案的 JSON 实测 5.7k 字，4000 不够；DeepSeek 开着思考时 max_tokens 还要分给推理，
      // 2026-09-10 就是这样被截成半截 JSON 解析失败。关掉思考、预算给足。
      maxTokens: 8000,
      temperature: 0.7,
      disableThinking: true,
    });

    for await (const event of stream) {
      if (event.type === 'token') {
        fullText += event.content;
        yield { type: 'token', content: event.content };
      } else if (event.type === 'thinking') {
        // Ignore reasoning tokens for lesson plan
      }
    }

    const plan = parseLessonPlanContent(fullText);
    if (plan) {
      yield { type: 'done', plan };
    } else {
      yield { type: 'error', error: 'Failed to parse lesson plan output' };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Generation failed';
    yield { type: 'error', error: msg };
  }
}

// ---------------------------------------------------------------------------
// System prompt construction
// ---------------------------------------------------------------------------

const KB_PRINCIPLES_REF: Record<string, { zh: string; en: string; desc_zh: string; desc_en: string }> = {
  'real-ideas': {
    zh: '真实想法', en: 'Real Ideas, Authentic Problems',
    desc_zh: '学生从真实的好奇心出发提出问题', desc_en: 'Students start from genuine curiosity',
  },
  'improvable': {
    zh: '可改进的想法', en: 'Improvable Ideas',
    desc_zh: '所有想法都是暂时的、可改进的', desc_en: 'All ideas are tentative and improvable',
  },
  'diversity': {
    zh: '想法多样性', en: 'Idea Diversity',
    desc_zh: '鼓励多种视角和解释', desc_en: 'Encourage multiple perspectives',
  },
  'rise-above': {
    zh: '升华综合', en: 'Rise Above',
    desc_zh: '综合多元想法形成更高层次理解', desc_en: 'Synthesize diverse ideas into higher-level understanding',
  },
  'agency': {
    zh: '认知责任', en: 'Epistemic Agency',
    desc_zh: '学生对自己的学习承担认知责任', desc_en: 'Students take cognitive responsibility',
  },
  'community': {
    zh: '社区知识', en: 'Community Knowledge',
    desc_zh: '知识是社区共同建构的', desc_en: 'Knowledge is co-constructed by the community',
  },
};

const PLAN_TYPE_SECTIONS: Record<PlanType, string[]> = {
  full_plan: ['objectives', 'activities', 'discussion_prompts', 'assessment', 'ai_triggers', 'resources', 'reflection'],
  resources: ['resources', 'assessment', 'discussion_prompts'],
  activities: ['activities', 'discussion_prompts', 'reflection'],
  analysis: ['objectives', 'activities', 'ai_triggers', 'reflection'],
  inquiry_activity: ['inquiry_setup', 'inquiry_rounds', 'inquiry_evaluation', 'inquiry_kb_reflection', 'activities', 'reflection'],
};

function buildSystemPrompt(params: GenerateParams, ctx: ClassroomContext): string {
  const zh = params.lang === 'zh';
  const sections = PLAN_TYPE_SECTIONS[params.planType];

  const principleDescriptions = params.kbPrinciples
    .map((id) => KB_PRINCIPLES_REF[id])
    .filter(Boolean)
    .map((p) => zh ? `- ${p.zh}：${p.desc_zh}` : `- ${p.en}: ${p.desc_en}`)
    .join('\n');

  const contextBlock = formatClassroomContext(ctx, zh);

  const sectionSchemas = sections.map((s) => SECTION_SCHEMA[s] ?? '').join(',\n');

  const isInquiry = params.planType === 'inquiry_activity';
  const roleDesc = isInquiry
    ? (zh
        ? '你是一个专业的知识建构（Knowledge Building）探究活动设计专家。你擅长设计如图灵测试、辩论、角色扮演等结构化探究活动，将认知科学理论与 KB 原则深度融合。请用中文生成活动方案。'
        : 'You are a professional Knowledge Building inquiry activity designer, specializing in structured activities like Turing tests, debates, and role-plays that deeply integrate cognitive science with KB principles.')
    : (zh
        ? '你是一个专业的知识建构（Knowledge Building）教学设计专家。请用中文生成教案。'
        : 'You are a professional Knowledge Building lesson design expert.');

  const qualityNote = isInquiry
    ? (zh
        ? [
          '每个 section 的内容必须实质充分、具体可操作。',
          '探究活动要有明确的理论依据、详细的轮次结构、具体的评估标准。',
          '每个 inquiry_round 必须包含 3-5 个不同类别的问题，附带评判线索。',
          'inquiry_kb_reflection 必须将活动发现与知识建构原则深度关联，生成可直接用于 Knowledge Forum 的发帖引导问题。',
          '活动设计要确保认知责任（epistemic agency）落在学生身上——是学生在判断、分析、归纳，而不是教师预设答案。',
        ].join('\n')
        : 'Each section must be substantive. Rounds must have 3-5 categorized questions. KB reflections must connect findings to principles with forum prompts. Ensure epistemic agency stays with students.')
    : (zh
        ? '每个 section 的内容必须实质充分、具体可操作。活动设计要明确师生行为。'
        : 'Each section must be substantive and actionable. Activities must specify teacher and student actions.');

  return [
    roleDesc,
    '',
    zh ? '## 知识建构原则（本次教案需融入）' : '## KB Principles to embed',
    principleDescriptions || (zh ? '（未指定）' : '(none specified)'),
    '',
    zh ? '## 当前课堂数据' : '## Current classroom data',
    contextBlock,
    '',
    zh ? '## 输出要求' : '## Output requirements',
    zh
      ? '你必须输出一个纯 JSON 对象。不要添加 markdown 围栏（```）、不要添加任何解释文字。只输出 JSON。'
      : 'Output a pure JSON object. No markdown fences, no explanation text. JSON only.',
    '',
    zh ? 'JSON 结构如下：' : 'JSON structure:',
    '{',
    sectionSchemas,
    '}',
    '',
    qualityNote,
  ].join('\n');
}

const SECTION_SCHEMA: Record<string, string> = {
  objectives: `  "objectives": {
    "teaching_goals": ["目标1", "目标2", "..."],
    "key_points": ["重点1", "..."],
    "difficulties": ["难点1", "..."]
  }`,
  activities: `  "activities": [
    {
      "title": "活动名称",
      "duration_min": 10,
      "phase": "warm_up | explore | discuss | reflect | assess",
      "description": "活动描述",
      "teacher_actions": ["教师行为1", "..."],
      "student_actions": ["学生行为1", "..."],
      "kb_principle": "对应的KB原则",
      "scaffolding_notes": "教学支架说明"
    }
  ]`,
  discussion_prompts: `  "discussion_prompts": [
    {
      "prompt": "讨论问题",
      "purpose": "问题目的",
      "expected_depth": "surface | moderate | deep"
    }
  ]`,
  assessment: `  "assessment": {
    "rubric": [
      {
        "dimension": "评估维度",
        "excellent": "优秀标准",
        "good": "良好标准",
        "developing": "发展中标准"
      }
    ],
    "formative_checks": ["形成性评估检查点1", "..."]
  }`,
  ai_triggers: `  "ai_triggers": [
    {
      "type": "T1-T6 类型",
      "when": "触发条件",
      "action": "AI应采取的行动",
      "example_feedback": "反馈示例"
    }
  ]`,
  resources: `  "resources": [
    {
      "type": "worksheet | prompt_card | reading | reference",
      "title": "资源标题",
      "content": "资源内容"
    }
  ]`,
  reflection: `  "reflection": {
    "teacher_reflection": ["教师反思问题1", "..."],
    "student_reflection": ["学生反思问题1", "..."]
  }`,
  inquiry_setup: `  "inquiry_setup": {
    "activity_name": "活动名称",
    "theoretical_basis": "理论依据（说明本活动基于什么理论或研究）",
    "learning_objectives": ["学习目标1", "学习目标2", "..."],
    "group_size": 6,
    "ai_participants": 3,
    "materials": ["所需材料1", "..."],
    "tech_requirements": ["技术要求1", "..."],
    "room_setup": "教室布置说明"
  }`,
  inquiry_rounds: `  "inquiry_rounds": [
    {
      "round_number": 1,
      "duration_min": 7,
      "theme": "本轮主题",
      "questions": [
        {
          "question": "具体问题",
          "category": "factual | creative | emotional | philosophical | trap",
          "difficulty": "easy | medium | hard",
          "evaluation_hint": "评判线索提示"
        }
      ],
      "student_instructions": "本轮学生操作说明",
      "evaluation_criteria": ["本轮评判标准1", "..."]
    }
  ]`,
  inquiry_evaluation: `  "inquiry_evaluation": {
    "dimensions": [
      {
        "name": "评估维度名称",
        "description": "维度说明",
        "indicators": ["具体指标1", "..."]
      }
    ],
    "worksheet_prompts": ["评估工作表问题1", "..."],
    "scoring_guide": "评分指南"
  }`,
  inquiry_kb_reflection: `  "inquiry_kb_reflection": {
    "principle_connections": [
      {
        "principle": "KB原则名称",
        "connection": "活动与原则的关联说明",
        "forum_prompt": "Knowledge Forum 发帖引导问题"
      }
    ],
    "rise_above_prompt": "升华综合引导：引导学生超越具体发现，形成更高层次理解的问题",
    "community_knowledge_question": "社区知识建构问题：引导集体知识进步的讨论问题"
  }`,
};

function formatClassroomContext(ctx: ClassroomContext, zh: boolean): string {
  const lines: string[] = [];

  lines.push(zh
    ? `笔记总数：${ctx.participation.totalNotes}，参与学生：${ctx.participation.uniqueAuthors} 人`
    : `Total notes: ${ctx.participation.totalNotes}, Contributors: ${ctx.participation.uniqueAuthors}`);

  if (ctx.learnerProfiles.total > 0) {
    lines.push(zh
      ? `学习者水平分布：高${ctx.learnerProfiles.high} / 中${ctx.learnerProfiles.medium} / 低${ctx.learnerProfiles.low} / 初级${ctx.learnerProfiles.minimal}`
      : `Learner levels: high=${ctx.learnerProfiles.high} mid=${ctx.learnerProfiles.medium} low=${ctx.learnerProfiles.low} minimal=${ctx.learnerProfiles.minimal}`);
  }

  if (ctx.courseGoals.length > 0) {
    lines.push(zh ? '课程目标：' : 'Course goals:');
    for (const g of ctx.courseGoals.slice(0, 5)) {
      lines.push(`  - ${g.title}`);
    }
  }

  if (ctx.courseMaterials.length > 0) {
    lines.push(zh ? `已上传教学资料：${ctx.courseMaterials.length} 个` : `Uploaded materials: ${ctx.courseMaterials.length}`);
    for (const m of ctx.courseMaterials.slice(0, 5)) {
      lines.push(`  - ${m.title} (${m.fileName})`);
    }
  }

  if (ctx.triggers.length > 0) {
    lines.push(zh ? `检测到的教学触发器：` : `Detected triggers:`);
    for (const t of ctx.triggers.slice(0, 8)) {
      lines.push(`  - [${t.type}] ${t.label}: ${t.rationale.slice(0, 100)}`);
    }
  }

  if (ctx.recentNotes.length > 0) {
    lines.push(zh ? '近期学生笔记摘要：' : 'Recent student notes:');
    for (const n of ctx.recentNotes.slice(0, 10)) {
      lines.push(`  - "${n.title}": ${n.contentSnippet.slice(0, 120)}`);
    }
  }

  return lines.join('\n');
}

function buildUserMessage(params: GenerateParams): string {
  const zh = params.lang === 'zh';
  const parts: string[] = [];

  if (zh) {
    parts.push(`请为课程「${params.courseTitle}」生成一份${params.durationMinutes}分钟的知识建构教案。`);
    if (params.topic) parts.push(`探究主题：${params.topic}`);
    const typeLabel: Record<PlanType, string> = {
      full_plan: '完整教案（包含所有 section）',
      resources: '教学资源（工作表、讨论卡片、评估量规）',
      activities: '探究活动设计（活动、讨论、反思）',
      analysis: '教学分析与优化建议（基于当前课堂数据）',
      inquiry_activity: '结构化探究活动方案（含活动设置、轮次结构、评估标准、KB反思框架）',
    };
    parts.push(`生成类型：${typeLabel[params.planType]}`);
    if (params.contextNotes) parts.push(`教师补充说明：${params.contextNotes}`);
  } else {
    parts.push(`Generate a ${params.durationMinutes}-minute Knowledge Building lesson plan for "${params.courseTitle}".`);
    if (params.topic) parts.push(`Inquiry topic: ${params.topic}`);
    const typeLabel: Record<PlanType, string> = {
      full_plan: 'Full lesson plan (all sections)',
      resources: 'Teaching resources (worksheets, prompt cards, rubrics)',
      activities: 'Inquiry activity design (activities, discussion, reflection)',
      analysis: 'Teaching analysis and optimization (based on classroom data)',
      inquiry_activity: 'Structured inquiry activity (setup, rounds, evaluation, KB reflection)',
    };
    parts.push(`Type: ${typeLabel[params.planType]}`);
    if (params.contextNotes) parts.push(`Additional context: ${params.contextNotes}`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// JSON parsing with repair
// ---------------------------------------------------------------------------

export function parseLessonPlanContent(raw: string): LessonPlanContent | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Find the outermost { ... }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonStr) as LessonPlanContent;
  } catch {
    // Attempt repair: trailing commas
    const repaired = jsonStr
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/'/g, '"');
    try {
      return JSON.parse(repaired) as LessonPlanContent;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Word export
// ---------------------------------------------------------------------------

export async function exportLessonPlanToWord(
  plan: { title: string; content: LessonPlanContent; topic?: string | null; duration_minutes?: number },
  lang: 'zh' | 'en',
): Promise<{ fileId: string; fileName: string }> {
  const zh = lang === 'zh';
  const c = plan.content;
  const sections: Array<{ heading: string; content: string; items?: string[] }> = [];

  if (c.objectives) {
    sections.push({
      heading: zh ? '教学目标' : 'Teaching Objectives',
      content: '',
      items: [
        ...(c.objectives.teaching_goals ?? []).map((g) => (zh ? `目标：${g}` : `Goal: ${g}`)),
        ...(c.objectives.key_points ?? []).map((p) => (zh ? `重点：${p}` : `Key: ${p}`)),
        ...(c.objectives.difficulties ?? []).map((d) => (zh ? `难点：${d}` : `Difficulty: ${d}`)),
      ],
    });
  }

  if (c.activities && c.activities.length > 0) {
    for (const act of c.activities) {
      sections.push({
        heading: `${act.title} (${act.duration_min}${zh ? '分钟' : 'min'} · ${act.phase})`,
        content: act.description,
        items: [
          ...(act.teacher_actions ?? []).map((a) => (zh ? `教师：${a}` : `Teacher: ${a}`)),
          ...(act.student_actions ?? []).map((a) => (zh ? `学生：${a}` : `Student: ${a}`)),
          act.scaffolding_notes ? (zh ? `支架：${act.scaffolding_notes}` : `Scaffold: ${act.scaffolding_notes}`) : '',
        ].filter(Boolean),
      });
    }
  }

  if (c.discussion_prompts && c.discussion_prompts.length > 0) {
    sections.push({
      heading: zh ? '讨论引导问题' : 'Discussion Prompts',
      content: '',
      items: c.discussion_prompts.map((p, i) =>
        `${i + 1}. ${p.prompt} — ${zh ? '目的' : 'Purpose'}: ${p.purpose}`,
      ),
    });
  }

  if (c.assessment) {
    const rubricLines = (c.assessment.rubric ?? []).map((r) =>
      `${r.dimension}: ${zh ? '优秀' : 'Excellent'}=${r.excellent}; ${zh ? '良好' : 'Good'}=${r.good}; ${zh ? '发展中' : 'Developing'}=${r.developing}`,
    );
    sections.push({
      heading: zh ? '评估量规' : 'Assessment Rubric',
      content: '',
      items: [...rubricLines, ...(c.assessment.formative_checks ?? []).map((ck) => (zh ? `检查点：${ck}` : `Check: ${ck}`))],
    });
  }

  if (c.ai_triggers && c.ai_triggers.length > 0) {
    sections.push({
      heading: zh ? 'AI 介入计划' : 'AI Intervention Plan',
      content: '',
      items: c.ai_triggers.map((t) =>
        `[${t.type}] ${t.when} → ${t.action}`,
      ),
    });
  }

  if (c.resources && c.resources.length > 0) {
    sections.push({
      heading: zh ? '教学资源' : 'Teaching Resources',
      content: '',
      items: c.resources.map((r) => `[${r.type}] ${r.title}: ${r.content.slice(0, 200)}`),
    });
  }

  if (c.reflection) {
    sections.push({
      heading: zh ? '课后反思' : 'Reflection',
      content: '',
      items: [
        ...(c.reflection.teacher_reflection ?? []).map((r) => (zh ? `教师反思：${r}` : `Teacher: ${r}`)),
        ...(c.reflection.student_reflection ?? []).map((r) => (zh ? `学生反思：${r}` : `Student: ${r}`)),
      ],
    });
  }

  if (c.inquiry_setup) {
    sections.push({
      heading: zh ? '探究活动设置' : 'Inquiry Activity Setup',
      content: c.inquiry_setup.theoretical_basis,
      items: [
        zh ? `活动名称：${c.inquiry_setup.activity_name}` : `Activity: ${c.inquiry_setup.activity_name}`,
        zh ? `分组：${c.inquiry_setup.group_size}人/组，含${c.inquiry_setup.ai_participants}个AI` : `Groups: ${c.inquiry_setup.group_size}/group, ${c.inquiry_setup.ai_participants} AI`,
        ...(c.inquiry_setup.learning_objectives ?? []).map((o) => (zh ? `目标：${o}` : `Objective: ${o}`)),
        ...(c.inquiry_setup.materials ?? []).map((m) => (zh ? `材料：${m}` : `Material: ${m}`)),
        c.inquiry_setup.room_setup ? (zh ? `教室布置：${c.inquiry_setup.room_setup}` : `Room: ${c.inquiry_setup.room_setup}`) : '',
      ].filter(Boolean),
    });
  }

  if (c.inquiry_rounds && c.inquiry_rounds.length > 0) {
    for (const round of c.inquiry_rounds) {
      sections.push({
        heading: `${zh ? '第' : 'Round '}${round.round_number}${zh ? '轮' : ''}: ${round.theme} (${round.duration_min}${zh ? '分钟' : 'min'})`,
        content: round.student_instructions,
        items: [
          ...(round.questions ?? []).map((q) => `[${q.category}/${q.difficulty}] ${q.question}`),
          ...(round.evaluation_criteria ?? []).map((c) => (zh ? `评判标准：${c}` : `Criterion: ${c}`)),
        ],
      });
    }
  }

  if (c.inquiry_evaluation) {
    sections.push({
      heading: zh ? '探究评估框架' : 'Inquiry Evaluation',
      content: c.inquiry_evaluation.scoring_guide,
      items: [
        ...(c.inquiry_evaluation.dimensions ?? []).map((d) => `${d.name}: ${d.description}`),
        ...(c.inquiry_evaluation.worksheet_prompts ?? []).map((p, i) => `${i + 1}. ${p}`),
      ],
    });
  }

  if (c.inquiry_kb_reflection) {
    sections.push({
      heading: zh ? 'KB 反思框架' : 'KB Reflection Framework',
      content: c.inquiry_kb_reflection.rise_above_prompt,
      items: [
        ...(c.inquiry_kb_reflection.principle_connections ?? []).map((pc) =>
          `[${pc.principle}] ${pc.connection} → Forum: ${pc.forum_prompt}`
        ),
        c.inquiry_kb_reflection.community_knowledge_question
          ? (zh ? `社区知识问题：${c.inquiry_kb_reflection.community_knowledge_question}` : `Community: ${c.inquiry_kb_reflection.community_knowledge_question}`)
          : '',
      ].filter(Boolean),
    });
  }

  const subtitle = [
    plan.topic ?? '',
    plan.duration_minutes ? `${plan.duration_minutes}${zh ? '分钟' : ' min'}` : '',
    new Date().toLocaleDateString(zh ? 'zh-CN' : 'en-US'),
  ].filter(Boolean).join(' · ');

  return generateWordDoc({
    title: plan.title,
    subtitle,
    sections,
    lang,
  });
}
