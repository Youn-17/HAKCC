import { supabase } from '../config/supabase';
import { ensureSpaceAccess } from './accessControl';
import { callTavilySearch } from './tavilySearch';
import { decryptProviderApiKey } from './aiProviderConfig';
import {
  generateWordDoc, generateTableDoc, generateChart,
  engagementBarChartConfig, timelineChartConfig, comparisonBarChartConfig,
} from './fileGenerator';
import {
  saveReflection,
  getOrCreateProfile,
  type ScaffoldingLevel,
} from './learnerProfileService';
import { detectTriggers } from './triggerEngine';
import { semanticSearchNotes, embedSpaceNotes } from './embeddingService';
import { searchKnowledgeBase } from './knowledgeBase';
import { writeMemory, type MemoryType } from './teacherMemoryService';
import { generateImage } from './modelRouter';
import { generateNoteImage } from './noteImage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolExecutionResult = {
  success: boolean;
  data: unknown;
  error?: string;
};

export type ToolContext = {
  noteId: string;
  spaceId: string;
  courseId: string;
  userId: string;
  userRole: 'student' | 'teacher' | 'admin';
  noteTitle: string;
  noteContent: string;
};

export type ToolAccess = 'all' | 'teacher' | 'student';

export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolExecutionResult>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function summarizeContent(content: string, maxLength: number): string {
  const text = stripHtml(content);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

export function safeParseArgs(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

type RegisteredTool = {
  definition: ToolDefinition;
  executor: ToolExecutor;
  access: ToolAccess;
};

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  registerTool(
    name: string,
    definition: ToolDefinition,
    executor: ToolExecutor,
    access: ToolAccess = 'all',
  ): void {
    this.tools.set(name, { definition, executor, access });
  }

  /** Return tool definitions filtered by the caller's role. */
  getToolsForRole(
    role: 'student' | 'teacher' | 'admin',
    _agentMode?: string,
  ): ToolDefinition[] {
    const out: ToolDefinition[] = [];
    this.tools.forEach((tool) => {
      if (this.accessAllowed(tool.access, role)) {
        out.push(tool.definition);
      }
    });
    return out;
  }

  /** Execute a registered tool by name. Never throws — returns an error result. */
  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, data: null, error: `Unknown tool: ${name}` };
    }
    if (!this.accessAllowed(tool.access, context.userRole)) {
      return { success: false, data: null, error: `Access denied for tool: ${name}` };
    }
    try {
      return await tool.executor(args, context);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Tool execution failed';
      return { success: false, data: null, error: message };
    }
  }

  hasToolAccess(name: string, role: 'student' | 'teacher' | 'admin'): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    return this.accessAllowed(tool.access, role);
  }

  // ---- internal ----

  private accessAllowed(
    access: ToolAccess,
    role: 'student' | 'teacher' | 'admin',
  ): boolean {
    if (access === 'all') return true;
    if (access === 'teacher') return role === 'teacher' || role === 'admin';
    if (access === 'student') return role === 'student';
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tool Executors
// ---------------------------------------------------------------------------

// ── read_note ──────────────────────────────────────────────────

const executeReadNote: ToolExecutor = async (_args, context) => {
  const { data, error } = await supabase
    .from('notes')
    .select('id, title, content, author_id, space_id, created_at, updated_at')
    .eq('id', context.noteId)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    return { success: false, data: null, error: 'Note not found' };
  }

  return {
    success: true,
    data: {
      id: data.id,
      title: data.title ?? 'Untitled Note',
      content: stripHtml((data.content as string) ?? ''),
      authorId: data.author_id,
      spaceId: data.space_id,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  };
};

// ── search_course_materials ────────────────────────────────────

/**
 * 检索课程知识库 —— 教师和学生上传的材料，解析并切片之后存在这里。
 *
 * 做成工具而不是无条件塞进系统提示词：不是每个问题都需要翻材料，
 * 而每次都塞进去既费 token 又会把无关内容混进上下文。让 agent 自己决定何时查。
 */
const executeSearchCourseMaterials: ToolExecutor = async (args, context) => {
  const query = String(args.query ?? '').trim();
  if (!query) return { success: false, data: null, error: 'query is required' };
  const limit = clampLimit(args.limit, 5);

  // 按调用者检索，口径同 mayEnterSpace：别组空间里的附件不给
  const hits = await searchKnowledgeBase(context.courseId, { id: context.userId, role: context.userRole }, query, limit);
  if (hits.length === 0) {
    return {
      success: true,
      data: {
        results: [],
        message: '这门课的知识库里没有找到相关内容。不要凭印象编造，如实说明没有依据。',
      },
    };
  }

  return {
    success: true,
    data: {
      results: hits.map(h => ({
        source: h.title,
        section: h.headingPath,
        excerpt: h.content,
        similarity: Number(h.similarity.toFixed(3)),
      })),
      message: `在 ${hits.length} 段课程材料里找到相关内容。引用时请写明出自哪一份材料。`,
    },
  };
};

// ── search_notes ───────────────────────────────────────────────

const executeSearchNotes: ToolExecutor = async (args, context) => {
  const query = String(args.query ?? '').trim();
  if (!query) {
    return { success: false, data: null, error: 'query is required' };
  }
  const limit = clampLimit(args.limit, 8);

  // Try semantic search first (vector similarity via pgvector)
  try {
    const semanticResults = await semanticSearchNotes(
      query,
      context.spaceId,
      context.courseId,
      limit,
    );
    if (semanticResults.length > 0) {
      return {
        success: true,
        data: {
          searchMethod: 'semantic',
          results: semanticResults
            .filter((r) => r.noteId !== context.noteId)
            .map((r) => ({
              id: r.noteId,
              title: r.title,
              snippet: summarizeContent(stripHtml(r.content), 260),
              score: Math.round(r.similarity * 100) / 100,
            })),
        },
      };
    }
  } catch {
    // Fall through to keyword search
  }

  // Fallback: keyword-based ranking
  const { data: notes } = await supabase
    .from('notes')
    .select('id, title, content, created_at')
    .eq('space_id', context.spaceId)
    .is('deleted_at', null)
    .limit(80);

  const ranked = rankNotes(query, context.noteId, notes ?? [], limit);
  return { success: true, data: { searchMethod: 'keyword', results: ranked } };
};

// ── get_note_context ───────────────────────────────────────────

const executeGetNoteContext: ToolExecutor = async (_args, context) => {
  // Fetch build-on relations
  const { data: relations } = await supabase
    .from('relations')
    .select('id, relation_type, source_note_id, target_note_id, created_at')
    .or(`source_note_id.eq.${context.noteId},target_note_id.eq.${context.noteId}`)
    .order('created_at', { ascending: false })
    .limit(24);

  const relationRows = relations ?? [];
  const otherIds = Array.from(
    new Set(
      relationRows.map((r: any) =>
        r.source_note_id === context.noteId
          ? r.target_note_id
          : r.source_note_id,
      ),
    ),
  )
    .filter(Boolean)
    .slice(0, 12);

  let relatedSummaries: Array<{
    id: string;
    title: string;
    direction: string;
    relationType: string;
  }> = [];

  if (otherIds.length > 0) {
    const { data: relatedNotes } = await supabase
      .from('notes')
      .select('id, title')
      .in('id', otherIds)
      .is('deleted_at', null);
    const noteMap = new Map(
      (relatedNotes ?? []).map((n: any) => [n.id, n]),
    );

    relatedSummaries = relationRows
      .map((r: any) => {
        const direction =
          r.source_note_id === context.noteId ? 'outgoing' : 'incoming';
        const otherId =
          direction === 'outgoing' ? r.target_note_id : r.source_note_id;
        const other = noteMap.get(otherId);
        if (!other) return null;
        return {
          id: other.id as string,
          title: (other.title as string) ?? 'Untitled Note',
          direction,
          relationType: r.relation_type as string,
        };
      })
      .filter(Boolean) as typeof relatedSummaries;
  }

  return {
    success: true,
    data: {
      noteId: context.noteId,
      title: context.noteTitle,
      contentSummary: summarizeContent(context.noteContent, 900),
      spaceId: context.spaceId,
      courseId: context.courseId,
      buildOnRelations: relatedSummaries,
    },
  };
};

// ── analyze_argument ───────────────────────────────────────────

const executeAnalyzeArgument: ToolExecutor = async (args, context) => {
  const targetNoteId = String(args.note_id ?? context.noteId);

  let content = context.noteContent;
  let title = context.noteTitle;

  // If a different note was requested, fetch it
  if (targetNoteId !== context.noteId) {
    const { data, error } = await supabase
      .from('notes')
      .select('id, title, content')
      .eq('id', targetNoteId)
      .eq('space_id', context.spaceId)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      return { success: false, data: null, error: 'Target note not found in this space' };
    }
    content = (data.content as string) ?? '';
    title = (data.title as string) ?? 'Untitled Note';
  }

  const plainText = stripHtml(content);

  // Prepare structured context for the Agent Loop's next reasoning step.
  // This tool does NOT call AI itself — it extracts textual signals that
  // help the agent produce a better argument analysis.
  return {
    success: true,
    data: {
      noteId: targetNoteId,
      title,
      wordCount: plainText.split(/\s+/).filter(Boolean).length,
      fullText: plainText,
      hasQuestions: /\?|？/.test(plainText),
      hasCitations: /https?:\/\/|reference|cited|according to|研究|引用|文献/i.test(plainText),
      hasEvidence: /because|evidence|data|result|experiment|研究表明|证据|实验|数据/i.test(plainText),
      analysisHint:
        'Use the full text above to identify: (1) the main claim or theory, ' +
        '(2) supporting evidence or reasoning, (3) gaps or missing warrants, ' +
        '(4) questions raised. Return your analysis in those four categories.',
    },
  };
};

// ── compare_notes ──────────────────────────────────────────────

const executeCompareNotes: ToolExecutor = async (args, context) => {
  const noteIds = Array.isArray(args.note_ids)
    ? (args.note_ids as string[]).slice(0, 6)
    : [];
  if (noteIds.length < 2) {
    return {
      success: false,
      data: null,
      error: 'At least two note_ids are required',
    };
  }

  const { data: notes, error } = await supabase
    .from('notes')
    .select('id, title, content, author_id, created_at')
    .in('id', noteIds)
    .eq('space_id', context.spaceId)
    .is('deleted_at', null);

  if (error) {
    return { success: false, data: null, error: error.message };
  }

  const found = (notes ?? []).map((n: any) => ({
    id: n.id as string,
    title: (n.title as string) ?? 'Untitled Note',
    contentSummary: summarizeContent((n.content as string) ?? '', 600),
    authorId: n.author_id as string,
    createdAt: n.created_at as string,
  }));

  return {
    success: true,
    data: {
      notes: found,
      comparisonHint:
        'Compare the notes above for: (1) shared themes or claims, ' +
        '(2) contrasting perspectives, (3) potential connections or build-on opportunities, ' +
        '(4) gaps that could be addressed by combining ideas.',
    },
  };
};

// ── web_search ─────────────────────────────────────────────────

const executeWebSearch: ToolExecutor = async (args, context) => {
  const query = String(args.query ?? '').trim();
  if (!query) {
    return { success: false, data: null, error: 'query is required' };
  }
  const maxResults = clampLimit(args.max_results, 5, 1, 10);

  const tavilyApiKey = await getCourseTavilyApiKey(context.courseId);
  if (!tavilyApiKey) {
    return {
      success: false,
      data: null,
      error: 'Web search is not configured for this course (no Tavily API key)',
    };
  }

  try {
    const result = await callTavilySearch(
      tavilyApiKey,
      query,
      'basic',
      maxResults,
      false,
    );
    return {
      success: true,
      data: {
        results: (result.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content.slice(0, 520),
          score: r.score,
        })),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Web search failed';
    return { success: false, data: null, error: message };
  }
};

// ── generate_image (all) ───────────────────────────────────────
// Text-to-image via the DMX aggregator with model-tier failover.

/**
 * 生图工具。实现在 noteImage.ts —— 「直接画一张」那条快路走同一份，
 * 两处各写一份的话厂商顺序和转存逻辑迟早会漂。
 */
const executeGenerateImage: ToolExecutor = async (args, context) => {
  const prompt = String(args.prompt ?? '').trim();
  if (!prompt) {
    return { success: false, data: null, error: 'prompt is required' };
  }

  const result = await generateNoteImage(context.courseId ?? null, prompt, {
    size: typeof args.size === 'string' ? args.size : undefined,
    model: typeof args.model === 'string' ? args.model : undefined,
    aspectRatio: typeof args.aspect_ratio === 'string' ? args.aspect_ratio : undefined,
  });
  if (!result.ok) return { success: false, data: null, error: result.error };

  return {
    success: true,
    data: {
      image_markdown: `![${prompt.slice(0, 60).replace(/[\[\]]/g, '')}](${result.url})`,
      url: result.url,
      model: result.model,
      instruction: '把 image_markdown 的内容原样嵌入你的回复正文，用户就能直接看到这张图片。',
    },
  };
};

// ── find_sources (student) ─────────────────────────────────────

const executeFindSources: ToolExecutor = async (args, context) => {
  const claim = String(args.claim ?? '').trim();
  if (!claim) {
    return { success: false, data: null, error: 'claim is required' };
  }
  const maxResults = clampLimit(args.max_results, 5, 1, 10);

  const tavilyApiKey = await getCourseTavilyApiKey(context.courseId);
  if (!tavilyApiKey) {
    return {
      success: false,
      data: null,
      error: 'Source search is not configured for this course (no Tavily API key)',
    };
  }

  // Augment the claim to bias toward academic / educational sources
  const searchQuery = `academic evidence for: ${claim}`;

  try {
    const result = await callTavilySearch(
      tavilyApiKey,
      searchQuery,
      'advanced',
      maxResults,
      true,
    );
    return {
      success: true,
      data: {
        claim,
        sources: (result.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content.slice(0, 520),
          relevanceScore: r.score,
        })),
        summary: result.answer ?? null,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Source search failed';
    return { success: false, data: null, error: message };
  }
};

// ── lesson_scaffold (teacher) ──────────────────────────────────

const executeLessonScaffold: ToolExecutor = async (args, context) => {
  const learningObjectives = String(args.learning_objectives ?? '').trim();
  if (!learningObjectives) {
    return {
      success: false,
      data: null,
      error: 'learning_objectives is required',
    };
  }

  const kbPrinciples = Array.isArray(args.kb_principles)
    ? (args.kb_principles as string[])
    : [];

  // Fetch recent student notes to ground the scaffold in actual activity
  const { data: recentNotes } = await supabase
    .from('notes')
    .select('id, title, content, created_at')
    .eq('space_id', context.spaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  const noteSummaries = (recentNotes ?? []).map((n: any) => ({
    id: n.id as string,
    title: (n.title as string) ?? 'Untitled Note',
    contentSummary: summarizeContent((n.content as string) ?? '', 200),
    createdAt: n.created_at as string,
  }));

  return {
    success: true,
    data: {
      learningObjectives,
      kbPrinciples:
        kbPrinciples.length > 0
          ? kbPrinciples
          : [
              'Real Ideas, Authentic Problems',
              'Idea Diversity',
              'Improvable Ideas',
              'Rise Above',
              'Community Knowledge',
            ],
      recentStudentNotes: noteSummaries,
      scaffoldHint:
        'Using the learning objectives, KB principles, and recent student notes above, ' +
        'generate a lesson plan with: (1) warm-up prompt or driving question, ' +
        '(2) suggested KB activities (e.g., build-on chains, rise-above notes), ' +
        '(3) formative assessment checkpoints, (4) reflection prompts.',
    },
  };
};

// ── class_analytics (teacher) ──────────────────────────────────

const executeClassAnalytics: ToolExecutor = async (args, context) => {
  const metric = String(args.metric ?? 'all');

  const results: Record<string, unknown> = { spaceId: context.spaceId };

  // Participation: count notes per author
  if (metric === 'all' || metric === 'participation') {
    const { data: notes } = await supabase
      .from('notes')
      .select('id, author_id, created_at')
      .eq('space_id', context.spaceId)
      .is('deleted_at', null);

    const authorCounts = new Map<string, number>();
    for (const note of (notes ?? []) as Array<{ id: string; author_id: string; created_at: string }>) {
      authorCounts.set(
        note.author_id,
        (authorCounts.get(note.author_id) ?? 0) + 1,
      );
    }
    results.participation = {
      totalNotes: (notes ?? []).length,
      uniqueAuthors: authorCounts.size,
      notesPerAuthor: Object.fromEntries(authorCounts),
    };
  }

  // Connections: count relations in this space's notes
  if (metric === 'all' || metric === 'connections') {
    const { data: spaceNotes } = await supabase
      .from('notes')
      .select('id')
      .eq('space_id', context.spaceId)
      .is('deleted_at', null);

    const noteIds = (spaceNotes ?? []).map((n: any) => n.id as string);
    let connectionCount = 0;
    if (noteIds.length > 0) {
      const { count } = await supabase
        .from('relations')
        .select('id', { count: 'exact', head: true })
        .or(
          noteIds
            .slice(0, 50)
            .map((id) => `source_note_id.eq.${id}`)
            .join(','),
        );
      connectionCount = count ?? 0;
    }
    results.connections = { totalConnections: connectionCount };
  }

  // Build-on depth: longest chain via relations
  if (metric === 'all' || metric === 'buildon_depth') {
    const { data: spaceNotes } = await supabase
      .from('notes')
      .select('id')
      .eq('space_id', context.spaceId)
      .is('deleted_at', null);

    const noteIds = (spaceNotes ?? []).map((n: any) => n.id as string);
    let maxDepth = 0;
    if (noteIds.length > 0) {
      const { data: buildOnRelations } = await supabase
        .from('relations')
        .select('source_note_id, target_note_id')
        .eq('relation_type', 'build_on')
        .or(
          noteIds
            .slice(0, 50)
            .map((id) => `source_note_id.eq.${id}`)
            .join(','),
        );

      // Build adjacency and compute max depth via BFS
      const children = new Map<string, string[]>();
      for (const r of (buildOnRelations ?? []) as Array<{ source_note_id: string; target_note_id: string }>) {
        const list = children.get(r.target_note_id) ?? [];
        list.push(r.source_note_id);
        children.set(r.target_note_id, list);
      }

      // Find root notes (no incoming build-on edges)
      const childSet = new Set(
        (buildOnRelations ?? []).map((r: any) => r.source_note_id as string),
      );
      const roots = noteIds.filter(
        (id) => !childSet.has(id) && children.has(id),
      );

      for (const root of roots) {
        const depth = bfsMaxDepth(root, children);
        if (depth > maxDepth) maxDepth = depth;
      }
    }
    results.buildonDepth = { maxChainLength: maxDepth };
  }

  return { success: true, data: results };
};

// ── suggest_triggers (teacher) ─────────────────────────────────

const executeSuggestTriggers: ToolExecutor = async (args, context) => {
  const focus = String(args.focus ?? '').trim();

  // Gather recent notes and their basic statistics to ground the suggestions
  const { data: recentNotes } = await supabase
    .from('notes')
    .select('id, title, content, author_id, created_at, updated_at')
    .eq('space_id', context.spaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(30);

  const notes = (recentNotes ?? []) as Array<{
    id: string;
    title: string | null;
    content: string | null;
    author_id: string;
    created_at: string;
    updated_at: string;
  }>;

  // Compute simple pattern signals
  const shortNotes = notes.filter(
    (n) => stripHtml(n.content ?? '').split(/\s+/).filter(Boolean).length < 30,
  );
  const stagnant = notes.filter(
    (n) =>
      new Date(n.updated_at).getTime() < Date.now() - 48 * 60 * 60 * 1000,
  );
  const noQuestion = notes.filter(
    (n) => !/\?|？/.test(stripHtml(n.content ?? '')),
  );

  return {
    success: true,
    data: {
      focus: focus || 'general',
      totalNotesAnalyzed: notes.length,
      patterns: {
        shortNotesCount: shortNotes.length,
        stagnantNotesCount: stagnant.length,
        notesWithoutQuestionsCount: noQuestion.length,
      },
      noteSamples: notes.slice(0, 8).map((n) => ({
        id: n.id,
        title: n.title ?? 'Untitled Note',
        contentSummary: summarizeContent(n.content ?? '', 200),
        wordCount: stripHtml(n.content ?? '').split(/\s+/).filter(Boolean)
          .length,
        createdAt: n.created_at,
      })),
      triggerHint:
        'Based on the note patterns above, suggest AI auto-feedback triggers from the T1-T6 taxonomy: ' +
        'T1 (idea initiation), T2 (idea improvement), T3 (rise above), ' +
        'T4 (evidence use), T5 (community knowledge), T6 (reflective assessment). ' +
        'For each suggested trigger, specify: trigger type, condition, and example feedback message.',
    },
  };
};

// ---------------------------------------------------------------------------
// Context-bridging tools (Sprint 4)
// ---------------------------------------------------------------------------

const executeListNoteDiscussions: ToolExecutor = async (_args, context) => {
  const { data: threads } = await supabase
    .from('note_conversation_threads')
    .select('id, note_id, target_type, provider_id, model, created_by, updated_at')
    .eq('space_id', context.spaceId)
    .eq('target_type', 'ai')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(15);

  if (!threads || threads.length === 0) {
    return { success: true, data: { discussions: [], count: 0 } };
  }

  const noteIds = [...new Set(threads.map((t: any) => t.note_id as string))];
  const { data: notes } = await supabase
    .from('notes')
    .select('id, title')
    .in('id', noteIds);

  const noteMap = new Map((notes ?? []).map((n: any) => [n.id, n.title ?? 'Untitled']));

  const threadIds = threads.map((t: any) => t.id as string);
  const { data: msgCounts } = await supabase
    .from('note_conversation_messages')
    .select('thread_id')
    .in('thread_id', threadIds);

  const countMap = new Map<string, number>();
  for (const m of msgCounts ?? []) {
    const tid = (m as any).thread_id as string;
    countMap.set(tid, (countMap.get(tid) ?? 0) + 1);
  }

  const discussions = threads.map((t: any) => ({
    threadId: t.id,
    noteId: t.note_id,
    noteTitle: noteMap.get(t.note_id as string) ?? 'Untitled',
    messageCount: countMap.get(t.id as string) ?? 0,
    lastActive: t.updated_at,
  }));

  return {
    success: true,
    data: {
      discussions,
      count: discussions.length,
      hint: 'These are active AI conversations at the note level. Use read_note to see a specific note\'s content, or search_notes to find related discussions.',
    },
  };
};

/**
 * space_id 是模型自己填的参数。同一门课不等于进得去：绑定小组的空间只对本组开放，
 * 不查这一道，学生一句「总结一下那个空间」就能读到别组的笔记。
 * 教师也查：个人助手里的教师只需是课程成员，凭学生验证码入课的教师账号在课里就是普通成员；
 * 创建者和课程管理员 ensureSpaceAccess 本来就放行。
 */
async function mayEnterSpace(spaceId: string, context: ToolContext): Promise<boolean> {
  try {
    await ensureSpaceAccess(spaceId, { id: context.userId, role: context.userRole });
    return true;
  } catch {
    return false;
  }
}

const executeGetWorkspaceSummary: ToolExecutor = async (args, context) => {
  let targetCourseId = String(args.course_id ?? context.courseId);
  let targetSpaceId = String(args.space_id ?? context.spaceId);

  // Validate that any overridden space belongs to the current course
  if (targetSpaceId !== context.spaceId || targetCourseId !== context.courseId) {
    const { data: spaceCheck } = await supabase
      .from('spaces')
      .select('id')
      .eq('id', targetSpaceId)
      .eq('course_id', context.courseId)
      .maybeSingle();
    // 进不去的和不存在的一样处理：退回当前空间，也不让模型知道那个空间在
    const enterable = spaceCheck && (targetSpaceId === context.spaceId || await mayEnterSpace(targetSpaceId, context));
    if (!enterable) {
      targetSpaceId = context.spaceId;
      targetCourseId = context.courseId;
    }
  }

  const [notesRes, relationsRes, authorsRes] = await Promise.all([
    supabase
      .from('notes')
      .select('id, title, content, author_id, created_at, updated_at')
      .eq('space_id', targetSpaceId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(30),
    supabase
      .from('relations')
      .select('id')
      .eq('space_id', targetSpaceId)
      .is('deleted_at', null),
    supabase
      .from('notes')
      .select('author_id')
      .eq('space_id', targetSpaceId)
      .is('deleted_at', null),
  ]);

  const notes = (notesRes.data ?? []) as Array<{
    id: string; title: string | null; content: string | null;
    author_id: string; created_at: string; updated_at: string;
  }>;
  const uniqueAuthors = new Set(
    ((authorsRes.data ?? []) as Array<{ author_id: string }>).map(n => n.author_id),
  );

  const recentNotes = notes.slice(0, 8).map(n => ({
    title: n.title ?? 'Untitled',
    snippet: summarizeContent(n.content ?? '', 120),
    updatedAt: n.updated_at,
  }));

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const activeToday = notes.filter(
    n => new Date(n.updated_at).getTime() > oneDayAgo,
  ).length;

  return {
    success: true,
    data: {
      courseId: targetCourseId,
      spaceId: targetSpaceId,
      totalNotes: notes.length,
      totalRelations: (relationsRes.data ?? []).length,
      uniqueContributors: uniqueAuthors.size,
      notesActiveToday: activeToday,
      recentNotes,
      hint: 'This is an overview of the workspace. Use search_notes or read_note for specific content.',
    },
  };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clampLimit(
  value: unknown,
  fallback: number,
  min = 1,
  max = 20,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

/** Rank notes against a keyword query (same algorithm as noteConversationTools). */
function rankNotes(
  query: string,
  currentNoteId: string,
  notes: Array<Record<string, unknown>>,
  limit: number,
) {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  return notes
    .filter((n) => (n.id as string) !== currentNoteId)
    .map((n) => {
      const title = (n.title as string) ?? 'Untitled Note';
      const content = stripHtml((n.content as string) ?? '');
      const titleLower = title.toLowerCase();
      const contentLower = content.toLowerCase();
      const score = terms.reduce((total, term) => {
        const t = term.toLowerCase();
        let s = total;
        if (titleLower.includes(t)) s += 3;
        if (contentLower.includes(t)) s += 1;
        return s;
      }, 0);
      return {
        id: n.id as string,
        title,
        snippet: summarizeContent(content, 260),
        score,
      };
    })
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function tokenize(query: string): string[] {
  const normalized = query.replace(
    /[，。！？；、,.!?;:()[\]{}"'`~]/g,
    ' ',
  );
  const tokens = normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length > 0) return Array.from(new Set(tokens)).slice(0, 12);
  const compact = normalized.trim();
  if (!compact) return [];
  return [compact];
}

/** BFS max depth from a root node through an adjacency list. */
function bfsMaxDepth(
  root: string,
  children: Map<string, string[]>,
): number {
  let depth = 0;
  let frontier = [root];
  const visited = new Set<string>([root]);
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const child of children.get(node) ?? []) {
        if (!visited.has(child)) {
          visited.add(child);
          next.push(child);
        }
      }
    }
    if (next.length > 0) depth += 1;
    frontier = next;
  }
  return depth;
}

/** Fetch the Tavily API key for a course (same pattern as noteConversations). */
async function getCourseTavilyApiKey(
  courseId: string,
): Promise<string | null> {
  const { data: config } = await supabase
    .from('teacher_ai_configs')
    .select('api_key_encrypted, is_verified')
    .eq('course_id', courseId)
    .eq('provider_id', 'tavily')
    .maybeSingle();

  if (!config?.api_key_encrypted) return null;
  return decryptProviderApiKey(config.api_key_encrypted);
}

// ---------------------------------------------------------------------------
// Cross-layer bridging executors
// ---------------------------------------------------------------------------

const executeGetPersonalHistory: ToolExecutor = async (args, context) => {
  const limit = clampLimit(args.limit, 5, 1, 20);

  const { data: conversations } = await supabase
    .from('agent_conversations')
    .select('id, title, agent_mode, course_id, updated_at')
    .eq('user_id', context.userId)
    .eq('agent_type', 'personal')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (!conversations || conversations.length === 0) {
    return {
      success: true,
      data: { conversations: [], hint: 'No personal AI conversations found for this user.' },
    };
  }

  const convIds = conversations.map((c: any) => c.id as string);
  const { data: messages } = await supabase
    .from('agent_messages')
    .select('conversation_id, role, content, created_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false });

  const msgByConv = new Map<string, Array<{ role: string; content: string }>>();
  for (const m of (messages ?? []) as any[]) {
    const list = msgByConv.get(m.conversation_id) ?? [];
    if (list.length < 4) list.push({ role: m.role, content: m.content?.slice(0, 200) ?? '' });
    msgByConv.set(m.conversation_id, list);
  }

  const result = conversations.map((c: any) => ({
    title: c.title,
    agentMode: c.agent_mode,
    updatedAt: c.updated_at,
    recentMessages: (msgByConv.get(c.id) ?? []).reverse(),
  }));

  return {
    success: true,
    data: {
      conversations: result,
      count: result.length,
      hint: 'These are the user\'s recent personal AI conversations. Use this context to provide continuity and avoid repeating suggestions.',
    },
  };
};

// ---------------------------------------------------------------------------
// Document generation executors
// ---------------------------------------------------------------------------

const executeGenerateSummaryDoc: ToolExecutor = async (args, context) => {
  const maxNotes = clampLimit(args.max_notes, 20, 5, 50);
  const format = String(args.format ?? 'outline');
  const topic = args.topic ? String(args.topic) : null;
  const lang = (context as any).lang === 'en' ? 'en' : 'zh';

  let query = supabase
    .from('notes')
    .select('id, title, content, author_id, created_at, updated_at')
    .eq('space_id', context.spaceId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(maxNotes);

  if (topic) {
    const safeTopic = topic.replace(/[%_(),.*\\]/g, '');
    if (safeTopic) {
      query = query.or(`title.ilike.%${safeTopic}%,content.ilike.%${safeTopic}%`);
    }
  }

  const { data: notes, error } = await query;
  if (error) return { success: false, data: null, error: error.message };
  if (!notes || notes.length === 0) {
    return { success: true, data: { noteCount: 0, hint: 'No notes found. Cannot generate document.' } };
  }

  const themeMap = new Map<string, Array<{ title: string; content: string; author: string; date: string }>>();
  for (const n of notes) {
    const title = (n as any).title ?? 'Untitled';
    const content = stripHtml(summarizeContent((n as any).content ?? '', 800));
    const firstWord = title.split(/\s+/)[0] || 'General';
    const theme = firstWord.length > 1 ? firstWord : 'General';
    if (!themeMap.has(theme)) themeMap.set(theme, []);
    themeMap.get(theme)!.push({ title, content, author: (n as any).author_id?.slice(0, 8) ?? '?', date: (n as any).updated_at });
  }

  const sections = Array.from(themeMap.entries()).map(([theme, entries]) => ({
    heading: theme,
    content: entries.map(e => `${e.title}\n${e.content}`).join('\n\n'),
    items: format === 'bullet_points' ? entries.map(e => `${e.title} — ${e.content.slice(0, 120)}`) : undefined,
  }));

  try {
    const result = await generateWordDoc({
      title: topic ? `${topic} ${lang === 'zh' ? '笔记总结报告' : 'Notes Summary'}` : (lang === 'zh' ? '知识建构笔记总结报告' : 'Knowledge Building Notes Summary'),
      subtitle: `${notes.length} ${lang === 'zh' ? '篇笔记' : 'notes'} · ${new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')}`,
      sections,
      lang,
    });

    return {
      success: true,
      data: {
        fileId: result.fileId,
        fileName: result.fileName,
        downloadUrl: `/api/files/${result.fileId}?name=${encodeURIComponent(result.fileName)}`,
        noteCount: notes.length,
        themeCount: themeMap.size,
        hint: `Word document generated successfully with ${notes.length} notes organized into ${themeMap.size} themes. Provide the download link to the user: [${result.fileName}](/api/files/${result.fileId}?name=${encodeURIComponent(result.fileName)})`,
      },
    };
  } catch (genErr) {
    return { success: false, data: null, error: `Document generation failed: ${(genErr as Error).message}` };
  }
};

const executeExportNotes: ToolExecutor = async (args, context) => {
  const includeRelations = args.include_relations !== false;
  const noteIds = Array.isArray(args.note_ids) ? args.note_ids as string[] : null;
  const maxNotes = clampLimit(args.max_notes, 50, 1, 200);
  const lang = (context as any).lang === 'en' ? 'en' : 'zh';

  let notesQuery = supabase
    .from('notes')
    .select('id, title, content, author_id, space_id, created_at, updated_at')
    .eq('space_id', context.spaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (noteIds && noteIds.length > 0) {
    notesQuery = notesQuery.in('id', noteIds);
  } else {
    notesQuery = notesQuery.limit(maxNotes);
  }

  const { data: notes, error } = await notesQuery;
  if (error) return { success: false, data: null, error: error.message };
  if (!notes || notes.length === 0) {
    return { success: true, data: { noteCount: 0, hint: 'No notes found to export.' } };
  }

  let relations: Array<{ sourceId: string; targetId: string; type: string }> = [];
  if (includeRelations) {
    const ids = notes.map((n: any) => n.id);
    const { data: rels } = await supabase
      .from('relations')
      .select('source_id, target_id, relation_type')
      .eq('space_id', context.spaceId)
      .is('deleted_at', null)
      .in('source_id', ids);
    relations = (rels ?? []).map((r: any) => ({
      sourceId: r.source_id, targetId: r.target_id, type: r.relation_type ?? 'build-on',
    }));
  }

  const sections = notes.map((n: any) => ({
    heading: n.title ?? 'Untitled',
    content: stripHtml(n.content ?? ''),
    items: relations
      .filter(r => r.sourceId === n.id)
      .map(r => `→ Build-on: ${notes.find((nn: any) => nn.id === r.targetId)?.title ?? r.targetId}`),
  }));

  try {
    const result = await generateWordDoc({
      title: lang === 'zh' ? '笔记导出' : 'Notes Export',
      subtitle: `${notes.length} ${lang === 'zh' ? '篇笔记' : 'notes'} · ${relations.length} ${lang === 'zh' ? '条关系' : 'relations'}`,
      sections,
      lang,
    });

    return {
      success: true,
      data: {
        fileId: result.fileId,
        fileName: result.fileName,
        downloadUrl: `/api/files/${result.fileId}?name=${encodeURIComponent(result.fileName)}`,
        noteCount: notes.length,
        relationCount: relations.length,
        hint: `Exported ${notes.length} notes with ${relations.length} relations to Word document. Download: [${result.fileName}](/api/files/${result.fileId}?name=${encodeURIComponent(result.fileName)})`,
      },
    };
  } catch (genErr) {
    return { success: false, data: null, error: `Export failed: ${(genErr as Error).message}` };
  }
};

// ---------------------------------------------------------------------------
// Data analysis executors
// ---------------------------------------------------------------------------

const executeAnalyzeEngagement: ToolExecutor = async (args, context) => {
  const days = clampLimit(args.days, 7, 1, 90);
  const groupBy = String(args.group_by ?? 'student');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const lang = (context as any).lang === 'en' ? 'en' : 'zh';

  const { data: notes, error } = await supabase
    .from('notes')
    .select('id, author_id, created_at, updated_at')
    .eq('space_id', context.spaceId)
    .is('deleted_at', null)
    .gte('created_at', since);

  if (error) return { success: false, data: null, error: error.message };

  const allNotes = (notes ?? []) as Array<{ id: string; author_id: string; created_at: string; updated_at: string }>;

  if (groupBy === 'student') {
    const byStudent = new Map<string, number>();
    for (const n of allNotes) {
      byStudent.set(n.author_id, (byStudent.get(n.author_id) ?? 0) + 1);
    }
    const studentStats = Array.from(byStudent.entries())
      .map(([studentId, count]) => ({ studentId, noteCount: count }))
      .sort((a, b) => b.noteCount - a.noteCount);

    const avg = allNotes.length / Math.max(byStudent.size, 1);
    const lowEngagement = studentStats.filter((s) => s.noteCount < avg * 0.5);

    // Generate bar chart
    const top20 = studentStats.slice(0, 20);
    const labels = top20.map((s, i) => `S${i + 1}`);
    const values = top20.map(s => s.noteCount);

    let chartResult: { fileId: string; fileName: string; base64: string } | null = null;
    let docResult: { fileId: string; fileName: string } | null = null;
    try {
      chartResult = await generateChart(engagementBarChartConfig(labels, values, lang), lang === 'zh' ? '参与度分析' : 'engagement_analysis');
      docResult = await generateTableDoc({
        title: lang === 'zh' ? '学生参与度分析报告' : 'Student Engagement Report',
        subtitle: `${lang === 'zh' ? '最近' : 'Last'} ${days} ${lang === 'zh' ? '天' : 'days'}`,
        summary: lang === 'zh'
          ? `共 ${allNotes.length} 篇笔记，${byStudent.size} 名学生参与，人均 ${(Math.round(avg * 10) / 10)} 篇。${lowEngagement.length} 名学生参与度低于平均值 50%。`
          : `${allNotes.length} notes, ${byStudent.size} students, avg ${(Math.round(avg * 10) / 10)} per student. ${lowEngagement.length} below 50% average.`,
        headers: [lang === 'zh' ? '排名' : 'Rank', lang === 'zh' ? '学生 ID' : 'Student', lang === 'zh' ? '笔记数' : 'Notes', lang === 'zh' ? '状态' : 'Status'],
        rows: top20.map((s, i) => [
          `${i + 1}`,
          s.studentId.slice(0, 8),
          `${s.noteCount}`,
          s.noteCount < avg * 0.5 ? (lang === 'zh' ? '⚠ 低参与' : '⚠ Low') : (lang === 'zh' ? '✓ 正常' : '✓ OK'),
        ]),
        insights: lowEngagement.length > 0
          ? [
              lang === 'zh' ? `${lowEngagement.length} 名学生参与度不足，建议给予针对性支持` : `${lowEngagement.length} students need targeted support`,
              lang === 'zh' ? `平均每人 ${(Math.round(avg * 10) / 10)} 篇笔记` : `Average ${(Math.round(avg * 10) / 10)} notes per student`,
            ]
          : [lang === 'zh' ? '所有学生参与度良好' : 'All students show good engagement'],
        lang,
      });
    } catch { /* chart/doc generation is optional */ }

    return {
      success: true,
      data: {
        period: `last ${days} days`,
        totalNotes: allNotes.length,
        totalStudents: byStudent.size,
        averageNotesPerStudent: Math.round(avg * 10) / 10,
        studentRanking: studentStats.slice(0, 20),
        lowEngagementStudents: lowEngagement,
        ...(chartResult ? {
          chartFileId: chartResult.fileId,
          chartUrl: `/api/files/${chartResult.fileId}?name=${encodeURIComponent(chartResult.fileName)}`,
          chartBase64: chartResult.base64,
        } : {}),
        ...(docResult ? {
          reportFileId: docResult.fileId,
          reportUrl: `/api/files/${docResult.fileId}?name=${encodeURIComponent(docResult.fileName)}`,
          reportFileName: docResult.fileName,
        } : {}),
        hint: `Engagement analysis for ${days} days. ${lowEngagement.length} student(s) below 50% average.`
          + (chartResult ? ` Chart: ![chart](/api/files/${chartResult.fileId}?name=${encodeURIComponent(chartResult.fileName)})` : '')
          + (docResult ? ` Report: [${docResult.fileName}](/api/files/${docResult.fileId}?name=${encodeURIComponent(docResult.fileName)})` : ''),
      },
    };
  }

  // Group by day/week
  const buckets = new Map<string, number>();
  for (const n of allNotes) {
    const date = new Date(n.created_at);
    const key = groupBy === 'week'
      ? `W${Math.ceil(date.getDate() / 7)}-${date.getMonth() + 1}`
      : date.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const timeline = Array.from(buckets.entries())
    .map(([period, count]) => ({ period, noteCount: count }))
    .sort((a, b) => a.period.localeCompare(b.period));

  let chartResult: { fileId: string; fileName: string; base64: string } | null = null;
  try {
    chartResult = await generateChart(
      timelineChartConfig(timeline.map(t => t.period), timeline.map(t => t.noteCount), lang),
      lang === 'zh' ? '活动趋势' : 'activity_trend',
    );
  } catch { /* optional */ }

  return {
    success: true,
    data: {
      period: `last ${days} days`,
      totalNotes: allNotes.length,
      groupBy,
      timeline,
      ...(chartResult ? {
        chartFileId: chartResult.fileId,
        chartUrl: `/api/files/${chartResult.fileId}?name=${encodeURIComponent(chartResult.fileName)}`,
        chartBase64: chartResult.base64,
      } : {}),
      hint: 'Activity timeline with trend chart.'
        + (chartResult ? ` Chart: ![chart](/api/files/${chartResult.fileId}?name=${encodeURIComponent(chartResult.fileName)})` : ''),
    },
  };
};

const executeComparePeriods: ToolExecutor = async (args, context) => {
  const p1Start = Number(args.period1_days_ago ?? 14);
  const p2Start = Number(args.period2_days_ago ?? 7);
  const lang = (context as any).lang === 'en' ? 'en' : 'zh';

  if (p2Start >= p1Start) {
    return { success: false, data: null, error: 'period2_days_ago must be less than period1_days_ago' };
  }

  const now = Date.now();
  const p1Since = new Date(now - p1Start * 24 * 60 * 60 * 1000).toISOString();
  const p1Until = new Date(now - p2Start * 24 * 60 * 60 * 1000).toISOString();
  const p2Since = p1Until;

  const [res1, res2] = await Promise.all([
    supabase.from('notes')
      .select('id, author_id, title, content, created_at')
      .eq('space_id', context.spaceId)
      .is('deleted_at', null)
      .gte('created_at', p1Since)
      .lt('created_at', p1Until),
    supabase.from('notes')
      .select('id, author_id, title, content, created_at')
      .eq('space_id', context.spaceId)
      .is('deleted_at', null)
      .gte('created_at', p2Since),
  ]);

  const notes1 = (res1.data ?? []) as Array<{ id: string; author_id: string; title: string | null; content: string | null; created_at: string }>;
  const notes2 = (res2.data ?? []) as Array<{ id: string; author_id: string; title: string | null; content: string | null; created_at: string }>;

  const authors1 = new Set(notes1.map((n) => n.author_id));
  const authors2 = new Set(notes2.map((n) => n.author_id));

  const topThemes1 = notes1.slice(0, 5).map((n) => n.title ?? 'Untitled');
  const topThemes2 = notes2.slice(0, 5).map((n) => n.title ?? 'Untitled');

  const change = notes2.length - notes1.length;
  const changePercent = notes1.length > 0 ? Math.round((change / notes1.length) * 100) : (notes2.length > 0 ? 100 : 0);

  const p1Label = lang === 'zh' ? `${p1Start}-${p2Start}天前` : `${p1Start}-${p2Start}d ago`;
  const p2Label = lang === 'zh' ? `最近${p2Start}天` : `Last ${p2Start}d`;

  let chartResult: { fileId: string; fileName: string; base64: string } | null = null;
  try {
    const labels = [lang === 'zh' ? '笔记数' : 'Notes', lang === 'zh' ? '参与人数' : 'Contributors'];
    chartResult = await generateChart(
      comparisonBarChartConfig(labels, [notes1.length, authors1.size], [notes2.length, authors2.size], p1Label, p2Label, lang),
      lang === 'zh' ? '时期对比' : 'period_comparison',
    );
  } catch { /* optional */ }

  return {
    success: true,
    data: {
      period1: { label: p1Label, noteCount: notes1.length, contributors: authors1.size, sampleTitles: topThemes1 },
      period2: { label: p2Label, noteCount: notes2.length, contributors: authors2.size, sampleTitles: topThemes2 },
      change: { notes: change, percent: changePercent, contributors: authors2.size - authors1.size },
      ...(chartResult ? {
        chartFileId: chartResult.fileId,
        chartUrl: `/api/files/${chartResult.fileId}?name=${encodeURIComponent(chartResult.fileName)}`,
        chartBase64: chartResult.base64,
      } : {}),
      hint: `${changePercent >= 0 ? '+' : ''}${changePercent}% change. ${change >= 0 ? 'Activity increasing.' : 'Activity declining.'}`
        + (chartResult ? ` Chart: ![chart](/api/files/${chartResult.fileId}?name=${encodeURIComponent(chartResult.fileName)})` : ''),
    },
  };
};

// ---------------------------------------------------------------------------
// Default Registry
// ---------------------------------------------------------------------------

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // ── Universal tools (all roles) ──

  registry.registerTool(
    'read_note',
    {
      type: 'function',
      function: {
        name: 'read_note',
        description:
          "Read the current note's full content and metadata.",
        parameters: { type: 'object', properties: {} },
      },
    },
    executeReadNote,
    'all',
  );

  registry.registerTool(
    'search_course_materials',
    {
      type: 'function',
      function: {
        name: 'search_course_materials',
        description:
          'Search the course knowledge base — documents uploaded to this course (papers, handouts, readings), '
          + 'parsed and indexed. Use this whenever the learner asks about course content, a reading, or a claim '
          + 'that should be grounded in the course materials, instead of answering from memory.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'What to look for, in the learner\'s own words.',
            },
            limit: {
              type: 'integer',
              description: 'Maximum passages to return.',
              minimum: 1,
              maximum: 10,
            },
          },
          required: ['query'],
        },
      },
    },
    executeSearchCourseMaterials,
    'all',
  );

  registry.registerTool(
    'search_notes',
    {
      type: 'function',
      function: {
        name: 'search_notes',
        description:
          'Search notes in the current space by keyword.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to match against note titles and content.',
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of results to return.',
              minimum: 1,
              maximum: 20,
            },
          },
          required: ['query'],
        },
      },
    },
    executeSearchNotes,
    'all',
  );

  registry.registerTool(
    'get_note_context',
    {
      type: 'function',
      function: {
        name: 'get_note_context',
        description:
          "Get the current note's title, content summary, and build-on relations.",
        parameters: { type: 'object', properties: {} },
      },
    },
    executeGetNoteContext,
    'all',
  );

  registry.registerTool(
    'analyze_argument',
    {
      type: 'function',
      function: {
        name: 'analyze_argument',
        description:
          'Analyze the argument structure (claim, evidence, reasoning) in a note.',
        parameters: {
          type: 'object',
          properties: {
            note_id: {
              type: 'string',
              description:
                'ID of the note to analyze. Defaults to the current note if omitted.',
            },
          },
        },
      },
    },
    executeAnalyzeArgument,
    'all',
  );

  registry.registerTool(
    'compare_notes',
    {
      type: 'function',
      function: {
        name: 'compare_notes',
        description:
          'Compare two or more notes for similarities, differences, and potential connections.',
        parameters: {
          type: 'object',
          properties: {
            note_ids: {
              type: 'array',
              items: { type: 'string' },
              description:
                'List of note IDs to compare (minimum 2, maximum 6).',
              minItems: 2,
              maxItems: 6,
            },
          },
          required: ['note_ids'],
        },
      },
    },
    executeCompareNotes,
    'all',
  );

  registry.registerTool(
    'web_search',
    {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Search the web for evidence or information via Tavily.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query.',
            },
            max_results: {
              type: 'integer',
              description: 'Maximum number of web results to return.',
              minimum: 1,
              maximum: 10,
            },
          },
          required: ['query'],
        },
      },
    },
    executeWebSearch,
    'all',
  );

  registry.registerTool(
    'generate_image',
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description:
          '根据文字描述生成一张图片（AI 绘图）。适合：为想法/概念配示意图、绘制场景、可视化描述。生成后把返回的 image_markdown 原样放进回复正文即可展示图片。',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: '画面描述，具体而生动（中文或英文均可），包含主体、风格、构图。',
            },
            size: {
              type: 'string',
              description: "图片尺寸，可选：'1024x1024'（默认）、'1024x768'、'768x1024'。",
            },
          },
          required: ['prompt'],
        },
      },
    },
    executeGenerateImage,
    'all',
  );

  // ── Student tools ──

  registry.registerTool(
    'find_sources',
    {
      type: 'function',
      function: {
        name: 'find_sources',
        description:
          'Find relevant academic/web sources to support or challenge an idea.',
        parameters: {
          type: 'object',
          properties: {
            claim: {
              type: 'string',
              description:
                'The claim or idea to find supporting or challenging sources for.',
            },
            max_results: {
              type: 'integer',
              description: 'Maximum number of sources to return.',
              minimum: 1,
              maximum: 10,
            },
          },
          required: ['claim'],
        },
      },
    },
    executeFindSources,
    'student',
  );

  // ── Teacher-only tools ──

  registry.registerTool(
    'lesson_scaffold',
    {
      type: 'function',
      function: {
        name: 'lesson_scaffold',
        description:
          'Generate a lesson scaffolding plan based on current student activity.',
        parameters: {
          type: 'object',
          properties: {
            learning_objectives: {
              type: 'string',
              description:
                'The learning objectives for the lesson.',
            },
            kb_principles: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Knowledge Building principles to emphasize (e.g., Idea Diversity, Rise Above).',
            },
          },
          required: ['learning_objectives'],
        },
      },
    },
    executeLessonScaffold,
    'teacher',
  );

  registry.registerTool(
    'class_analytics',
    {
      type: 'function',
      function: {
        name: 'class_analytics',
        description:
          'Get participation and contribution analytics for the current space.',
        parameters: {
          type: 'object',
          properties: {
            metric: {
              type: 'string',
              enum: ['participation', 'connections', 'buildon_depth', 'all'],
              description:
                'Which metric to compute. Defaults to all.',
            },
          },
        },
      },
    },
    executeClassAnalytics,
    'teacher',
  );

  registry.registerTool(
    'suggest_triggers',
    {
      type: 'function',
      function: {
        name: 'suggest_triggers',
        description:
          'Suggest AI auto-feedback triggers based on current student note patterns.',
        parameters: {
          type: 'object',
          properties: {
            focus: {
              type: 'string',
              description:
                'Optional focus area for trigger suggestions (e.g., "evidence use", "idea diversity").',
            },
          },
        },
      },
    },
    executeSuggestTriggers,
    'teacher',
  );

  // ── Context-bridging tools (cross-layer) ──

  registry.registerTool(
    'list_note_discussions',
    {
      type: 'function',
      function: {
        name: 'list_note_discussions',
        description:
          'List active AI conversations at the note level in this workspace. Shows which notes have ongoing AI discussions and how active they are.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    executeListNoteDiscussions,
    'teacher',
  );

  registry.registerTool(
    'get_workspace_summary',
    {
      type: 'function',
      function: {
        name: 'get_workspace_summary',
        description:
          'Get a high-level summary of a workspace: note count, contributor count, recent activity, and recent note titles. Useful for understanding the overall state of a Knowledge Building community.',
        parameters: {
          type: 'object',
          properties: {
            course_id: {
              type: 'string',
              description: 'Course ID to summarize (defaults to current course).',
            },
            space_id: {
              type: 'string',
              description: 'Space ID to summarize (defaults to current space).',
            },
          },
        },
      },
    },
    executeGetWorkspaceSummary,
    'all',
  );

  // ── Cross-layer bridging tools ──

  registry.registerTool(
    'get_personal_history',
    {
      type: 'function',
      function: {
        name: 'get_personal_history',
        description:
          'Retrieve recent AI conversation summaries from the user\'s personal (Dashboard) AI assistant. Useful to understand what the user has been exploring across courses and build on previous conversations.',
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Number of recent conversations to retrieve (default 5, max 20).',
              minimum: 1,
              maximum: 20,
            },
          },
        },
      },
    },
    executeGetPersonalHistory,
    'all',
  );

  // ── Document generation tools (teacher) ──

  registry.registerTool(
    'generate_summary_doc',
    {
      type: 'function',
      function: {
        name: 'generate_summary_doc',
        description:
          'Generate a downloadable Word (.docx) summary document from workspace notes. Groups notes by theme, creates sections, and returns a download URL for the Word file.',
        parameters: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic or theme to focus the summary on. If omitted, summarizes all recent notes.',
            },
            max_notes: {
              type: 'integer',
              description: 'Maximum number of notes to include (default 20).',
              minimum: 5,
              maximum: 50,
            },
            format: {
              type: 'string',
              enum: ['outline', 'narrative', 'bullet_points'],
              description: 'Output format. Defaults to outline.',
            },
          },
        },
      },
    },
    executeGenerateSummaryDoc,
    'teacher',
  );

  registry.registerTool(
    'export_notes',
    {
      type: 'function',
      function: {
        name: 'export_notes',
        description:
          'Export workspace notes to a downloadable Word (.docx) document with build-on relations. Returns a download URL for the generated file.',
        parameters: {
          type: 'object',
          properties: {
            note_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific note IDs to export. If omitted, exports all notes in the space.',
            },
            include_relations: {
              type: 'boolean',
              description: 'Whether to include build-on relations. Default true.',
            },
            max_notes: {
              type: 'integer',
              description: 'Maximum notes to export when exporting all (default 50).',
              minimum: 1,
              maximum: 200,
            },
          },
        },
      },
    },
    executeExportNotes,
    'teacher',
  );

  // ── Data analysis tools (teacher) ──

  registry.registerTool(
    'analyze_engagement',
    {
      type: 'function',
      function: {
        name: 'analyze_engagement',
        description:
          'Analyze student engagement with charts and reports. Generates a bar chart (PNG) and Word report. Returns per-student rankings, trend charts, and download URLs for both files.',
        parameters: {
          type: 'object',
          properties: {
            days: {
              type: 'integer',
              description: 'Number of days to analyze (default 7, max 90).',
              minimum: 1,
              maximum: 90,
            },
            group_by: {
              type: 'string',
              enum: ['day', 'week', 'student'],
              description: 'How to group the results. Default: student.',
            },
          },
        },
      },
    },
    executeAnalyzeEngagement,
    'teacher',
  );

  registry.registerTool(
    'compare_periods',
    {
      type: 'function',
      function: {
        name: 'compare_periods',
        description:
          'Compare workspace activity between two time periods with a comparison chart. Generates a bar chart (PNG) showing differences in note count and contributors. Returns download URL.',
        parameters: {
          type: 'object',
          properties: {
            period1_days_ago: {
              type: 'integer',
              description: 'Start of first period (days ago from today). E.g., 14 means "from 14 days ago".',
              minimum: 1,
              maximum: 180,
            },
            period2_days_ago: {
              type: 'integer',
              description: 'Start of second period (days ago from today). Must be less than period1_days_ago. E.g., 7 means "from 7 days ago".',
              minimum: 0,
              maximum: 180,
            },
          },
          required: ['period1_days_ago', 'period2_days_ago'],
        },
      },
    },
    executeComparePeriods,
    'teacher',
  );

  // ── save_reflection — AI extracts learner insights for cross-session memory ──

  const executeSaveReflection: ToolExecutor = async (args, context) => {
    const reflectionType = String(args.reflection_type ?? 'insight');
    const content = String(args.content ?? '').trim();
    const keywords = Array.isArray(args.keywords)
      ? args.keywords.map(String)
      : String(args.keywords ?? '').split(',').map((k: string) => k.trim()).filter(Boolean);

    if (!content) {
      return { success: false, data: null, error: 'content is required' };
    }

    const validTypes = ['insight', 'knowledge_gap', 'misconception', 'progress', 'interest', 'strength'];
    const type = validTypes.includes(reflectionType) ? reflectionType : 'insight';

    await saveReflection({
      userId: context.userId,
      courseId: context.courseId,
      reflectionType: type as any,
      content,
      topicKeywords: keywords,
      relevanceScore: Number(args.relevance ?? 0.5),
    });

    return { success: true, data: { saved: true, type, keywords } };
  };

  registry.registerTool(
    'save_reflection',
    {
      type: 'function',
      function: {
        name: 'save_reflection',
        description:
          'Save an observation about the student for future conversations. Use this to record knowledge gaps, misconceptions, interests, or progress you noticed. ' +
          'These reflections will be available in future sessions to personalize the interaction.',
        parameters: {
          type: 'object',
          properties: {
            reflection_type: {
              type: 'string',
              enum: ['insight', 'knowledge_gap', 'misconception', 'progress', 'interest', 'strength'],
              description: 'Type of reflection. insight=general observation, knowledge_gap=topic the student struggles with, misconception=incorrect understanding, progress=improvement noted, interest=topic the student is curious about, strength=area of competence.',
            },
            content: {
              type: 'string',
              description: 'The reflection content. Be specific and actionable, e.g., "Student confuses correlation with causation when discussing climate data" or "Student shows strong ability to synthesize multiple viewpoints".',
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Topic keywords for matching in future sessions, e.g., ["climate", "causation", "evidence"].',
            },
            relevance: {
              type: 'number',
              description: 'Importance score 0.0-1.0. Higher = more likely to be surfaced in future sessions. Default 0.5.',
            },
          },
          required: ['reflection_type', 'content'],
        },
      },
    },
    executeSaveReflection,
    'all',
  );

  // ── detect_triggers — run real-time T1-T6 trigger detection on the workspace ──

  const executeDetectTriggers: ToolExecutor = async (_args, context) => {
    try {
      const triggers = await detectTriggers(context.spaceId);
      return {
        success: true,
        data: {
          triggersFound: triggers.length,
          triggers: triggers.map((t) => ({
            type: t.trigger_type,
            label: t.label,
            severity: t.severity,
            responseStrategy: t.response_strategy,
            rationale: t.rationale,
            noteId: t.note_id,
            prompt: t.prompt.slice(0, 400),
          })),
          taxonomy: 'T1=Undigested AI, T2=No reasoning, T3=No evidence, T4=No connection, T5=Promising seed, T6=Unclear, C1=Stagnation, C2=Participation imbalance',
          hint: triggers.length > 0
            ? 'Triggers detected using the T1-T6 taxonomy. Present each with its label, rationale, and response strategy (auto/triage/teacher_review). For "auto" triggers, suggest immediate AI feedback. For "triage" triggers, recommend teacher review before acting. For "teacher_review" triggers, flag for the teacher\'s judgment.'
            : 'No triggers detected. The workspace discourse appears healthy. You can still proactively suggest improvements based on overall discussion quality.',
        },
      };
    } catch (err: unknown) {
      return { success: false, data: null, error: 'Trigger detection failed' };
    }
  };

  registry.registerTool(
    'detect_triggers',
    {
      type: 'function',
      function: {
        name: 'detect_triggers',
        description:
          'Run T1-T6 trigger detection on the current workspace, using the configured draft-feedback categories. ' +
          'Note-level triggers: T1 (Undigested AI), T2 (No reasoning), T3 (No evidence), T4 (No connection), T5 (Promising seed), T6 (Unclear). ' +
          'Community-level triggers: C1 (Stagnation), C2 (Participation imbalance). ' +
          'Each trigger includes a response strategy: "auto" (reliably detectable, act immediately), "triage" (flag for teacher review), or "teacher_review" (requires human judgment). ' +
          'Returns detected issues with severity, rationale, and theory-grounded feedback prompts.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    executeDetectTriggers,
    'teacher',
  );

  // ── get_learner_insights — teachers can view student learning profiles ──

  const executeGetLearnerInsights: ToolExecutor = async (args, context) => {
    const targetUserId = String(args.student_id ?? '').trim();
    if (!targetUserId) {
      return { success: false, data: null, error: 'student_id is required' };
    }

    const profile = await getOrCreateProfile(targetUserId, context.courseId);

    const { data: reflections } = await supabase
      .from('agent_reflections')
      .select('reflection_type, content, topic_keywords, relevance_score, created_at')
      .eq('user_id', targetUserId)
      .eq('course_id', context.courseId)
      .order('relevance_score', { ascending: false })
      .limit(10);

    return {
      success: true,
      data: {
        scaffoldingLevel: profile.scaffoldingLevel,
        interactionCount: profile.interactionCount,
        avgMessageLength: Math.round(profile.avgMessageLength),
        questionsAsked: profile.questionsAsked,
        evidenceCited: profile.evidenceCited,
        connectionsMade: profile.connectionsMade,
        cognitivePatterns: profile.cognitivePatterns,
        reflections: (reflections ?? []).map((r: any) => ({
          type: r.reflection_type,
          content: r.content,
          keywords: r.topic_keywords,
          relevance: r.relevance_score,
          date: r.created_at,
        })),
      },
    };
  };

  // ── build_embeddings — batch-generate semantic search vectors for a workspace ──

  const executeBuildEmbeddings: ToolExecutor = async (_args, context) => {
    const result = await embedSpaceNotes(context.spaceId, context.courseId);
    return {
      success: true,
      data: {
        ...result,
        message: `Embedded ${result.embedded} notes, skipped ${result.skipped}, failed ${result.failed}. Semantic search is now available for this workspace.`,
      },
    };
  };

  registry.registerTool(
    'build_embeddings',
    {
      type: 'function',
      function: {
        name: 'build_embeddings',
        description:
          'Generate semantic search embeddings for all notes in the current workspace. ' +
          'Run this once to enable AI-powered semantic note search (finds conceptually related notes even when they use different words). ' +
          'Requires the course to have a configured AI provider that supports embeddings (OpenAI or compatible).',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    executeBuildEmbeddings,
    'teacher',
  );

  registry.registerTool(
    'get_learner_insights',
    {
      type: 'function',
      function: {
        name: 'get_learner_insights',
        description:
          'View a student\'s learning profile: scaffolding level, interaction patterns, cognitive tendencies, and cross-session reflections. Teachers only.',
        parameters: {
          type: 'object',
          properties: {
            student_id: {
              type: 'string',
              description: 'The UUID of the student to look up.',
            },
          },
          required: ['student_id'],
        },
      },
    },
    executeGetLearnerInsights,
    'teacher',
  );

  // ── save_teaching_insight — cross-module memory ─────────────────
  const executeSaveTeachingInsight: ToolExecutor = async (args, context) => {
    const insightType = (args.insight_type as string) || 'insight';
    const content = args.content as string;
    if (!content?.trim()) {
      return { success: false, data: null, error: 'content is required' };
    }
    const validTypes: MemoryType[] = ['insight', 'decision', 'observation', 'plan'];
    const memType: MemoryType = validTypes.includes(insightType as MemoryType)
      ? (insightType as MemoryType)
      : 'insight';

    const result = await writeMemory({
      userId: context.userId,
      courseId: context.courseId,
      source: 'chat',
      memoryType: memType,
      content: content.trim(),
      metadata: { conversation_context: true },
    });

    return {
      success: true,
      data: result
        ? { saved: true }
        : { saved: false, message: '重复内容，已跳过' },
    };
  };

  registry.registerTool(
    'save_teaching_insight',
    {
      type: 'function',
      function: {
        name: 'save_teaching_insight',
        description:
          '保存教学洞察、决策或计划到跨模块记忆中。保存的内容会自动出现在备课助手、学情分析、教学评估等其他教学工具中，帮助教师获得更连贯的 AI 辅助体验。' +
          '当教师在对话中表达了重要的教学发现、做出了教学决策、观察到了学生学习模式、或制定了教学计划时，主动调用此工具保存。',
        parameters: {
          type: 'object',
          properties: {
            insight_type: {
              type: 'string',
              enum: ['insight', 'decision', 'observation', 'plan'],
              description: 'insight=教学发现, decision=教学决策, observation=课堂观察, plan=教学计划',
            },
            content: {
              type: 'string',
              description: '简洁描述关键发现或决策（最多500字）',
            },
          },
          required: ['insight_type', 'content'],
        },
      },
    },
    executeSaveTeachingInsight,
    'teacher',
  );

  return registry;
}
