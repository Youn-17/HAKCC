import { supabase } from '../config/supabase';

/* Implementation notes are described in the public update guide. */

export interface BuildOnLink {
  /** 在 Build-on 的那条（后写的） */
  sourceId: string;
  /** 被 Build-on 的原笔记 */
  targetId: string;
  type: string;
}

/** 一次最多读多少条关系。线上最大的空间 51 条，留足余量 */
export const SPACE_RELATIONS_LIMIT = 300;
/** 写进提示词的关系最多多少条，超出的只给总数 */
export const PROMPT_LINKS_MAX = 60;
const TITLE_MAX = 40;

export const BUILD_ON_KINDS_NOTE = [
  'Kinds of Build-on: extend = adds to or goes further; clarify = explains or sharpens;',
  'question = asks about it; challenge = disagrees; evidence = supplies evidence; synthesize = pulls several ideas together.',
].join(' ');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 模型自己填的 note_id 先过这一关，再去查库 */
export const isNoteId = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

const shorten = (title: string): string => {
  const t = (title || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t;
};

// ── 读 ───────────────────────────────────────────────────────

export interface SpaceBuildOnGraph {
  /** 两端都还在（没被删）的关系，新的在前 */
  links: BuildOnLink[];
  /** 这些关系涉及的笔记标题，含 known 里给的 */
  titles: Map<string, string>;
  /** 有查询出错时的原因。这时 links 不全，不能当成「没有关系」告诉用户 */
  error?: string;
  /** 读满了 SPACE_RELATIONS_LIMIT 条：更早的可能没读到，按 links 数出的条数、链长只会偏小 */
  truncated?: boolean;
}

/* Implementation notes are described in the public update guide. */
export async function fetchSpaceBuildOnGraph(
  spaceId: string,
  known: Map<string, string> = new Map(),
): Promise<SpaceBuildOnGraph> {
  const { data, error } = await supabase
    .from('relations')
    .select('source_note_id, target_note_id, relation_type, created_at')
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false })
    .limit(SPACE_RELATIONS_LIMIT);

  const rows = ((data ?? []) as Array<{ source_note_id: string; target_note_id: string; relation_type: string }>)
    .filter(r => r.source_note_id && r.target_note_id);
  const titles = new Map(known);
  const missing = [...new Set(rows.flatMap(r => [r.source_note_id, r.target_note_id]))].filter(id => !titles.has(id));
  let lookupError: string | undefined;
  if (missing.length > 0) {
    const { data: found, error: notesError } = await supabase
      .from('notes')
      .select('id, title')
      .in('id', missing)
      .eq('space_id', spaceId)
      .is('deleted_at', null);
    lookupError = notesError?.message;
    for (const n of (found ?? []) as Array<{ id: string; title: string | null }>) {
      titles.set(n.id, n.title ?? 'Untitled');
    }
  }
  const links = rows
    .filter(r => titles.has(r.source_note_id) && titles.has(r.target_note_id))
    .map(r => ({ sourceId: r.source_note_id, targetId: r.target_note_id, type: r.relation_type }));
  const graph = { links, titles, ...((data ?? []).length >= SPACE_RELATIONS_LIMIT ? { truncated: true } : {}) };
  const failure = error?.message ?? lookupError;
  if (!failure) return graph;
  console.warn(`[buildOnContext] reading Build-on relations of space ${spaceId} failed: ${failure}`);
  return { ...graph, error: failure };
}

// ── 排版 ─────────────────────────────────────────────────────

export interface BuildOnStats {
  /** 被 Build-on 的次数，多的在前，只列至少一次的 */
  builtOn: Array<{ id: string; count: number }>;
  /** 一次都没被 Build-on 过的（只在给定的笔记范围内算） */
  notBuiltOn: string[];
}

export function buildOnStats(links: BuildOnLink[], ids: string[]): BuildOnStats {
  const incoming = new Map<string, number>();
  for (const l of links) incoming.set(l.targetId, (incoming.get(l.targetId) ?? 0) + 1);
  const builtOn = ids
    .filter(id => (incoming.get(id) ?? 0) > 0)
    .map(id => ({ id, count: incoming.get(id) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  return { builtOn, notBuiltOn: ids.filter(id => !incoming.has(id)) };
}

/**
 * 最长的一条 Build-on 链有几级：C Build-on B、B Build-on A 算 2 级。一条笔记可以同时 Build-on 好几条，
 * 按最长的那条路算；从根往下一层层数（广度优先）会被「D 也直接 Build-on 了 A」这样的近路算短。
 * 后写的才 Build-on 先写的，不会成环；万一成环，走到链上已有的笔记就停。
 */
export function longestBuildOnChain(links: BuildOnLink[]): number {
  const builtOn = new Map<string, string[]>();
  for (const l of links) {
    const targets = builtOn.get(l.sourceId);
    if (targets) targets.push(l.targetId);
    else builtOn.set(l.sourceId, [l.targetId]);
  }
  const lengthFrom = new Map<string, number>();
  const onPath = new Set<string>();
  const chainFrom = (id: string): number => {
    const known = lengthFrom.get(id);
    if (known !== undefined) return known;
    onPath.add(id);
    let best = 0;
    for (const target of builtOn.get(id) ?? []) {
      if (!onPath.has(target)) best = Math.max(best, 1 + chainFrom(target));
    }
    onPath.delete(id);
    lengthFrom.set(id, best);
    return best;
  };
  let longest = 0;
  for (const id of builtOn.keys()) longest = Math.max(longest, chainFrom(id));
  return longest;
}

export interface BuildOnPromptInput {
  /** 提示词里已经编了号的笔记，顺序就是编号 #1、#2…… */
  listed: Array<{ id: string; title: string }>;
  links: BuildOnLink[];
  titles: Map<string, string>;
  /** 学生勾选了笔记：只写碰到这几条的关系 */
  focusIds?: Set<string>;
  /** 整个空间一共有几条笔记；比 listed 多说明列表只是最近更新的一部分 */
  totalNotes?: number;
  maxLinks?: number;
}

export function formatBuildOnSection(input: BuildOnPromptInput): string {
  const { listed, titles, focusIds, totalNotes, maxLinks = PROMPT_LINKS_MAX } = input;
  const index = new Map(listed.map((n, i) => [n.id, i + 1]));
  const ref = (id: string): string => {
    const title = shorten(titles.get(id) ?? listed.find(n => n.id === id)?.title ?? '');
    const n = index.get(id);
    return n ? `#${n} "${title}"` : `"${title}" (id: ${id})`;
  };

  const head = [
    'Build-on relations in this workspace.',
    'A Build-on is a newer note that responds to an earlier one. "X builds on Y" means X is the newer note and Y is the original it builds on.',
    BUILD_ON_KINDS_NOTE,
    'Every link between two notes is a Build-on, whatever its kind. The numbers (#n) are the numbers in the note list above.',
  ].join(' ');

  const scoped = focusIds && focusIds.size > 0
    ? input.links.filter(l => focusIds.has(l.sourceId) || focusIds.has(l.targetId))
    : input.links;

  if (scoped.length === 0) {
    return `${head}\nThere are no Build-on links ${focusIds && focusIds.size > 0 ? 'on the selected notes' : 'in this workspace'} yet. If asked about Build-ons, say so plainly; do not invent any.`;
  }

  const shown = scoped.slice(0, maxLinks);
  const lines = shown.map(l => `- ${ref(l.sourceId)} builds on ${ref(l.targetId)} (${l.type})`);
  if (scoped.length > shown.length) lines.push(`- … and ${scoped.length - shown.length} older link(s) not shown.`);

  // 统计用全部关系，不受显示条数限制；「没被 Build-on 过」只对列出的笔记说
  const stats = buildOnStats(input.links, listed.map(n => n.id));
  const parts: string[] = [`${head}\n${scoped.length} link(s)${focusIds && focusIds.size > 0 ? ' touching the selected notes' : ''}, newest first:`, ...lines];
  if (stats.builtOn.length > 0) {
    parts.push(`Built on most: ${stats.builtOn.slice(0, 5).map(s => `${ref(s.id)} (${s.count})`).join('; ')}.`);
  }
  if (stats.notBuiltOn.length > 0 && !(focusIds && focusIds.size > 0)) {
    const names = stats.notBuiltOn.slice(0, 15).map(id => `#${index.get(id)}`).join(', ');
    parts.push(`Listed notes nobody has built on yet: ${names}${stats.notBuiltOn.length > 15 ? ', …' : ''}.`);
  }
  if (totalNotes && totalNotes > listed.length) {
    parts.push(`The note list above shows ${listed.length} of ${totalNotes} notes; links to older notes are written with their title and id.`);
  }
  return parts.join('\n');
}

/** get_note_context 在「整个空间」里给的结构化结果（没指定笔记时） */
export function describeSpaceGraph(
  graph: SpaceBuildOnGraph,
  max = 60,
): {
  scope: 'workspace';
  totalBuildOns: number;
  buildOns: Array<{ from: { id: string; title: string }; to: { id: string; title: string }; kind: string }>;
  mostBuiltOn: Array<{ id: string; title: string; buildOns: number }>;
} {
  const title = (id: string) => graph.titles.get(id) ?? 'Untitled';
  const stats = buildOnStats(graph.links, [...new Set(graph.links.map(l => l.targetId))]);
  return {
    scope: 'workspace',
    totalBuildOns: graph.links.length,
    buildOns: graph.links.slice(0, max).map(l => ({
      from: { id: l.sourceId, title: title(l.sourceId) },
      to: { id: l.targetId, title: title(l.targetId) },
      kind: l.type,
    })),
    mostBuiltOn: stats.builtOn.slice(0, 8).map(s => ({ id: s.id, title: title(s.id), buildOns: s.count })),
  };
}
