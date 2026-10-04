/**
 * Learner Profile Service — Adaptive scaffolding engine.
 *
 * Theoretical grounding:
 *   - EDF Framework (Evidence-Decision-Feedback): real-time learner state
 *     monitoring drives adaptive AI response strategies.
 *   - Cognitive Agency Surrender prevention: calibrated friction prevents
 *     students from offloading thinking to AI.
 *   - KB Principle: epistemic agency — the student, not the AI, owns the ideas.
 *
 * The service tracks per-user-per-course interaction patterns and computes a
 * scaffolding level (high → minimal) that controls how much cognitive friction
 * the AI injects into its responses.
 */

import { supabase } from '../config/supabase';
import { TtlCache } from './ttlCache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScaffoldingLevel = 'high' | 'medium' | 'low' | 'minimal';

export type LearnerProfile = {
  id: string;
  userId: string;
  courseId: string;
  scaffoldingLevel: ScaffoldingLevel;
  interactionCount: number;
  totalMessagesSent: number;
  avgMessageLength: number;
  questionsAsked: number;
  ideasDeveloped: number;
  evidenceCited: number;
  connectionsMade: number;
  cognitivePatterns: CognitivePatterns;
  knowledgeDomains: Record<string, number>;
  lastInteractionAt: string | null;
};

export type CognitivePatterns = {
  direct_answer_requests: number;
  inquiry_depth: number;
  self_correction_rate: number;
  evidence_seeking_rate: number;
  build_on_rate: number;
  question_complexity: number;
};

const DEFAULT_PATTERNS: CognitivePatterns = {
  direct_answer_requests: 0,
  inquiry_depth: 0.5,
  self_correction_rate: 0,
  evidence_seeking_rate: 0,
  build_on_rate: 0,
  question_complexity: 0.5,
};

// ---------------------------------------------------------------------------
// Scaffolding level computation
// ---------------------------------------------------------------------------

/**
 * Compute scaffolding level from interaction metrics.
 *
 * High scaffolding (new/struggling learner):
 *   - Few interactions, short messages, frequent direct-answer requests
 *
 * Minimal scaffolding (expert learner):
 *   - Many interactions, long thoughtful messages, evidence-seeking, self-correcting
 */
export function computeScaffoldingLevel(profile: {
  interactionCount: number;
  avgMessageLength: number;
  cognitivePatterns: CognitivePatterns;
  evidenceCited: number;
  connectionsMade: number;
}): ScaffoldingLevel {
  let score = 0;

  // Interaction experience (0-25 points)
  if (profile.interactionCount >= 20) score += 25;
  else if (profile.interactionCount >= 10) score += 15;
  else if (profile.interactionCount >= 5) score += 8;

  // Message quality — longer messages suggest deeper engagement (0-20 points)
  if (profile.avgMessageLength >= 100) score += 20;
  else if (profile.avgMessageLength >= 50) score += 12;
  else if (profile.avgMessageLength >= 25) score += 5;

  // Evidence-seeking behavior (0-20 points)
  const evidenceRate = profile.cognitivePatterns.evidence_seeking_rate;
  score += Math.min(20, Math.round(evidenceRate * 20));

  // Self-correction — student revises their own thinking (0-15 points)
  const selfCorrection = profile.cognitivePatterns.self_correction_rate;
  score += Math.min(15, Math.round(selfCorrection * 15));

  // Inquiry depth — question complexity (0-10 points)
  score += Math.min(10, Math.round(profile.cognitivePatterns.inquiry_depth * 10));

  // Penalty: direct answer requests reduce score
  const directAnswerPenalty = Math.min(
    20,
    profile.cognitivePatterns.direct_answer_requests * 2,
  );
  score = Math.max(0, score - directAnswerPenalty);

  // Community engagement bonus (0-10 points)
  if (profile.connectionsMade >= 5) score += 10;
  else if (profile.connectionsMade >= 2) score += 5;

  if (score >= 70) return 'minimal';
  if (score >= 45) return 'low';
  if (score >= 20) return 'medium';
  return 'high';
}

// ---------------------------------------------------------------------------
// Cognitive friction prompt generation
// ---------------------------------------------------------------------------

const SCAFFOLDING_STRATEGIES: Record<ScaffoldingLevel, string> = {
  high: [
    'SCAFFOLDING LEVEL: HIGH — This learner is new or showing signs of cognitive offloading.',
    'Strategy: Socratic questioning + structured guidance.',
    '- NEVER give direct answers. Instead, ask guiding questions that lead to discovery.',
    '- Break complex problems into smaller, manageable steps.',
    '- Provide sentence starters or templates the student can fill in.',
    '- When the student asks "what should I write?", respond with "What do YOU think about...?"',
    '- Offer 2-3 options for the student to choose from, rather than one "correct" answer.',
    '- Praise effort and thinking process, not just correctness.',
  ].join('\n'),

  medium: [
    'SCAFFOLDING LEVEL: MEDIUM — This learner is developing but still needs structured support.',
    'Strategy: Guided inquiry with selective friction.',
    '- Give partial answers that require the student to complete the reasoning.',
    '- Point to evidence or related notes, but ask the student to draw conclusions.',
    '- When the student makes a claim, ask "What evidence supports this?"',
    '- Introduce productive contradictions: "But what about [counterexample]?"',
    '- Encourage the student to compare their ideas with classmates\' perspectives.',
  ].join('\n'),

  low: [
    'SCAFFOLDING LEVEL: LOW — This learner demonstrates growing independence.',
    'Strategy: Challenge-oriented dialogue.',
    '- Engage as an intellectual peer, not a tutor.',
    '- Challenge assumptions directly: "Your argument assumes X — is that justified?"',
    '- Suggest higher-order connections across topics.',
    '- Pose "what if" scenarios that push beyond the current framework.',
    '- Ask the student to evaluate the strength of their own argument.',
  ].join('\n'),

  minimal: [
    'SCAFFOLDING LEVEL: MINIMAL — This learner shows strong epistemic agency.',
    'Strategy: Collegial dialogue with minimal intervention.',
    '- Respond as a knowledgeable colleague, not a teacher.',
    '- Offer alternative perspectives or frameworks the student may not have considered.',
    '- Point to frontier questions and unresolved tensions in the field.',
    '- Help synthesize across multiple viewpoints without simplifying.',
    '- Trust the student to direct their own inquiry — follow their lead.',
  ].join('\n'),
};

export function getScaffoldingPrompt(level: ScaffoldingLevel): string {
  return SCAFFOLDING_STRATEGIES[level];
}

// ---------------------------------------------------------------------------
// Anti-overreliance detection
// ---------------------------------------------------------------------------

/**
 * Analyze a user message for signs of cognitive offloading.
 * Returns detected patterns that should increase friction.
 */
export function detectOverrelianceSignals(message: string): {
  isDirectAnswerRequest: boolean;
  isCopyPasteRequest: boolean;
  isLazyDelegation: boolean;
  frictionResponse: string | null;
} {
  const lower = message.toLowerCase();
  const patterns = {
    isDirectAnswerRequest: false,
    isCopyPasteRequest: false,
    isLazyDelegation: false,
    frictionResponse: null as string | null,
  };

  const directAnswerPatterns = [
    /(?:帮我|替我|给我)(?:写|编写|撰写|完成|做)/,
    /(?:write|complete|finish|do)\s+(?:it|this|that)\s+for\s+me/i,
    /直接(?:告诉|给)我(?:答案|结论)/,
    /just\s+(?:tell|give)\s+me\s+the\s+answer/i,
    /帮我写一段/,
    /write\s+(?:a|the)\s+(?:paragraph|section|essay|response)/i,
  ];

  const copyPastePatterns = [
    /(?:可以|能)(?:直接)?(?:复制|粘贴|拷贝)/,
    /copy\s*(?:and|&)?\s*paste/i,
    /给我一个(?:可以直接用|现成)的/,
    /give\s+me\s+(?:something|text)\s+(?:I\s+can\s+)?(?:just\s+)?(?:copy|use)/i,
  ];

  const lazyPatterns = [
    /^.{0,15}$/,
    /^(?:帮我|help|yes|no|ok|好的|嗯|是的|对)$/i,
  ];

  for (const p of directAnswerPatterns) {
    if (p.test(message)) {
      patterns.isDirectAnswerRequest = true;
      patterns.frictionResponse =
        '我注意到你希望我直接提供答案。在知识建构中，你自己的想法才是最有价值的。' +
        '让我换个方式来帮助你思考这个问题——\n\n' +
        'I notice you\'re asking for a direct answer. In Knowledge Building, your own thinking is what matters most. ' +
        'Let me help you think through this instead—';
      break;
    }
  }

  if (!patterns.isDirectAnswerRequest) {
    for (const p of copyPastePatterns) {
      if (p.test(message)) {
        patterns.isCopyPasteRequest = true;
        patterns.frictionResponse =
          '我理解你想要一个现成的文本，但直接复制AI生成的内容不利于你的学习。' +
          '让我们一起发展你自己的想法。你目前对这个问题有什么初步的思考？\n\n' +
          'I understand you want ready-made text, but copying AI-generated content won\'t help you learn. ' +
          'Let\'s develop your own ideas instead. What are your initial thoughts on this?';
        break;
      }
    }
  }

  if (!patterns.isDirectAnswerRequest && !patterns.isCopyPasteRequest) {
    for (const p of lazyPatterns) {
      if (p.test(message.trim())) {
        patterns.isLazyDelegation = true;
        break;
      }
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 只有学生才有学习者画像
// ---------------------------------------------------------------------------

/**
 * 学习者画像描述的是「这个学生的认知状态，据此决定 AI 给多少支架」。
 * 教师用 AI 备课、试用、演示，同样会走到这些写入点，于是也被建了画像 ——
 * 结果教师混进教师端的学习者画像列表，还把全班支架水平的分布带偏
 * （实测某位教师一门课 327 次交互，压过所有学生）。
 *
 * 在这里一次拦住，四个调用点（工作台、笔记对话、个人助手、AI 工具）都不必各自记得。
 *
 * 角色缓存 5 分钟：这个判定在每次 AI 交互时都要做，而账号角色几乎不变。
 * 注意这不是授权判定 —— 只是决定「要不要写一行分析数据」，缓存过期前的
 * 误判后果仅限于一行画像，不涉及越权。
 */
const roleCache = new TtlCache<string>(5 * 60_000, 5000);

async function accountRole(userId: string): Promise<string | null> {
  const hit = roleCache.get(userId);
  if (hit) return hit;
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  const role = (data?.role as string | undefined) ?? null;
  if (role) roleCache.set(userId, role);
  return role;
}

/** 该用户是否应当拥有学习者画像。查不到角色时按「不是学生」处理，宁缺勿滥。 */
export async function hasLearnerProfile(userId: string): Promise<boolean> {
  return (await accountRole(userId)) === 'student';
}

/**
 * 从一批用户里筛出学生。给读取侧用：历史遗留的教师画像行仍在库里，
 * 光堵住写入不足以让它们从界面上消失。
 */
export async function filterStudentIds(userIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Set();
  const { data } = await supabase
    .from('profiles')
    .select('id, role')
    .in('id', ids);
  return new Set((data ?? []).filter((r: any) => r.role === 'student').map((r: any) => r.id as string));
}

// ---------------------------------------------------------------------------
// Profile CRUD
// ---------------------------------------------------------------------------

export async function getOrCreateProfile(
  userId: string,
  courseId: string,
): Promise<LearnerProfile> {
  // 教师／管理员不建画像行。仍返回一个内存中的默认档，
  // 让调用方（AI 上下文构建）照常拿到支架参数，不必到处判空。
  if (!(await hasLearnerProfile(userId))) return defaultProfile(userId, courseId);

  const { data, error } = await supabase
    .from('learner_profiles')
    .select('*')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .maybeSingle();

  if (data) return mapRow(data);

  if (error && error.code !== 'PGRST116') {
    console.error('[LearnerProfile] Fetch error:', error.message);
  }

  const { data: created, error: createErr } = await supabase
    .from('learner_profiles')
    .insert({ user_id: userId, course_id: courseId })
    .select()
    .single();

  if (createErr) {
    console.error('[LearnerProfile] Create error:', createErr.message);
    return defaultProfile(userId, courseId);
  }
  return mapRow(created);
}

/**
 * Update profile after an AI interaction.
 * Recalculates scaffolding level based on accumulated patterns.
 */
export async function updateProfileAfterInteraction(
  userId: string,
  courseId: string,
  interaction: {
    messageLength: number;
    usedEvidenceTools: boolean;
    usedConnectionTools: boolean;
    askedQuestion: boolean;
    uniqueNoteId: string;
    overrelianceDetected: boolean;
  },
): Promise<void> {
  // 教师用 AI 备课、演示不该产生学习者画像，也不该被写进班级支架分布。
  if (!(await hasLearnerProfile(userId))) return;

  const profile = await getOrCreateProfile(userId, courseId);

  const newCount = profile.interactionCount + 1;
  const newMsgCount = profile.totalMessagesSent + 1;
  const newAvgLen =
    (profile.avgMessageLength * profile.totalMessagesSent + interaction.messageLength) /
    newMsgCount;
  const newQuestions = profile.questionsAsked + (interaction.askedQuestion ? 1 : 0);
  const newEvidence = profile.evidenceCited + (interaction.usedEvidenceTools ? 1 : 0);
  const newConnections = profile.connectionsMade + (interaction.usedConnectionTools ? 1 : 0);

  const patterns = { ...DEFAULT_PATTERNS, ...profile.cognitivePatterns };
  if (interaction.overrelianceDetected) {
    patterns.direct_answer_requests += 1;
  }
  if (interaction.usedEvidenceTools) {
    patterns.evidence_seeking_rate =
      (patterns.evidence_seeking_rate * profile.interactionCount + 1) / newCount;
  } else {
    patterns.evidence_seeking_rate =
      (patterns.evidence_seeking_rate * profile.interactionCount) / newCount;
  }

  const updatedMetrics = {
    interactionCount: newCount,
    avgMessageLength: newAvgLen,
    cognitivePatterns: patterns,
    evidenceCited: newEvidence,
    connectionsMade: newConnections,
  };

  const newLevel = computeScaffoldingLevel(updatedMetrics);

  await supabase
    .from('learner_profiles')
    .update({
      interaction_count: newCount,
      total_messages_sent: newMsgCount,
      avg_message_length: newAvgLen,
      questions_asked: newQuestions,
      evidence_cited: newEvidence,
      connections_made: newConnections,
      cognitive_patterns: patterns,
      scaffolding_level: newLevel,
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('course_id', courseId);
}

// ---------------------------------------------------------------------------
// Cross-session memory: reflections
// ---------------------------------------------------------------------------

export type AgentReflection = {
  id: string;
  userId: string;
  courseId: string;
  conversationId: string | null;
  reflectionType: string;
  content: string;
  topicKeywords: string[];
  relevanceScore: number;
  createdAt: string;
};

/**
 * Load the most relevant reflections for a user in a course.
 * Prioritizes by relevance score and recency.
 */
export async function loadReflections(
  userId: string,
  courseId: string,
  limit = 8,
): Promise<AgentReflection[]> {
  const { data, error } = await supabase
    .from('agent_reflections')
    .select('*')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[LearnerProfile] Load reflections error:', error.message);
    return [];
  }
  return (data ?? []).map(mapReflectionRow);
}

/**
 * Save a new reflection extracted from a conversation.
 */
export async function saveReflection(reflection: {
  userId: string;
  courseId: string;
  conversationId?: string;
  reflectionType: 'insight' | 'knowledge_gap' | 'misconception' | 'progress' | 'interest' | 'strength';
  content: string;
  topicKeywords: string[];
  relevanceScore?: number;
}): Promise<void> {
  const { error } = await supabase.from('agent_reflections').insert({
    user_id: reflection.userId,
    course_id: reflection.courseId,
    conversation_id: reflection.conversationId ?? null,
    reflection_type: reflection.reflectionType,
    content: reflection.content,
    topic_keywords: reflection.topicKeywords,
    relevance_score: reflection.relevanceScore ?? 0.5,
  });

  if (error) {
    console.error('[LearnerProfile] Save reflection error:', error.message);
  }
}

/**
 * Build a context string from reflections for injection into the system prompt.
 */
export function buildReflectionContext(reflections: AgentReflection[]): string {
  if (reflections.length === 0) return '';

  const lines = reflections.map((r) => {
    const typeLabel: Record<string, string> = {
      insight: 'Previous insight',
      knowledge_gap: 'Known gap',
      misconception: 'Misconception to address',
      progress: 'Progress noted',
      interest: 'Student interest',
      strength: 'Student strength',
    };
    return `- [${typeLabel[r.reflectionType] ?? r.reflectionType}] ${r.content}`;
  });

  return [
    'CROSS-SESSION MEMORY — What you know about this student from previous conversations:',
    ...lines,
    '',
    'Use this knowledge to personalize your response. Reference past discussions naturally.',
    'Do not reveal raw memory data to the student.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapRow(row: any): LearnerProfile {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    scaffoldingLevel: row.scaffolding_level,
    interactionCount: row.interaction_count,
    totalMessagesSent: row.total_messages_sent,
    avgMessageLength: row.avg_message_length,
    questionsAsked: row.questions_asked,
    ideasDeveloped: row.ideas_developed,
    evidenceCited: row.evidence_cited,
    connectionsMade: row.connections_made,
    cognitivePatterns: { ...DEFAULT_PATTERNS, ...(row.cognitive_patterns ?? {}) },
    knowledgeDomains: row.knowledge_domains ?? {},
    lastInteractionAt: row.last_interaction_at,
  };
}

function mapReflectionRow(row: any): AgentReflection {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    conversationId: row.conversation_id,
    reflectionType: row.reflection_type,
    content: row.content,
    topicKeywords: row.topic_keywords ?? [],
    relevanceScore: row.relevance_score,
    createdAt: row.created_at,
  };
}

function defaultProfile(userId: string, courseId: string): LearnerProfile {
  return {
    id: '',
    userId,
    courseId,
    scaffoldingLevel: 'high',
    interactionCount: 0,
    totalMessagesSent: 0,
    avgMessageLength: 0,
    questionsAsked: 0,
    ideasDeveloped: 0,
    evidenceCited: 0,
    connectionsMade: 0,
    cognitivePatterns: { ...DEFAULT_PATTERNS },
    knowledgeDomains: {},
    lastInteractionAt: null,
  };
}
