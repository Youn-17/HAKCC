import type { CourseRole } from '../services/apiClient';
import type { UserRole } from '../types';

/**
 * 课程教职 = 平台管理员、课程创建者、课程管理员，和后端 accessControl.isCourseStaff 同口径。
 * 改删别人的笔记和批注、改别人上传的文档、逐组看任务板、重算观点图谱，后端都按它放行。
 *
 * 平台身份是教师不算数：教师账号凭学生验证码入课，或受邀后还没被设为课程管理员，
 * 在这门课里只是普通成员，按平台身份给他显示这些按钮，点下去就是 403。
 * 课内身份由后端随小组名单带回（viewerStanding）。还没拿到时（请求在路上，或旧版后端
 * 不带这个字段）先按平台身份，和原来一样；拿到以后一律以后端为准。
 */
export function isCourseStaff(standing: CourseRole | null | undefined, userRole: UserRole): boolean {
  if (standing) return standing === 'owner' || standing === 'manager';
  return userRole === 'teacher' || userRole === 'admin';
}

/**
 * 在课里建空间比 isCourseStaff 更严：后端 POST /courses/:id/spaces 只认创建者和平台管理员
 * （平台管理员的课内身份按 owner 算），课程管理员也不行。进课时一个空间都没有、
 * 要不要替这门课建默认空间就看它。拿不到课内身份时同上，按平台身份。
 */
/**
 * 课程管理（课程设置页）给谁进：课程创建者、课程管理员，以及平台管理员（2026-10-06 用户）。
 *
 * 和 isCourseStaff 不同，拿不到课内身份时不按平台身份猜：列表里不知道就不显示入口，
 * 免得凭学生验证码入课的教师看见按钮、点进去却没有权限。
 */
export function canManageCourse(standing: CourseRole | null | undefined, userRole: UserRole): boolean {
  if (userRole === 'admin') return true;
  return standing === 'owner' || standing === 'manager';
}

export function canCreateCourseSpace(standing: CourseRole | null | undefined, userRole: UserRole): boolean {
  if (standing) return standing === 'owner';
  return userRole === 'teacher' || userRole === 'admin';
}

interface GroupLike {
  id: string;
  memberIds?: string[];
}

/**
 * 观点图谱打开哪个组：自己在组里就是自己的组；课程教职没有「所属组」，先看第一个组，
 * 逐组查看走小组管理。其他人不回落到别的组——后端只给本组成员看，回落过去就是一个 403。
 */
export function ideaGraphGroup<G extends GroupLike>(groups: G[], userId: string, isStaff: boolean): G | undefined {
  return groups.find(g => g.memberIds?.includes(userId)) ?? (isStaff ? groups[0] : undefined);
}

/**
 * 小组管理的任务板看哪个组。任务板只给本组成员和课程教职：普通成员只有自己的组；
 * 课程教职可以逐组切换，没选过就先看自己所在的组，不在任何组里就看第一个组。
 */
export function taskBoardGroup<G extends GroupLike>(
  groups: G[], userId: string, isStaff: boolean, pickedId: string | null,
): G | undefined {
  const mine = groups.find(g => g.memberIds?.includes(userId));
  if (!isStaff) return mine;
  return groups.find(g => g.id === pickedId) ?? mine ?? groups[0];
}
