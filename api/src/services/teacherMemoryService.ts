import { supabase } from '../config/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemorySource = 'lesson_prep' | 'analytics' | 'assessment' | 'chat';
export type MemoryType = 'insight' | 'decision' | 'observation' | 'plan' | 'action';

export interface TeacherMemory {
  id: string;
  user_id: string;
  course_id: string;
  source: MemorySource;
  memory_type: MemoryType;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WriteMemoryParams {
  userId: string;
  courseId: string;
  source: MemorySource;
  memoryType: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function writeMemory(params: WriteMemoryParams): Promise<TeacherMemory | null> {
  const { userId, courseId, source, memoryType, content, metadata } = params;
  if (!content.trim()) return null;

  const trimmed = content.trim().slice(0, 500);

  // Dedup: skip if identical content from same source exists within 1 hour
  const { data: existing } = await supabase
    .from('teacher_agent_memory')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .eq('source', source)
    .eq('content', trimmed)
    .gte('created_at', new Date(Date.now() - 3600_000).toISOString())
    .limit(1);

  if (existing && existing.length > 0) return null;

  const { data, error } = await supabase
    .from('teacher_agent_memory')
    .insert({
      user_id: userId,
      course_id: courseId,
      source,
      memory_type: memoryType,
      content: trimmed,
      metadata: metadata ?? {},
    })
    .select('*')
    .single();

  if (error) {
    console.error('[teacherMemory] write failed:', error.message);
    return null;
  }
  return data as TeacherMemory;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function readMemories(params: {
  userId: string;
  courseId: string;
  source?: MemorySource;
  limit?: number;
}): Promise<TeacherMemory[]> {
  let query = supabase
    .from('teacher_agent_memory')
    .select('*')
    .eq('user_id', params.userId)
    .eq('course_id', params.courseId)
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 30);

  if (params.source) {
    query = query.eq('source', params.source);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[teacherMemory] read failed:', error.message);
    return [];
  }
  return (data ?? []) as TeacherMemory[];
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteMemory(userId: string, memoryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('teacher_agent_memory')
    .delete()
    .eq('id', memoryId)
    .eq('user_id', userId);
  return !error;
}

// ---------------------------------------------------------------------------
// Cross-module context — formatted text for system prompt injection
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<MemorySource, { zh: string; en: string }> = {
  lesson_prep: { zh: '备课助手', en: 'Lesson Prep' },
  analytics: { zh: '学情分析', en: 'Analytics' },
  assessment: { zh: '教学评估', en: 'Assessment' },
  chat: { zh: 'AI 对话', en: 'Chat' },
};

const TYPE_LABELS: Record<MemoryType, { zh: string; en: string }> = {
  insight: { zh: '发现', en: 'Insight' },
  decision: { zh: '决策', en: 'Decision' },
  observation: { zh: '观察', en: 'Observation' },
  plan: { zh: '计划', en: 'Plan' },
  action: { zh: '操作', en: 'Action' },
};

export async function getTeacherContext(params: {
  userId: string;
  courseId: string;
  excludeSource?: MemorySource;
  lang?: 'zh' | 'en';
}): Promise<string> {
  const { userId, courseId, excludeSource, lang = 'zh' } = params;
  const zh = lang === 'zh';

  // 1. Recent memories (last 20, excluding caller's own source)
  const memories = await readMemories({ userId, courseId, limit: 20 });
  const filtered = excludeSource
    ? memories.filter((m) => m.source !== excludeSource)
    : memories;

  // 2. Recent lesson plans (last 5)
  const { data: plans } = await supabase
    .from('lesson_plans')
    .select('title, plan_type, topic, kb_principles, status, created_at')
    .eq('course_id', courseId)
    .eq('created_by', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(5);

  // 3. Recent chat summaries (last 5 conversations, latest assistant message each)
  const { data: recentConvs } = await supabase
    .from('agent_conversations')
    .select('id, title, agent_mode, created_at')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .eq('agent_type', 'personal')
    .order('updated_at', { ascending: false })
    .limit(5);

  // Build formatted context
  const sections: string[] = [];

  // Section: Cross-module memories
  if (filtered.length > 0) {
    const header = zh ? '## 跨模块教学记忆' : '## Cross-module Teaching Memory';
    const items = filtered.slice(0, 15).map((m) => {
      const src = zh ? SOURCE_LABELS[m.source].zh : SOURCE_LABELS[m.source].en;
      const tp = zh ? TYPE_LABELS[m.memory_type].zh : TYPE_LABELS[m.memory_type].en;
      const date = new Date(m.created_at).toLocaleDateString(zh ? 'zh-CN' : 'en-US', {
        month: 'short', day: 'numeric',
      });
      return `- [${src}/${tp}] ${date}: ${m.content}`;
    });
    sections.push(`${header}\n${items.join('\n')}`);
  }

  // Section: Recent lesson plans
  if (plans && plans.length > 0) {
    const header = zh ? '## 近期教案' : '## Recent Lesson Plans';
    const items = plans.map((p: any) => {
      const date = new Date(p.created_at).toLocaleDateString(zh ? 'zh-CN' : 'en-US', {
        month: 'short', day: 'numeric',
      });
      const principles = (p.kb_principles as string[])?.join(', ') || '';
      return `- ${date}: ${p.title}${principles ? ` (KB: ${principles})` : ''}`;
    });
    sections.push(`${header}\n${items.join('\n')}`);
  }

  // Section: Recent conversations
  if (recentConvs && recentConvs.length > 0) {
    const header = zh ? '## 近期 AI 对话' : '## Recent AI Conversations';
    const items = recentConvs.map((c: any) => {
      const date = new Date(c.created_at).toLocaleDateString(zh ? 'zh-CN' : 'en-US', {
        month: 'short', day: 'numeric',
      });
      return `- ${date}: ${c.title}`;
    });
    sections.push(`${header}\n${items.join('\n')}`);
  }

  if (sections.length === 0) return '';

  const preamble = zh
    ? '以下是该教师在其他教学工具中的近期活动和发现，请参考这些上下文来提供更连贯、更有针对性的帮助：'
    : 'Below is the teacher\'s recent activity across other teaching tools. Use this context to provide more coherent and targeted assistance:';

  return `${preamble}\n\n${sections.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// Auto-write helpers — called by other modules
// ---------------------------------------------------------------------------

export async function writeLessonPrepMemory(params: {
  userId: string;
  courseId: string;
  title: string;
  planType: string;
  topic?: string | null;
  kbPrinciples?: string[];
}): Promise<void> {
  const { userId, courseId, title, planType, topic, kbPrinciples } = params;
  const principles = kbPrinciples?.join('、') || '';
  const content = topic
    ? `生成了教案「${title}」(${planType})，主题：${topic}${principles ? `，KB原则：${principles}` : ''}`
    : `生成了教案「${title}」(${planType})${principles ? `，KB原则：${principles}` : ''}`;

  await writeMemory({
    userId,
    courseId,
    source: 'lesson_prep',
    memoryType: 'action',
    content,
    metadata: { plan_type: planType, topic, kb_principles: kbPrinciples },
  });
}

export async function writeAnalyticsMemory(params: {
  userId: string;
  courseId: string;
  insights: string[];
}): Promise<void> {
  for (const insight of params.insights.slice(0, 3)) {
    await writeMemory({
      userId: params.userId,
      courseId: params.courseId,
      source: 'analytics',
      memoryType: 'insight',
      content: insight,
    });
  }
}

export async function writeAssessmentMemory(params: {
  userId: string;
  courseId: string;
  insights: string[];
}): Promise<void> {
  for (const insight of params.insights.slice(0, 3)) {
    await writeMemory({
      userId: params.userId,
      courseId: params.courseId,
      source: 'assessment',
      memoryType: 'insight',
      content: insight,
    });
  }
}

// ---------------------------------------------------------------------------
// Prune — keep last 100 per user+course
// ---------------------------------------------------------------------------

export async function pruneMemories(userId: string, courseId: string): Promise<void> {
  const { data } = await supabase
    .from('teacher_agent_memory')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
    .range(100, 999);

  if (data && data.length > 0) {
    const ids = data.map((d: any) => d.id);
    await supabase
      .from('teacher_agent_memory')
      .delete()
      .in('id', ids);
  }
}
