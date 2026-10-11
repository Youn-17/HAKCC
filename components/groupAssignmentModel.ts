import type { ApiGroupAssignment } from '../services/apiClient';
import { WELCOME_VIEW_ID } from './viewPalette';

/**
 * 教师发布的小组任务（2026-10-10）：任务面板和发布表单用到的纯函数。
 * 接口规则见 api/src/services/groupAssignments.ts。
 */

export interface ViewMeta { id: string; title: string; groupId?: string | null }

/**
 * 这条任务在当前视图里显示吗：
 *   - any：到处显示（给了空间就只在那个空间）；
 *   - view：只在那个视图，视图被删了就显示在主画布（和笔记的规矩一样）；
 *   - group_view：在发给的那些组各自的视图里；某个组在这个空间里还没有视图，就给这个组显示在主画布。
 * 学生拿到的 groups 只有自己的组，所以只在自己组的视图里看到。
 */
export function visibleInView(
  assignment: Pick<ApiGroupAssignment, 'placement' | 'spaceId' | 'viewId' | 'groups'>,
  spaceId: string,
  viewId: string,
  views: ReadonlyArray<ViewMeta>,
): boolean {
  if (assignment.spaceId && assignment.spaceId !== spaceId) return false;
  const placement = assignment.spaceId ? assignment.placement ?? 'any' : 'any';
  if (placement === 'any') return true;
  if (placement === 'view') {
    if (!assignment.viewId || assignment.viewId === viewId) return true;
    return viewId === WELCOME_VIEW_ID && assignment.viewId !== WELCOME_VIEW_ID && !views.some(v => v.id === assignment.viewId);
  }
  const targets = new Set(assignment.groups.map(g => g.id));
  const current = views.find(v => v.id === viewId);
  if (current?.groupId) return targets.has(current.groupId);
  return viewId === WELCOME_VIEW_ID && [...targets].some(gid => !views.some(v => v.groupId === gid));
}

/** 这条任务显示在哪些视图（不限位置的返回 null）：学生不在那里时，面板提示去哪看 */
export function assignmentViews(
  assignment: Pick<ApiGroupAssignment, 'placement' | 'spaceId' | 'viewId' | 'groups'>,
  spaceId: string,
  views: ReadonlyArray<ViewMeta>,
): ViewMeta[] | null {
  if (!assignment.spaceId || (assignment.placement ?? 'any') === 'any') return null;
  if (assignment.spaceId !== spaceId) return [];
  return views.filter(v => visibleInView(assignment, spaceId, v.id, views));
}

export type DueTone = 'normal' | 'soon' | 'overdue';

/** 「截止 10月20日 18:00」；24 小时内到期标 soon，过了标 overdue */
export function dueLabel(dueAt: string | null, lang: 'zh' | 'en', now: Date = new Date()): { text: string; tone: DueTone } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const diff = due.getTime() - now.getTime();
  const tone: DueTone = diff < 0 ? 'overdue' : diff < 86_400_000 ? 'soon' : 'normal';
  const hm = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
  if (lang === 'zh') {
    const date = `${due.getMonth() + 1}月${due.getDate()}日 ${hm}`;
    return { text: diff < 0 ? `已过截止 ${date}` : `截止 ${date}`, tone };
  }
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][due.getMonth()];
  const date = `${month} ${due.getDate()}, ${hm}`;
  return { text: diff < 0 ? `Was due ${date}` : `Due ${date}`, tone };
}

/** 一条任务的「版本」：内容改过就算新的，面板要重新展开给人看 */
export const assignmentVersion = (a: Pick<ApiGroupAssignment, 'id' | 'updatedAt'>) => `${a.id}@${a.updatedAt}`;

const SEEN_KEY = 'hakcc-group-task-seen';

export function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markSeen(versions: string[]): void {
  try {
    const merged = [...readSeen(), ...versions];
    localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set(merged)].slice(-200)));
  } catch { /* 隐私模式下记不住，下次再展开一次 */ }
}

/** datetime-local 的值 ↔ ISO：输入框按本地时间显示 */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 发布表单里位置的说明：「所有视图」「Welcome」「第3周」 */
export function placementLabel(
  assignment: Pick<ApiGroupAssignment, 'placement' | 'spaceId' | 'viewId'>,
  views: ReadonlyArray<{ id: string; title: string }>,
  lang: 'zh' | 'en',
): string {
  if (assignment.spaceId && assignment.placement === 'group_view') return lang === 'zh' ? '各组自己的视图' : "Each group's own view";
  if (!assignment.spaceId || !assignment.viewId) return lang === 'zh' ? '所有视图' : 'All views';
  const view = views.find(v => v.id === assignment.viewId);
  if (view) return view.title;
  return assignment.viewId === WELCOME_VIEW_ID ? 'Welcome' : (lang === 'zh' ? '已删除的视图（显示在 Welcome）' : 'Deleted view (shown in Welcome)');
}

/**
 * 组长操作（和后端 canChangeLeader 同一口径）：教职随时可以换；组员在没有组长时可以指定任何组员，
 * 有了组长以后只有组长本人能移交或卸任。原组长不在组里当作没有组长。
 */
export function leaderPermissions(args: { isStaff: boolean; userId: string; leaderId: string | null | undefined; memberIds: readonly string[] }) {
  const current = args.leaderId && args.memberIds.includes(args.leaderId) ? args.leaderId : null;
  const inGroup = args.memberIds.includes(args.userId);
  const canAssign = args.isStaff || (inGroup && (!current || current === args.userId));
  return { current, canAssign, canClear: Boolean(current) && (args.isStaff || current === args.userId) };
}

/**
 * 小组概览里把一个人放进某个组、移到别的组，或移出小组（targetId = null；2026-10-10 用户：分错了要能改）。
 * 一个人同时只在一个组里；组长被移走，那个组的组长一并取消（后端移出时也会清）。
 * restoreLeaderOf：操作没成功、要放回原组时，把那个组的组长还给他。
 */
export function placeMember<G extends { id: string; memberIds: string[]; leaderId?: string }>(
  groups: readonly G[], memberId: string, targetId: string | null, restoreLeaderOf?: string,
): G[] {
  return groups.map(g => {
    const memberIds = g.memberIds.filter(id => id !== memberId);
    if (g.id === targetId) memberIds.push(memberId);
    let leaderId = g.leaderId;
    if (g.id === restoreLeaderOf) leaderId = memberId;
    else if (leaderId === memberId && g.id !== targetId) leaderId = undefined;
    return { ...g, memberIds, leaderId };
  });
}
