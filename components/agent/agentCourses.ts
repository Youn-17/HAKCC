/**
 * 个人助手（教师端 AI 对话 / 备课助手 / 学情分析 / 教学评估）按课选模式。
 *
 * 备课和学情分析两个教师模式，后端按课内教职放行：教师账号凭学生验证码入课、或受邀后还没被设为
 * 课程管理员，在那门课只是普通成员，发过去就是 403。/personal-agent/configs 给每门课带了
 * teacherModes，这里只照它挑课、挑模式，不自己再判一遍权限——放不放行以后端为准。
 */

export type AgentCourseStanding = 'owner' | 'manager' | 'member';

export interface AgentCourse {
  id: string;
  title: string;
  /** 课内身份：创建者 / 课程管理员 / 普通成员 */
  standing?: AgentCourseStanding;
  /** 这门课能不能用备课 / 学情分析。旧版后端不带这个字段，按能用处理，和原来一样。 */
  teacherModes?: boolean;
}

const TEACHER_ONLY_MODES = new Set(['lesson_planner', 'teaching_analyst']);

/** AI 对话在没有教职的课里改用的模式：学生端的默认模式，后端对空模式的缺省值也是它。 */
export const MEMBER_FALLBACK_MODE = 'idea_coach';

export function isTeacherOnlyMode(mode: string): boolean {
  return TEACHER_ONLY_MODES.has(mode);
}

export function allowsTeacherModes(course: AgentCourse): boolean {
  return course.teacherModes !== false;
}

/**
 * 下拉里列哪些课。固定成教师模式的入口（备课助手 / 学情分析 / 教学评估）只列有教职的课；
 * AI 对话列全部——没有教职的课也能聊，只是换成 MEMBER_FALLBACK_MODE。
 */
export function offeredCourses(courses: AgentCourse[], mode: string, modeLocked: boolean): AgentCourse[] {
  return modeLocked && isTeacherOnlyMode(mode) ? courses.filter(allowsTeacherModes) : courses;
}

/** 默认选中哪门课：要用教师模式就先挑有教职的课，不然取第一门。 */
export function defaultCourseId(offered: AgentCourse[], mode: string): string {
  const preferred = isTeacherOnlyMode(mode) ? offered.find(allowsTeacherModes) : undefined;
  return (preferred ?? offered[0])?.id ?? '';
}

export type AgentRequestPlan =
  | { agentMode: string; courseId?: string; contextCourseId?: string }
  | { blocked: 'pick_course' | 'no_teacher_course' };

/**
 * 这条消息按什么模式、带哪门课发给 /personal-agent/stream。教师模式只发往有教职的课：
 * - 选中的课有教职：照常，API key、教师工具和笔记上下文都是这门课。
 * - 固定教师模式的入口没选课：不发，先让人选课。
 * - AI 对话「不关联课程」：API key 和教师工具落在第一门有教职的课，不带笔记上下文。
 *   以前交给后端随便挑一门，挑到只听课的那门就 403。
 * - AI 对话选中了只听课的课，或者一门有教职的课都没有：换成 MEMBER_FALLBACK_MODE。
 */
export function planAgentRequest({ mode, modeLocked, courses, selectedCourseId }: {
  mode: string;
  modeLocked: boolean;
  courses: AgentCourse[];
  selectedCourseId: string;
}): AgentRequestPlan {
  const inSelectedCourse = (agentMode: string) => ({
    agentMode,
    courseId: selectedCourseId || undefined,
    contextCourseId: selectedCourseId || undefined,
  });
  if (!isTeacherOnlyMode(mode)) return inSelectedCourse(mode);

  const selected = courses.find((c) => c.id === selectedCourseId);
  if (selected && allowsTeacherModes(selected)) return inSelectedCourse(mode);

  const teaching = courses.find(allowsTeacherModes);
  if (modeLocked) return { blocked: teaching ? 'pick_course' : 'no_teacher_course' };
  if (!selected && teaching) return { agentMode: mode, courseId: teaching.id };
  return inSelectedCourse(MEMBER_FALLBACK_MODE);
}
