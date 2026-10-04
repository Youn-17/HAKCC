import { describe, expect, it } from 'vitest';
import {
  defaultCourseId,
  MEMBER_FALLBACK_MODE,
  offeredCourses,
  planAgentRequest,
  type AgentCourse,
} from './agentCourses';

/**
 * 教师账号凭学生验证码入课，在那门课只是普通成员，后端对备课 / 学情分析回 403。
 * 前端照 /personal-agent/configs 的 teacherModes 挑课、挑模式，第一句话不该撞上这个 403。
 */

const listens: AgentCourse = { id: 'c-listen', title: '只听课的课', standing: 'member', teacherModes: false };
const teaches: AgentCourse = { id: 'c-teach', title: '自己教的课', standing: 'owner', teacherModes: true };
const manages: AgentCourse = { id: 'c-manage', title: '当管理员的课', standing: 'manager', teacherModes: true };
// 线上 6 个这样的教师账号里有 4 个是这种：只听课的那门排在最前
const mixed = [listens, teaches, manages];

describe('备课助手 / 学情分析 / 教学评估：固定是教师模式', () => {
  it.each(['lesson_planner', 'teaching_analyst'])('%s 只列有教职的课，默认选第一门有教职的', (mode) => {
    const offered = offeredCourses(mixed, mode, true);

    expect(offered.map((c) => c.id)).toEqual(['c-teach', 'c-manage']);
    expect(defaultCourseId(offered, mode)).toBe('c-teach');
  });

  it('一门有教职的课都没有：不列课、不选课', () => {
    const offered = offeredCourses([listens], 'lesson_planner', true);

    expect(offered).toEqual([]);
    expect(defaultCourseId(offered, 'lesson_planner')).toBe('');
  });

  it('选中有教职的课：照常发，API key 和上下文都是这门课', () => {
    expect(planAgentRequest({ mode: 'teaching_analyst', modeLocked: true, courses: mixed, selectedCourseId: 'c-manage' }))
      .toEqual({ agentMode: 'teaching_analyst', courseId: 'c-manage', contextCourseId: 'c-manage' });
  });

  it('没选课：不发，先让人选课；一门有教职的课都没有时说清楚没有', () => {
    expect(planAgentRequest({ mode: 'lesson_planner', modeLocked: true, courses: mixed, selectedCourseId: '' }))
      .toEqual({ blocked: 'pick_course' });
    expect(planAgentRequest({ mode: 'lesson_planner', modeLocked: true, courses: [listens], selectedCourseId: '' }))
      .toEqual({ blocked: 'no_teacher_course' });
  });

  it('万一选中的是只听课的课，也不按教师模式发出去', () => {
    expect(planAgentRequest({ mode: 'lesson_planner', modeLocked: true, courses: mixed, selectedCourseId: 'c-listen' }))
      .toEqual({ blocked: 'pick_course' });
  });
});

describe('教师端 AI 对话：默认备课模式，但任何课都能聊', () => {
  const chat = (courses: AgentCourse[], selectedCourseId: string) =>
    planAgentRequest({ mode: 'lesson_planner', modeLocked: false, courses, selectedCourseId });

  it('列出全部课，默认选第一门有教职的课，不是列表第一门', () => {
    const offered = offeredCourses(mixed, 'lesson_planner', false);

    expect(offered.map((c) => c.id)).toEqual(['c-listen', 'c-teach', 'c-manage']);
    expect(defaultCourseId(offered, 'lesson_planner')).toBe('c-teach');
  });

  it('有教职的课：按备课模式发', () => {
    expect(chat(mixed, 'c-teach')).toEqual({ agentMode: 'lesson_planner', courseId: 'c-teach', contextCourseId: 'c-teach' });
  });

  it('只听课的课：换成想法发展，课程照带', () => {
    expect(chat(mixed, 'c-listen')).toEqual({ agentMode: MEMBER_FALLBACK_MODE, courseId: 'c-listen', contextCourseId: 'c-listen' });
    expect(MEMBER_FALLBACK_MODE).toBe('idea_coach');
  });

  it('不关联课程：API key 落在第一门有教职的课，不带笔记上下文，不交给后端随便挑', () => {
    expect(chat(mixed, '')).toEqual({ agentMode: 'lesson_planner', courseId: 'c-teach' });
  });

  it('一门有教职的课都没有：选哪门、不选课都按想法发展发', () => {
    const offered = offeredCourses([listens], 'lesson_planner', false);

    expect(defaultCourseId(offered, 'lesson_planner')).toBe('c-listen');
    expect(chat([listens], 'c-listen')).toEqual({ agentMode: MEMBER_FALLBACK_MODE, courseId: 'c-listen', contextCourseId: 'c-listen' });
    expect(chat([listens], '')).toEqual({ agentMode: MEMBER_FALLBACK_MODE, courseId: undefined, contextCourseId: undefined });
  });
});

describe('不涉及教师模式的，行为和原来一样', () => {
  it('学生端：全部课照列，默认第一门，模式和课程原样发', () => {
    const offered = offeredCourses(mixed, 'idea_coach', false);

    expect(offered).toEqual(mixed);
    expect(defaultCourseId(offered, 'idea_coach')).toBe('c-listen');
    expect(planAgentRequest({ mode: 'gap_finder', modeLocked: false, courses: mixed, selectedCourseId: 'c-listen' }))
      .toEqual({ agentMode: 'gap_finder', courseId: 'c-listen', contextCourseId: 'c-listen' });
    expect(planAgentRequest({ mode: 'idea_coach', modeLocked: false, courses: mixed, selectedCourseId: '' }))
      .toEqual({ agentMode: 'idea_coach', courseId: undefined, contextCourseId: undefined });
  });

  it('旧版后端不带 teacherModes（前端先上线的那几分钟）：不当成没有教职，一切照旧', () => {
    const legacy: AgentCourse[] = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];

    expect(offeredCourses(legacy, 'lesson_planner', true)).toEqual(legacy);
    expect(defaultCourseId(legacy, 'lesson_planner')).toBe('a');
    expect(planAgentRequest({ mode: 'lesson_planner', modeLocked: false, courses: legacy, selectedCourseId: 'b' }))
      .toEqual({ agentMode: 'lesson_planner', courseId: 'b', contextCourseId: 'b' });
  });
});
