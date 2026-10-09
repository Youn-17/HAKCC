/**
 * 画布上 Build-on 分支的收起与展开（2026-10-09 用户提出）。
 *
 * 收起一条笔记 = 把建立在它上面的笔记（以及再往下的）藏起来，卡片下沿显示「已收起 N 条」。
 * 默认把旧的细枝末节收起来：画布越来越满，学生找不到想接着写的那条。
 *
 * 规则写成纯函数，Workspace 只管状态和渲染：
 * - 一条笔记被藏起来，当且仅当它至少有一个 Build-on 父笔记，而且每个父笔记都是「收起的」或「已被藏起的」。
 *   同时建立在两条笔记上的综合笔记，只要有一条父笔记还展开着，它就留在画布上。
 * - 父子关系只看当前视图里两端都在的连线；连线的 source 是新写的那条，target 是被建立的那条。
 * - 有环（A 建立在 B 上、B 又建立在 A 上）时宁可不藏：环里的笔记互相是「展开的父笔记」，都留着。
 */

export interface FoldEdge {
  /** 建立在别人上面的那条（新写的） */
  source: string;
  /** 被建立的那条 */
  target: string;
}

export interface FoldGraph {
  /** 父 → 建立在它上面的笔记（去重，按出现顺序） */
  children: Map<string, string[]>;
  /** 子 → 它建立在哪些笔记上 */
  parents: Map<string, string[]>;
}

export function buildFoldGraph(noteIds: Iterable<string>, edges: readonly FoldEdge[]): FoldGraph {
  const ids = new Set(noteIds);
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue;
    const kids = children.get(e.target) ?? [];
    if (!kids.includes(e.source)) kids.push(e.source);
    children.set(e.target, kids);
    const ps = parents.get(e.source) ?? [];
    if (!ps.includes(e.target)) ps.push(e.target);
    parents.set(e.source, ps);
  }
  return { children, parents };
}

/**
 * 被收起而藏起来的笔记。按「还开着的父笔记数」做一次传播，O(笔记 + 连线)。
 * 收起的笔记自己不藏（除非它的父笔记把它藏了），藏的是它下面的。
 */
export function hiddenByFolds(graph: FoldGraph, collapsed: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  const openParents = new Map<string, number>();
  const queue: string[] = [];
  for (const [child, ps] of graph.parents) {
    const open = ps.filter(p => !collapsed.has(p)).length;
    openParents.set(child, open);
    if (open === 0) {
      hidden.add(child);
      queue.push(child);
    }
  }
  while (queue.length > 0) {
    const gone = queue.pop()!;
    // gone 被藏了：它若没被收起，原本算作孩子们的一个「开着的父笔记」，现在不算了
    if (collapsed.has(gone)) continue;
    for (const kid of graph.children.get(gone) ?? []) {
      if (hidden.has(kid)) continue;
      const left = (openParents.get(kid) ?? 0) - 1;
      openParents.set(kid, left);
      if (left <= 0) {
        hidden.add(kid);
        queue.push(kid);
      }
    }
  }
  return hidden;
}

/** 从 root 往下能走到的所有后代（不含 root），防环。 */
export function descendantsOf(graph: FoldGraph, root: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(graph.children.get(root) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === root || out.has(id)) continue;
    out.add(id);
    for (const kid of graph.children.get(id) ?? []) stack.push(kid);
  }
  return out;
}

export interface FoldSummary {
  /** 直接建立在这条上的笔记数（当前视图里） */
  childCount: number;
  /** 当前是否收起 */
  collapsed: boolean;
  /** 因为它收起而藏起来的笔记数（沿着被藏的笔记往下数） */
  hiddenCount: number;
  /** 藏起来的笔记里有我还没看过的（New） */
  hasNewHidden: boolean;
}

/**
 * 每条有孩子的笔记一份摘要，给卡片下沿的开关用。
 * 只为没被藏起来的笔记算：藏起来的卡片根本不画。
 */
export function foldSummaries(
  graph: FoldGraph,
  collapsed: ReadonlySet<string>,
  hidden: ReadonlySet<string>,
  isNew: (id: string) => boolean,
): Map<string, FoldSummary> {
  const out = new Map<string, FoldSummary>();
  for (const [id, kids] of graph.children) {
    if (hidden.has(id)) continue;
    const isCollapsed = collapsed.has(id);
    let hiddenCount = 0;
    let hasNewHidden = false;
    if (isCollapsed) {
      const seen = new Set<string>();
      const stack = [...kids];
      while (stack.length > 0) {
        const k = stack.pop()!;
        if (seen.has(k) || !hidden.has(k)) continue;
        seen.add(k);
        hiddenCount += 1;
        if (isNew(k)) hasNewHidden = true;
        for (const g of graph.children.get(k) ?? []) stack.push(g);
      }
    }
    out.set(id, { childCount: kids.length, collapsed: isCollapsed, hiddenCount, hasNewHidden });
  }
  return out;
}

export interface FoldCandidate {
  id: string;
  createdAt?: string;
  /** 我写的、我还没看过的（New）、或空间里被 Build-on 最多的（火）：这些所在的分支默认不收 */
  protect: boolean;
}

export interface AutoFoldOptions {
  /** 视图里少于这么多条笔记时不默认收起：画布不挤，收起来反而要多点一下 */
  minNotes?: number;
  /** 比视图里最新的笔记早这么多天以上，算「旧」 */
  staleDays?: number;
  /** 分支最多这么多条才算「细枝末节」；更大的旧讨论留着，由学生自己决定收不收 */
  maxDescendants?: number;
}

export const AUTO_FOLD_DEFAULTS: Required<AutoFoldOptions> = { minNotes: 15, staleDays: 7, maxDescendants: 5 };

/**
 * 默认收起的笔记：它下面的分支整枝都旧、都小、都没有要保护的笔记。
 * 「旧」相对视图里最新的那条算，而不是相对今天：一门课停了一个月再打开，最近那一周的讨论仍然是展开的。
 * 只收最外层：一条笔记的祖先已经被默认收起，它自己就不再单独收，展开一次就能看到整枝。
 */
export function autoFoldIds(
  candidates: readonly FoldCandidate[],
  graph: FoldGraph,
  options: AutoFoldOptions = {},
): Set<string> {
  const { minNotes, staleDays, maxDescendants } = { ...AUTO_FOLD_DEFAULTS, ...options };
  const out = new Set<string>();
  if (candidates.length < minNotes) return out;
  const byId = new Map(candidates.map(c => [c.id, c]));
  const times = candidates
    .map(c => (c.createdAt ? Date.parse(c.createdAt) : Number.NaN))
    .filter(t => Number.isFinite(t));
  if (times.length === 0) return out;
  const cutoff = Math.max(...times) - staleDays * 86_400_000;

  const isOld = (id: string) => {
    const t = byId.get(id)?.createdAt ? Date.parse(byId.get(id)!.createdAt!) : Number.NaN;
    // 不知道什么时候写的，就当是新的：宁可多显示，不能把看不清的东西藏起来
    return Number.isFinite(t) && t < cutoff;
  };

  const qualifies = new Set<string>();
  for (const id of graph.children.keys()) {
    if (!byId.has(id)) continue;
    const below = descendantsOf(graph, id);
    if (below.size === 0 || below.size > maxDescendants) continue;
    let ok = true;
    for (const d of below) {
      if (!isOld(d) || byId.get(d)?.protect) { ok = false; break; }
    }
    if (ok) qualifies.add(id);
  }

  // 只留最外层：往上找，任何一个祖先也合格，就不单独收它
  for (const id of qualifies) {
    const seen = new Set<string>([id]);
    const stack = [...(graph.parents.get(id) ?? [])];
    let coveredByAncestor = false;
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (seen.has(p)) continue;
      seen.add(p);
      if (qualifies.has(p)) { coveredByAncestor = true; break; }
      for (const pp of graph.parents.get(p) ?? []) stack.push(pp);
    }
    if (!coveredByAncestor) out.add(id);
  }
  return out;
}

/** 学生自己点过的：收起了哪些、展开了哪些（展开压过默认收起）。 */
export interface FoldChoices {
  collapsed: string[];
  expanded: string[];
}

export function effectiveFolds(auto: ReadonlySet<string>, choices: FoldChoices): Set<string> {
  const out = new Set<string>();
  const expanded = new Set(choices.expanded);
  for (const id of auto) if (!expanded.has(id)) out.add(id);
  for (const id of choices.collapsed) out.add(id);
  return out;
}

/** 点一下卡片下沿的开关。 */
export function toggleFold(choices: FoldChoices, id: string, currentlyCollapsed: boolean): FoldChoices {
  const collapsed = choices.collapsed.filter(x => x !== id);
  const expanded = choices.expanded.filter(x => x !== id);
  if (currentlyCollapsed) expanded.push(id);
  else collapsed.push(id);
  return { collapsed, expanded };
}

/**
 * 要去看一条被藏起来的笔记（搜索结果、「我的笔记」、讨论主题、刚写的 Build-on）：
 * 沿着它的父笔记往上，把挡路的收起都打开。每一层只打开一条路：先找一个本来就没藏起来的父笔记。
 * 返回新的选择；笔记本来就看得见时原样返回。
 */
export function revealChoices(
  graph: FoldGraph,
  choices: FoldChoices,
  collapsed: ReadonlySet<string>,
  hidden: ReadonlySet<string>,
  id: string,
): FoldChoices {
  if (!hidden.has(id)) return choices;
  const toOpen = new Set<string>();
  const seen = new Set<string>();
  let current = id;
  while (hidden.has(current) && !seen.has(current)) {
    seen.add(current);
    const ps = graph.parents.get(current) ?? [];
    if (ps.length === 0) break;
    // 优先走一个自己没被藏起来的父笔记：打开它就够了
    const visibleParent = ps.find(p => !hidden.has(p));
    const next = visibleParent ?? ps[0];
    if (collapsed.has(next)) toOpen.add(next);
    if (visibleParent) break;
    current = next;
  }
  if (toOpen.size === 0) return choices;
  return {
    collapsed: choices.collapsed.filter(x => !toOpen.has(x)),
    expanded: [...choices.expanded.filter(x => !toOpen.has(x)), ...toOpen],
  };
}

// ── 存在本机（每人每个空间一份）────────────────────────────────────────

const STORAGE_PREFIX = 'hakcc-buildon-folds';
const MAX_IDS = 600;

export function foldStorageKey(userId: string | null | undefined, spaceId: string): string {
  return `${STORAGE_PREFIX}:${userId ?? 'anon'}:${spaceId}`;
}

export function readFoldChoices(key: string): FoldChoices {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { collapsed: [], expanded: [] };
    const parsed = JSON.parse(raw) as Partial<{ c: unknown; e: unknown }>;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-MAX_IDS) : []);
    return { collapsed: list(parsed.c), expanded: list(parsed.e) };
  } catch {
    return { collapsed: [], expanded: [] };
  }
}

export function saveFoldChoices(key: string, choices: FoldChoices): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ c: choices.collapsed.slice(-MAX_IDS), e: choices.expanded.slice(-MAX_IDS) }));
  } catch {
    // 隐私模式或存储满了：这次会话里照样能收起展开，只是下次不记得
  }
}
