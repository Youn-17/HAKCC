import { supabase } from '../config/supabase';
import { ApiError } from '../middleware/errorHandler';
import { WELCOME_VIEW_ID } from './viewTopics';

/**
 * 教师给各组发布的任务（2026-10-10 用户：一键给各个小组发布任务；小组进到视图里看到任务面板；
 * 学生不能 Build-on，也不算笔记；可以选发到哪个视图，不选也行）。表在迁移 088。
 *
 * 显示规则（GET /spaces/:id/group-assignments）：
 *   - 绑定小组的空间：发给这个组的任务；
 *   - 全班共享的空间：学生看发给自己组的，教职看全部（带上发给了哪些组）；
 *   - 选了视图的任务只在那个空间的那个视图里显示，视图被删了就显示在主画布；没选的在所有视图里显示。
 *     按视图筛在前端做：切视图不用再请求。
 */

export const ASSIGNMENT_LIMITS = { title: 200, content: 8000, requirements: 8000 } as const;

/** any = 所有视图；view = 某个视图；group_view = 各组自己的视图（views.group_id） */
export type Placement = 'any' | 'view' | 'group_view';
export const PLACEMENTS: readonly Placement[] = ['any', 'view', 'group_view'];

export interface AssignmentRow {
  id: string;
  course_id: string;
  title: string;
  content: string;
  requirements: string;
  due_at: string | null;
  placement: Placement | null;
  space_id: string | null;
  view_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ApiGroupAssignment {
  id: string;
  courseId: string;
  title: string;
  content: string;
  /** 「要求」按行拆开，面板里一条一条列 */
  requirements: string[];
  requirementsText: string;
  dueAt: string | null;
  placement: Placement;
  spaceId: string | null;
  viewId: string | null;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string } | null;
  /** 发给了哪些组。学生只看得到自己的组 */
  groups: Array<{ id: string; name: string }>;
}

export interface AssignmentInput {
  title?: string;
  content?: string;
  requirements?: string;
  dueAt?: string | null;
  groupIds?: string[] | null;
  placement?: Placement;
  spaceId?: string | null;
  viewId?: string | null;
}

const BULLET = /^\s*(?:[-*•·]|\d{1,2}[.、)）]|[（(]\d{1,2}[)）])\s*/;

/** 「要求」一行一条；去掉老师自己打的序号和圆点，空行不要 */
export function requirementLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(BULLET, '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

const text = (value: unknown, field: keyof typeof ASSIGNMENT_LIMITS, required: boolean): string | undefined => {
  if (value === undefined) {
    if (required) throw new ApiError(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ApiError(400, `${field} is required`);
  if (trimmed.length > ASSIGNMENT_LIMITS[field]) throw new ApiError(400, `${field} is too long (max ${ASSIGNMENT_LIMITS[field]})`);
  return trimmed;
};

/** 请求体 → 字段。partial 用于修改：没给的字段不动 */
export function parseAssignmentInput(body: unknown, { partial = false }: { partial?: boolean } = {}): AssignmentInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const out: AssignmentInput = {};
  const title = text(b.title, 'title', !partial);
  if (title !== undefined) out.title = title;
  const content = text(b.content, 'content', false);
  if (content !== undefined) out.content = content;
  const requirements = text(b.requirements, 'requirements', false);
  if (requirements !== undefined) out.requirements = requirements;

  if (b.due_at !== undefined) {
    if (b.due_at === null || b.due_at === '') out.dueAt = null;
    else if (typeof b.due_at !== 'string' || Number.isNaN(Date.parse(b.due_at))) throw new ApiError(400, 'due_at must be an ISO date');
    else out.dueAt = new Date(b.due_at).toISOString();
  }
  if (b.group_ids !== undefined && b.group_ids !== null) {
    if (!Array.isArray(b.group_ids) || b.group_ids.some(id => typeof id !== 'string')) throw new ApiError(400, 'group_ids must be an array of ids');
    out.groupIds = [...new Set(b.group_ids as string[])];
  }
  if (b.space_id !== undefined) out.spaceId = b.space_id ? String(b.space_id) : null;
  if (b.view_id !== undefined) out.viewId = b.view_id ? String(b.view_id).slice(0, 64) : null;
  if (b.placement !== undefined) {
    if (!PLACEMENTS.includes(b.placement as Placement)) throw new ApiError(400, `placement must be one of: ${PLACEMENTS.join(', ')}`);
    out.placement = b.placement as Placement;
  } else if (out.viewId !== undefined || out.spaceId !== undefined) {
    // 旧的调用方式：给了视图就是 view，否则不限
    out.placement = out.viewId ? 'view' : 'any';
  }
  if (out.placement === 'view' && (!out.spaceId || !out.viewId)) throw new ApiError(400, 'placement view needs space_id and view_id');
  if (out.placement === 'group_view' && !out.spaceId) throw new ApiError(400, 'placement group_view needs space_id');
  return out;
}

/** 存进库的三列：不限位置时不留空间和视图；各组视图只留空间 */
export function placementColumns(input: Pick<AssignmentInput, 'placement' | 'spaceId' | 'viewId'>) {
  const placement = input.placement ?? 'any';
  if (placement === 'view') return { placement, space_id: input.spaceId ?? null, view_id: input.viewId ?? null };
  if (placement === 'group_view') return { placement, space_id: input.spaceId ?? null, view_id: null };
  return { placement: 'any' as const, space_id: input.spaceId ?? null, view_id: null };
}

/**
 * 能不能换组长（PUT /groups/:id/leader）：教职随时可以；组员在还没有组长时可以指定任何组员（包括自己），
 * 有了组长以后只有组长本人能移交或卸任。原组长已经不在组里，当作没有组长。
 */
export function canChangeLeader(args: { isStaff: boolean; userId: string; currentLeaderId: string | null }): { ok: true } | { ok: false; reason: string } {
  if (args.isStaff) return { ok: true };
  if (!args.currentLeaderId) return { ok: true };
  if (args.currentLeaderId === args.userId) return { ok: true };
  return { ok: false, reason: 'Only the current leader or a teacher can change the leader' };
}

export function shapeAssignment(
  row: AssignmentRow,
  groups: Array<{ id: string; name: string }>,
  authorName: string | null,
): ApiGroupAssignment {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    content: row.content ?? '',
    requirements: requirementLines(row.requirements ?? ''),
    requirementsText: row.requirements ?? '',
    dueAt: row.due_at,
    // 空间被删（space_id 置空）的任务退回不限位置
    placement: row.space_id ? (row.placement ?? (row.view_id ? 'view' : 'any')) : 'any',
    spaceId: row.space_id,
    viewId: row.space_id && (row.placement ?? 'view') === 'view' ? row.view_id : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: row.created_by ? { id: row.created_by, name: authorName ?? '' } : null,
    groups,
  };
}

/** 这门课的组，按建立先后 */
export async function courseGroups(courseId: string): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from('groups').select('id, name, created_at').eq('course_id', courseId).order('created_at');
  if (error) throw new ApiError(500, error.message);
  return (data ?? []).map(g => ({ id: g.id as string, name: String(g.name ?? '') }));
}

/** 用户在这门课里所在的组 */
export async function memberGroupIds(courseId: string, userId: string, groups?: Array<{ id: string }>): Promise<Set<string>> {
  const list = groups ?? await courseGroups(courseId);
  if (list.length === 0) return new Set();
  const { data, error } = await supabase.from('group_members').select('group_id').eq('user_id', userId).in('group_id', list.map(g => g.id));
  if (error) throw new ApiError(500, error.message);
  return new Set((data ?? []).map(r => r.group_id as string));
}

/**
 * 读一批任务连同发给了哪些组、发布人的名字。visibleGroups 给了就只留这些组（学生只看自己组），
 * 一个可见组都不剩的任务丢掉。
 */
export async function loadAssignments(
  courseId: string,
  opts: { ids?: string[]; visibleGroups?: Set<string> | null } = {},
): Promise<ApiGroupAssignment[]> {
  let query = supabase.from('group_assignments').select('*').eq('course_id', courseId).is('deleted_at', null).order('created_at', { ascending: false });
  if (opts.ids) query = query.in('id', opts.ids);
  const { data: rows, error } = await query;
  if (error) throw new ApiError(500, error.message);
  const list = (rows ?? []) as AssignmentRow[];
  if (list.length === 0) return [];

  const ids = list.map(r => r.id);
  const authorIds = [...new Set(list.map(r => r.created_by).filter((id): id is string => Boolean(id)))];
  const [targets, groups, authors] = await Promise.all([
    supabase.from('group_assignment_targets').select('assignment_id, group_id').in('assignment_id', ids),
    courseGroups(courseId),
    authorIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', authorIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }>, error: null }),
  ]);
  if (targets.error) throw new ApiError(500, targets.error.message);
  const groupName = new Map(groups.map(g => [g.id, g.name]));
  const authorName = new Map(((authors.data ?? []) as Array<{ id: string; full_name: string | null }>).map(p => [p.id, p.full_name ?? '']));
  const byAssignment = new Map<string, Array<{ id: string; name: string }>>();
  for (const t of (targets.data ?? []) as Array<{ assignment_id: string; group_id: string }>) {
    if (!groupName.has(t.group_id)) continue;
    if (opts.visibleGroups && !opts.visibleGroups.has(t.group_id)) continue;
    const arr = byAssignment.get(t.assignment_id) ?? [];
    arr.push({ id: t.group_id, name: groupName.get(t.group_id)! });
    byAssignment.set(t.assignment_id, arr);
  }
  const order = new Map(groups.map((g, i) => [g.id, i]));
  return list
    .filter(r => !opts.visibleGroups || (byAssignment.get(r.id)?.length ?? 0) > 0)
    .map(r => shapeAssignment(
      r,
      (byAssignment.get(r.id) ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
      r.created_by ? authorName.get(r.created_by) ?? null : null,
    ));
}

/** 发布时选的位置要在这门课里：空间属于这门课，视图是主画布或这个空间里的视图 */
export async function validatePlacement(courseId: string, placement: Placement, spaceId: string | null | undefined, viewId: string | null | undefined): Promise<void> {
  if (!spaceId) {
    if (placement !== 'any' || viewId) throw new ApiError(400, 'This placement needs space_id');
    return;
  }
  const { data: space, error } = await supabase.from('spaces').select('id, course_id').eq('id', spaceId).maybeSingle();
  if (error || !space || space.course_id !== courseId) throw new ApiError(400, 'space_id must be a space in this course');
  if (placement !== 'view' || !viewId || viewId === WELCOME_VIEW_ID) return;
  const { data: view, error: viewError } = await supabase.from('views').select('id, space_id').eq('id', viewId).maybeSingle();
  if (viewError || !view || view.space_id !== spaceId) throw new ApiError(400, 'view_id must be a view in that space');
}
