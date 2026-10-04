import { supabase } from '../config/supabase';
import { ApiError } from '../middleware/errorHandler';
import type { AuthUser } from '../middleware/auth';
import { TtlCache } from './ttlCache';

/** 课内身份：owner=创建者，manager=课程管理员，member=普通成员，none=不在课里。 */
export type CourseStanding = 'owner' | 'manager' | 'member' | 'none';

/**
 * 课程教职 = 平台管理员、课程创建者、课程管理员。改删别人的内容、看教师才看的数据，都按它判断。
 *
 * 平台身份是教师不算数：教师账号拿学生验证码自助入课，course_members 里写的是
 * role='student'；被邀请、还没设为管理员的教师是 'member'。他们在这门课里都是普通成员。
 * 反过来，成员行单独也不算数，见 memberStanding。
 */
export function isCourseStaff(standing: CourseStanding | undefined): boolean {
  return standing === 'owner' || standing === 'manager';
}

export interface AccessibleSpace {
  id: string;
  course_id: string;
  group_id?: string | null;
  /** 这门课的教师。权限检查本来就查了它，顺手带出来，
   *  调用方就不用再走一遍 spaces→courses→profiles 三次串行去拿教师名字。 */
  instructor_id?: string | null;
  /** 调用者的课内身份（平台管理员按 owner 算）。进得了空间就一定在课里，所以没有 none。
   *  判定时已经查过了，调用方拿它做教职判断，不必再往返一次数据库。 */
  standing: Exclude<CourseStanding, 'none'>;
}

export interface AccessibleNote {
  id: string;
  space_id: string;
  course_id: string;
  author_id: string;
  content?: string | null;
  title?: string | null;
  /** 调用者在笔记所在课程里的身份，同 AccessibleSpace.standing。 */
  standing: Exclude<CourseStanding, 'none'>;
}

export interface AccessibleGroup {
  id: string;
  course_id: string;
  name: string | null;
  created_at: string;
  /** 调用者的课内身份，同 AccessibleSpace.standing。 */
  standing: Exclude<CourseStanding, 'none'>;
}

function courseInstructorId(space: Record<string, unknown>): string | undefined {
  const course = space.courses;
  if (!course || typeof course !== 'object') return undefined;
  return (course as Record<string, unknown>).instructor_id as string | undefined;
}

/**
 * 空间归属哪门课、绑哪个组、课的教师是谁——这些几乎不变，但每个请求都要查一遍。
 * 缓存 60 秒省掉一次往返（约 300ms）。
 *
 * **只缓存空间本身的属性，不缓存任何授权判定**：成员资格、分组归属每次都实查，
 * 否则把学生移出课程后他还能再进 60 秒。
 */
const spaceCache = new TtlCache<{ id: string; course_id: string; group_id: string | null; instructor_id: string | null }>(60_000, 2000);

/**
 * 成员行的归类。manager = course_members.role 为 teacher/admin，只有创建者能授予；
 * 其余都是 member —— 自助入课写 student，被邀请的教师写 member。
 * 这一行算不算数（能不能当课程管理员用），见 memberStanding。
 */
export type CourseMemberRole = 'manager' | 'member';

// 「这个学生是这门课 / 这个小组的成员」的肯定答案缓存 30 秒。
// 每个请求都要先答这个问题，而 VPS 到首尔一次往返 115ms，全站每个接口都在付这笔钱。
// 只缓存肯定答案：新加入的学生立刻能进；被移除的学生最多再多 30 秒，且移除处会主动清缓存。
// 课程这边连课内身份一起存（绑组空间靠它判断能不能跨组），授予 / 撤销管理员处同样清缓存。
const courseMemberCache = new TtlCache<CourseMemberRole>(30_000, 20_000);
const groupMemberCache = new TtlCache<true>(30_000, 20_000);
const memberKey = (courseId: string, userId: string) => `course:${courseId}|user:${userId}`;
const groupKey = (groupId: string, userId: string) => `group:${groupId}|user:${userId}`;

export function invalidateMembershipCache(): void {
  courseMemberCache.clear();
  groupMemberCache.clear();
}

/** 课内身份（带 30 秒肯定缓存）。查询失败抛 503，不在课里返回 null。 */
export async function courseMemberRole(courseId: string, userId: string): Promise<CourseMemberRole | null> {
  const key = memberKey(courseId, userId);
  const cached = courseMemberCache.get(key);
  if (cached) return cached;
  const { data, error } = await supabase
    .from('course_members')
    .select('role')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .maybeSingle();
  // 数据库过载时查询失败，不是「不是成员」——报 503 让客户端重试，别把学生赶出课程。
  if (error) throw new ApiError(503, 'Service temporarily unavailable, please retry');
  if (!data) return null;
  const role: CourseMemberRole = data.role === 'teacher' || data.role === 'admin' ? 'manager' : 'member';
  courseMemberCache.set(key, role);
  return role;
}

/**
 * 成员行 → 课内身份。课程管理员除了 course_members.role 为 teacher/admin，平台身份还得是教师：
 * 授予只由创建者对教师账号做（PATCH …/role 拒绝学生），而一行成员记录本身证明不了什么——
 * 学生能自己写进一行（自助入课，或直连数据库），口径同 ensureCourseInstructor。
 */
function memberStanding(memberRole: CourseMemberRole | null, user: Pick<AuthUser, 'role'>): CourseMemberRole | null {
  if (!memberRole) return null;
  return memberRole === 'manager' && user.role === 'teacher' ? 'manager' : 'member';
}

/** 课程成员判定（带 30 秒肯定缓存）。查询失败抛 503，不是成员返回 false。 */
export async function isCourseMember(courseId: string, userId: string): Promise<boolean> {
  return (await courseMemberRole(courseId, userId)) !== null;
}

async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const key = groupKey(groupId, userId);
  if (groupMemberCache.get(key)) return true;
  const { data, error } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new ApiError(503, 'Service temporarily unavailable, please retry');
  if (!data) return false;
  groupMemberCache.set(key, true);
  return true;
}

export function invalidateSpaceCache(spaceId?: string): void {
  if (spaceId) spaceCache.delete(spaceId); else spaceCache.clear();
}

export async function ensureSpaceAccess(spaceId: string, user: Pick<AuthUser, 'id' | 'role'>): Promise<AccessibleSpace> {
  let cachedSpace = spaceCache.get(spaceId);
  if (!cachedSpace) {
    const { data: space, error } = await supabase
      .from('spaces')
      .select('id, course_id, group_id, courses!inner(instructor_id)')
      .eq('id', spaceId)
      .single();

    if (error || !space) throw new ApiError(404, 'Space not found');
    cachedSpace = {
      id: space.id as string,
      course_id: space.course_id as string,
      group_id: (space.group_id as string | null) ?? null,
      instructor_id: courseInstructorId(space) ?? null,
    };
    spaceCache.set(spaceId, cachedSpace);
  }
  const space: NonNullable<typeof cachedSpace> = cachedSpace;

  const courseId = space.course_id;
  const groupId = space.group_id;
  const result = {
    id: space.id,
    course_id: courseId,
    group_id: groupId,
    instructor_id: space.instructor_id,
  };

  if (user.role === 'admin' || space.instructor_id === user.id) {
    return { ...result, standing: 'owner' };
  }

  // 课程成员 + 分组归属两个判定互不依赖，一起发，省掉一次串行往返。
  // 肯定答案缓存 30 秒（见 courseMemberRole），命中时这里一次往返都不用发。
  //
  // 绑定到小组的空间，组外的人完全进不来——整群随机实验靠这条隔离组间污染。
  // 能跨组的只认课内身份（创建者上面已放行，再加课程管理员，见 memberStanding）。
  // 平台身份是教师不算数：教师账号拿学生验证码自助入课，course_members 里写的是
  // role='student'。缓存里已知是管理员的，不必再查组。
  const knownManager = memberStanding(courseMemberCache.get(memberKey(courseId, user.id)) ?? null, user) === 'manager';
  const needGroupCheck = Boolean(groupId) && !knownManager;
  const [memberRole, inGroup] = await Promise.all([
    courseMemberRole(courseId, user.id),
    needGroupCheck ? isGroupMember(groupId as string, user.id) : Promise.resolve(true),
  ]);

  const standing = memberStanding(memberRole, user);
  if (!standing) throw new ApiError(403, 'You are not a member of this course');
  if (standing !== 'manager' && !inGroup) throw new ApiError(403, 'This space belongs to another group');

  return { ...result, standing };
}

/** 进得了空间、而且是这门课的教职才放行：空间里全员的数据（参与度、研究数据）走这道。 */
export async function ensureSpaceStaff(spaceId: string, user: Pick<AuthUser, 'id' | 'role'>): Promise<AccessibleSpace> {
  const space = await ensureSpaceAccess(spaceId, user);
  if (!isCourseStaff(space.standing)) throw new ApiError(403, 'Only the course instructor can perform this action');
  return space;
}

/**
 * 这门课里调用者进得去的空间，按建立先后。逐个过 ensureSpaceAccess，不另写一份规则：
 * 绑定小组的空间只对本组开放，能跨组的只有平台管理员、创建者和课程管理员；不在课里的
 * 一个也拿不到。判定失败的（含查询出错）一律跳过——上下文可以少带，不能带错。
 */
export async function enterableSpaceIds(courseId: string, user: Pick<AuthUser, 'id' | 'role'>): Promise<string[]> {
  const { data: spaces } = await supabase
    .from('spaces')
    .select('id')
    .eq('course_id', courseId)
    .order('created_at', { ascending: true });
  const ids = (spaces ?? []).map((s: any) => s.id as string);
  const verdicts = await Promise.allSettled(ids.map((id) => ensureSpaceAccess(id, user)));
  return ids.filter((_, i) => verdicts[i].status === 'fulfilled');
}

async function getCourseOrThrow(courseId: string): Promise<{ id: string; instructor_id: string | null }> {
  const { data, error } = await supabase
    .from('courses')
    .select('id, instructor_id')
    .eq('id', courseId)
    .single();
  if (error || !data) throw new ApiError(404, 'Course not found');
  return data as { id: string; instructor_id: string | null };
}

/** Allow admins, the course's instructor, and co-teachers (teachers in course_members). */
export async function ensureCourseInstructor(courseId: string, user: AuthUser): Promise<void> {
  if (user.role === 'admin') return;
  const course = await getCourseOrThrow(courseId);
  if (course.instructor_id === user.id) return;

  // A membership row alone proves nothing: students self-insert one via
  // POST /courses/:id/join. Only a row explicitly marked as co-teaching —
  // written by the invite flow — grants instructor rights.
  if (user.role === 'teacher') {
    const { data: membership } = await supabase
      .from('course_members')
      .select('role')
      .eq('course_id', courseId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membership?.role === 'teacher' || membership?.role === 'admin') return;
  }

  throw new ApiError(403, 'Only the course instructor can perform this action');
}

/**
 * 只放行课程创建者（和平台管理员）。
 *
 * 和 ensureCourseInstructor 的区别：那个会放行 course_members.role='teacher'
 * 的课程管理员。授予和收回管理权本身必须留在创建者手里 —— 否则被邀请的人
 * 可以再邀请别人，权限会自己扩散出去，而创建者没有任何办法收回。
 */
export async function ensureCourseOwner(courseId: string, user: AuthUser): Promise<void> {
  if (user.role === 'admin') return;
  const course = await getCourseOrThrow(courseId);
  if (course.instructor_id === user.id) return;
  throw new ApiError(403, 'Only the teacher who created this course can perform this action');
}

export async function getCourseStanding(courseId: string, user: Pick<AuthUser, 'id' | 'role'>): Promise<CourseStanding> {
  // 课程和成员身份一起发，省一次串行往返；成员身份走 30 秒缓存。
  // 创建者用不上成员查询的结果，那边失败也不该连累他，所以先挂一个空的 catch。
  const memberRole = user.role === 'admin' ? null : courseMemberRole(courseId, user.id);
  memberRole?.catch(() => {});
  const course = await getCourseOrThrow(courseId);
  if (course.instructor_id === user.id) return 'owner';
  // 平台管理员按创建者对待，和 ensureCourseOwner 保持一致
  if (user.role === 'admin') return 'owner';
  // 查询失败 courseMemberRole 报 503，不当成「不在课里」
  return memberStanding(await memberRole, user) ?? 'none';
}

/**
 * 调用者所在的每一门课及其课内身份（不含 none）。口径同 getCourseStanding（课程管理员也要求教师账号，
 * 见 memberStanding），只是两次查询拿全，不按课逐个查。查询失败报 503，不拿半份结果当全部。
 */
export async function listCourseStandings(user: Pick<AuthUser, 'id' | 'role'>): Promise<Map<string, Exclude<CourseStanding, 'none'>>> {
  const [memberships, owned] = await Promise.all([
    supabase.from('course_members').select('course_id, role').eq('user_id', user.id),
    supabase.from('courses').select('id').eq('instructor_id', user.id),
  ]);
  if (memberships.error || owned.error) throw new ApiError(503, 'Service temporarily unavailable, please retry');

  const standings = new Map<string, Exclude<CourseStanding, 'none'>>();
  for (const m of memberships.data ?? []) {
    const row: CourseMemberRole = m.role === 'teacher' || m.role === 'admin' ? 'manager' : 'member';
    // 平台管理员按创建者对待，同 getCourseStanding
    standings.set(m.course_id as string, user.role === 'admin' ? 'owner' : memberStanding(row, user) ?? 'member');
  }
  for (const c of owned.data ?? []) standings.set(c.id as string, 'owner');
  return standings;
}

/**
 * 组里的东西（任务板、观点图谱、本组讨论速览）只给本组成员和课程教职，口径同绑组空间。
 * 小组是整群随机实验的分配单位：按组 id 寻址的路由只查课程成员的话，
 * 组 A 的学生换一个 id 就读写了组 B 的东西。
 * 组员行本身不够：移出课程不删组员行，所以还得在课里。
 */
export async function ensureGroupAccess(groupId: string, user: Pick<AuthUser, 'id' | 'role'>): Promise<AccessibleGroup> {
  const { data: group, error } = await supabase
    .from('groups')
    .select('id, course_id, name, created_at')
    .eq('id', groupId)
    .maybeSingle();
  // 口径同 ensureSpaceAccess：查不到就是不存在（不是 UUID 的 id 在库里也是报错）
  if (error || !group) throw new ApiError(404, 'Group not found');

  // 两个判定一起发。教职用不上组员的答案，那边失败也不该连累他
  const inGroup = isGroupMember(groupId, user.id);
  inGroup.catch(() => {});
  const standing = await getCourseStanding(group.course_id as string, user);
  if (standing === 'none') throw new ApiError(403, 'You are not a member of this course');
  if (!isCourseStaff(standing) && !(await inGroup)) throw new ApiError(403, 'Not a member of this group');

  return {
    id: group.id as string,
    course_id: group.course_id as string,
    name: (group.name as string | null) ?? null,
    created_at: group.created_at as string,
    standing,
  };
}

/** Allow admins, the course's instructor, and enrolled members; reject everyone else. Returns the caller's standing. */
export async function ensureCourseMember(courseId: string, user: Pick<AuthUser, 'id' | 'role'>): Promise<Exclude<CourseStanding, 'none'>> {
  if (user.role === 'admin') return 'owner';
  const standing = await getCourseStanding(courseId, user);
  if (standing === 'none') throw new ApiError(403, 'You are not a member of this course');
  return standing;
}

export async function ensureNoteAccess(noteId: string, user: Pick<AuthUser, 'id' | 'role'>): Promise<AccessibleNote> {
  const { data: note, error } = await supabase
    .from('notes')
    .select('id, space_id, author_id, content, title')
    .eq('id', noteId)
    .is('deleted_at', null)
    .single();

  if (error || !note) throw new ApiError(404, 'Note not found');
  const space = await ensureSpaceAccess(note.space_id as string, user);

  return {
    id: note.id as string,
    space_id: note.space_id as string,
    course_id: space.course_id,
    author_id: note.author_id as string,
    content: note.content as string | null,
    title: note.title as string | null,
    standing: space.standing,
  };
}
