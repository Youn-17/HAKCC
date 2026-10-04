import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 绑定小组的空间只对本组开放，整群随机实验靠它隔离组间污染。
 * ensureSpaceAccess 原先按平台身份免查分组：profiles.role='teacher' 的账号一律跨组。
 * 可任何教师账号拿到学生验证码都能自助入课（course_members.role='student'），于是能进
 * 这门课每个组的空间。能跨组的只该是课内身份：创建者、课程管理员（course_members.role
 * 为 teacher/admin）和平台管理员——口径同数据库里的 can_access_space()。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const seed = (): Record<string, Row[]> => ({
    courses: [
      { id: 'course-1', instructor_id: 'owner-1' },
      { id: 'course-2', instructor_id: 'owner-2' },
    ],
    spaces: [
      { id: 'space-shared', course_id: 'course-1', group_id: null },
      { id: 'space-a', course_id: 'course-1', group_id: 'group-a' },
      { id: 'space-b', course_id: 'course-1', group_id: 'group-b' },
      { id: 'space-2b', course_id: 'course-2', group_id: 'group-2b' },
    ],
    course_members: [
      { course_id: 'course-1', user_id: 'owner-1', role: 'teacher' }, // 建课时自动写入
      { course_id: 'course-1', user_id: 'student-a', role: 'student' },
      { course_id: 'course-1', user_id: 'teacher-joined', role: 'student' }, // 教师账号凭学生验证码入课
      { course_id: 'course-1', user_id: 'teacher-invited', role: 'member' }, // 被邀请、还没设为管理员
      { course_id: 'course-1', user_id: 'co-teacher', role: 'teacher' }, // 课程管理员
      { course_id: 'course-1', user_id: 'course-admin', role: 'admin' },
      { course_id: 'course-1', user_id: 'student-forged', role: 'teacher' }, // 学生账号直连数据库给自己写的管理员行
      { course_id: 'course-2', user_id: 'co-teacher', role: 'student' }, // 在另一门课只是普通成员
      // owner-2 早期建的课，course_members 里没有他那一行
    ],
    groups: [
      { id: 'group-a', course_id: 'course-1', name: '第一组', created_at: '2026-09-01T00:00:00Z' },
      { id: 'group-b', course_id: 'course-1', name: '第二组', created_at: '2026-09-01T00:00:00Z' },
      { id: 'group-2b', course_id: 'course-2', name: '二班第二组', created_at: '2026-09-01T00:00:00Z' },
    ],
    group_members: [
      { group_id: 'group-a', user_id: 'student-a' },
      { group_id: 'group-a', user_id: 'teacher-joined' },
      // 移出课程不删组员行：人已经不在 course-1 里了，这一行还在
      { group_id: 'group-a', user_id: 'student-removed' },
    ],
    notes: [
      { id: 'note-b', space_id: 'space-b', author_id: 'student-b', title: '别组的笔记', content: '', deleted_at: null },
    ],
  });

  const db = seed();
  const reads: string[] = [];
  const failing = new Set<string>();

  // 只实现 accessControl 用到的链：select → eq / is… → single / maybeSingle，或直接 await 拿全部匹配行
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const runMany = () => {
      reads.push(table);
      if (failing.has(table)) return { data: null, error: { message: 'connection reset' } };
      const rows = (db[table] ?? []).filter(r => Object.entries(eq).every(([k, v]) => (r[k] ?? null) === v));
      return { data: rows.map(r => ({ ...r })), error: null };
    };
    const run = (terminal: 'single' | 'maybeSingle') => {
      reads.push(table);
      if (failing.has(table)) return { data: null, error: { message: 'connection reset' } };
      const row = (db[table] ?? []).find(r => Object.entries(eq).every(([k, v]) => (r[k] ?? null) === v));
      if (!row) return { data: null, error: terminal === 'single' ? { message: 'no rows' } : null };
      if (table === 'spaces') {
        const course = db.courses.find(c => c.id === row.course_id);
        return { data: { ...row, courses: { instructor_id: course?.instructor_id ?? null } }, error: null };
      }
      return { data: { ...row }, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, value: unknown) => { eq[col] = value; return builder; },
      is: (col: string, value: unknown) => { eq[col] = value; return builder; },
      single: async () => run('single'),
      maybeSingle: async () => run('maybeSingle'),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve(runMany()).then(onOk, onFail),
    };
    return builder;
  };

  const reset = () => {
    Object.assign(db, seed());
    reads.length = 0;
    failing.clear();
  };

  return { db, reads, failing, from, reset };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));

import type { AuthUser } from '../middleware/auth';
import {
  ensureCourseInstructor,
  ensureCourseMember,
  ensureGroupAccess,
  ensureNoteAccess,
  ensureSpaceAccess,
  ensureSpaceStaff,
  getCourseStanding,
  invalidateMembershipCache,
  invalidateSpaceCache,
  isCourseMember,
  isCourseStaff,
  listCourseStandings,
  type CourseStanding,
} from './accessControl';

const teacher = (id: string) => ({ id, role: 'teacher' as const });
const student = (id: string) => ({ id, role: 'student' as const });
const ANOTHER_GROUP = { statusCode: 403, message: 'This space belongs to another group' };
const NOT_MEMBER = { statusCode: 403, message: 'You are not a member of this course' };
const memberReads = () => h.reads.filter(t => t === 'course_members' || t === 'group_members');

beforeEach(() => {
  h.reset();
  invalidateMembershipCache();
  invalidateSpaceCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('绑定小组的空间：能不能跨组看课内身份，不看平台身份', () => {
  it('教师账号凭学生验证码入课（course_members.role=student）：进不了别组的空间', async () => {
    await expect(ensureSpaceAccess('space-b', teacher('teacher-joined'))).rejects.toMatchObject(ANOTHER_GROUP);
  });

  it('同一个账号在课里就是普通成员：共享空间和本组空间照常能进', async () => {
    await expect(ensureSpaceAccess('space-shared', teacher('teacher-joined'))).resolves.toMatchObject({ id: 'space-shared', group_id: null });
    await expect(ensureSpaceAccess('space-a', teacher('teacher-joined'))).resolves.toMatchObject({ id: 'space-a', group_id: 'group-a' });
  });

  it('被邀请、还没设为课程管理员的教师（role=member）同样按组隔离', async () => {
    await expect(ensureSpaceAccess('space-shared', teacher('teacher-invited'))).resolves.toMatchObject({ id: 'space-shared' });
    await expect(ensureSpaceAccess('space-a', teacher('teacher-invited'))).rejects.toMatchObject(ANOTHER_GROUP);
    await expect(ensureSpaceAccess('space-b', teacher('teacher-invited'))).rejects.toMatchObject(ANOTHER_GROUP);
  });

  it('课程管理员（course_members.role=teacher）不在任何组，也能进每个组的空间', async () => {
    for (const spaceId of ['space-shared', 'space-a', 'space-b']) {
      await expect(ensureSpaceAccess(spaceId, teacher('co-teacher'))).resolves.toMatchObject({ id: spaceId, instructor_id: 'owner-1' });
    }
  });

  it('course_members.role=admin 同样算课程管理员', async () => {
    await expect(ensureSpaceAccess('space-b', teacher('course-admin'))).resolves.toMatchObject({ id: 'space-b' });
  });

  it('课程创建者不查成员、不查分组，course_members 里没有他那一行也一样', async () => {
    await expect(ensureSpaceAccess('space-b', teacher('owner-1'))).resolves.toMatchObject({ id: 'space-b' });
    await expect(ensureSpaceAccess('space-2b', teacher('owner-2'))).resolves.toMatchObject({ id: 'space-2b', instructor_id: 'owner-2' });
    expect(memberReads()).toEqual([]);
  });

  it('平台管理员照常放行，不查成员', async () => {
    await expect(ensureSpaceAccess('space-b', { id: 'platform-admin', role: 'admin' })).resolves.toMatchObject({ id: 'space-b' });
    expect(memberReads()).toEqual([]);
  });

  it('学生：本组能进，别组 403', async () => {
    await expect(ensureSpaceAccess('space-a', student('student-a'))).resolves.toMatchObject({ id: 'space-a' });
    await expect(ensureSpaceAccess('space-b', student('student-a'))).rejects.toMatchObject(ANOTHER_GROUP);
  });

  it('不在课里的人，教师账号也一样：共享空间和小组空间都是「不是成员」', async () => {
    await expect(ensureSpaceAccess('space-shared', teacher('outsider'))).rejects.toMatchObject(NOT_MEMBER);
    await expect(ensureSpaceAccess('space-b', teacher('outsider'))).rejects.toMatchObject(NOT_MEMBER);
  });

  it('课程管理员按课算：在一门课是管理员，不等于在另一门课也能跨组', async () => {
    await expect(ensureSpaceAccess('space-b', teacher('co-teacher'))).resolves.toMatchObject({ id: 'space-b' });
    await expect(ensureSpaceAccess('space-2b', teacher('co-teacher'))).rejects.toMatchObject(ANOTHER_GROUP);
  });
});

describe('成员缓存：只缓存肯定答案，按课程 + 用户分键，30 秒', () => {
  it('同一人 30 秒内再进，不再查 course_members / group_members', async () => {
    await ensureSpaceAccess('space-a', student('student-a'));
    expect(memberReads()).toEqual(['course_members', 'group_members']);

    await ensureSpaceAccess('space-a', student('student-a'));
    expect(memberReads()).toEqual(['course_members', 'group_members']);
  });

  it('缓存里已知是课程管理员：连 group_members 都不查', async () => {
    await ensureSpaceAccess('space-a', teacher('co-teacher'));
    h.reads.length = 0;

    await ensureSpaceAccess('space-b', teacher('co-teacher'));
    expect(memberReads()).toEqual([]);
  });

  it('否定答案不缓存：刚入课、刚进组的人立刻能进', async () => {
    await expect(ensureSpaceAccess('space-shared', student('newcomer'))).rejects.toMatchObject(NOT_MEMBER);
    h.db.course_members.push({ course_id: 'course-1', user_id: 'newcomer', role: 'student' });
    await expect(ensureSpaceAccess('space-shared', student('newcomer'))).resolves.toMatchObject({ id: 'space-shared' });

    await expect(ensureSpaceAccess('space-b', student('newcomer'))).rejects.toMatchObject(ANOTHER_GROUP);
    h.db.group_members.push({ group_id: 'group-b', user_id: 'newcomer' });
    await expect(ensureSpaceAccess('space-b', student('newcomer'))).resolves.toMatchObject({ id: 'space-b' });
  });

  it('撤销课程管理员后清缓存（PATCH …/role 会清）：立刻按组隔离', async () => {
    await expect(ensureSpaceAccess('space-b', teacher('co-teacher'))).resolves.toMatchObject({ id: 'space-b' });
    h.db.course_members.find(m => m.course_id === 'course-1' && m.user_id === 'co-teacher')!.role = 'student';
    invalidateMembershipCache();

    await expect(ensureSpaceAccess('space-b', teacher('co-teacher'))).rejects.toMatchObject(ANOTHER_GROUP);
  });

  it('没清缓存时课内身份最多沿用 30 秒，过期后重新查', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await expect(ensureSpaceAccess('space-b', teacher('co-teacher'))).resolves.toMatchObject({ id: 'space-b' });
    h.db.course_members.find(m => m.course_id === 'course-1' && m.user_id === 'co-teacher')!.role = 'student';

    vi.advanceTimersByTime(29_000);
    await expect(ensureSpaceAccess('space-b', teacher('co-teacher'))).resolves.toMatchObject({ id: 'space-b' });

    vi.advanceTimersByTime(1_001);
    await expect(ensureSpaceAccess('space-b', teacher('co-teacher'))).rejects.toMatchObject(ANOTHER_GROUP);
  });

  it('查成员失败报 503，不当成「不是成员」', async () => {
    h.failing.add('course_members');
    await expect(ensureSpaceAccess('space-shared', student('student-a'))).rejects.toMatchObject({ statusCode: 503 });
  });

  it('isCourseMember：任何课内身份都算成员', async () => {
    await expect(isCourseMember('course-1', 'teacher-joined')).resolves.toBe(true);
    await expect(isCourseMember('course-1', 'teacher-invited')).resolves.toBe(true);
    await expect(isCourseMember('course-1', 'co-teacher')).resolves.toBe(true);
    await expect(isCourseMember('course-1', 'nobody')).resolves.toBe(false);
  });
});

/**
 * 进了空间之后，「改删别人的内容、看教师才看的数据」也要按课内身份判断。
 * ensureSpaceAccess 判定时已经知道调用者是谁，把课内身份一并带回来，
 * 调用方就不用再查一次库，也不会退回去看 req.user.role。
 */
describe('ensureSpaceAccess / ensureNoteAccess 带回课内身份', () => {
  it.each([
    ['owner-1', 'teacher', 'owner'],
    ['platform-admin', 'admin', 'owner'],
    ['co-teacher', 'teacher', 'manager'],
    ['course-admin', 'teacher', 'manager'],
    ['teacher-joined', 'teacher', 'member'],
    ['teacher-invited', 'teacher', 'member'],
    ['student-a', 'student', 'member'],
  ] as const)('%s（平台身份 %s）→ %s', async (id, role, standing) => {
    await expect(ensureSpaceAccess('space-shared', { id, role })).resolves.toMatchObject({ standing });
  });

  it('课内身份按课算：在 course-1 是管理员，在 course-2 只是成员', async () => {
    h.db.spaces.push({ id: 'space-2-shared', course_id: 'course-2', group_id: null });
    await expect(ensureSpaceAccess('space-shared', teacher('co-teacher'))).resolves.toMatchObject({ standing: 'manager' });
    await expect(ensureSpaceAccess('space-2-shared', teacher('co-teacher'))).resolves.toMatchObject({ standing: 'member' });
  });

  it('带回课内身份不多查一次库', async () => {
    await ensureSpaceAccess('space-a', teacher('teacher-joined'));
    expect(memberReads()).toEqual(['course_members', 'group_members']);
  });

  it('ensureNoteAccess 带回笔记所在课程和课内身份', async () => {
    await expect(ensureNoteAccess('note-b', teacher('co-teacher'))).resolves.toMatchObject({
      id: 'note-b', space_id: 'space-b', course_id: 'course-1', author_id: 'student-b', standing: 'manager',
    });
    // 进不了的空间照旧 403，拿不到任何东西
    await expect(ensureNoteAccess('note-b', teacher('teacher-joined'))).rejects.toMatchObject(ANOTHER_GROUP);
  });

  it('isCourseStaff：只有创建者（含平台管理员）和课程管理员算', () => {
    expect(isCourseStaff('owner')).toBe(true);
    expect(isCourseStaff('manager')).toBe(true);
    expect(isCourseStaff('member')).toBe(false);
    expect(isCourseStaff('none')).toBe(false);
    expect(isCourseStaff(undefined)).toBe(false);
  });

  it('ensureSpaceStaff：进得了空间还不够，得是这门课的教职', async () => {
    const STAFF_ONLY = { statusCode: 403, message: 'Only the course instructor can perform this action' };
    await expect(ensureSpaceStaff('space-shared', teacher('teacher-joined'))).rejects.toMatchObject(STAFF_ONLY);
    await expect(ensureSpaceStaff('space-shared', teacher('teacher-invited'))).rejects.toMatchObject(STAFF_ONLY);
    await expect(ensureSpaceStaff('space-shared', student('student-a'))).rejects.toMatchObject(STAFF_ONLY);
    await expect(ensureSpaceStaff('space-b', teacher('co-teacher'))).resolves.toMatchObject({ standing: 'manager' });
    await expect(ensureSpaceStaff('space-b', teacher('owner-1'))).resolves.toMatchObject({ standing: 'owner' });
    // 别组空间先被 ensureSpaceAccess 拦下，报的是分组隔离
    await expect(ensureSpaceStaff('space-b', teacher('teacher-joined'))).rejects.toMatchObject(ANOTHER_GROUP);
  });
});

describe('getCourseStanding / ensureCourseMember', () => {
  it.each([
    ['owner-1', 'teacher', 'owner'],
    ['owner-2', 'teacher', 'owner'], // 早期建的课，course_members 里没有他
    ['platform-admin', 'admin', 'owner'],
    ['co-teacher', 'teacher', 'manager'],
    ['teacher-joined', 'teacher', 'member'],
    ['teacher-invited', 'teacher', 'member'],
    ['student-a', 'student', 'member'],
    ['outsider', 'teacher', 'none'],
  ] as const)('%s（平台身份 %s）→ %s', async (id, role, standing) => {
    const courseId = id === 'owner-2' ? 'course-2' : 'course-1';
    await expect(getCourseStanding(courseId, { id, role })).resolves.toBe(standing);
  });

  it('成员身份走 30 秒缓存：和 ensureSpaceAccess 共用，第二次不再查 course_members', async () => {
    await ensureSpaceAccess('space-shared', teacher('teacher-joined'));
    h.reads.length = 0;
    await expect(getCourseStanding('course-1', teacher('teacher-joined'))).resolves.toBe('member');
    expect(memberReads()).toEqual([]);
  });

  it('查成员失败报 503；创建者用不上那次查询，不受连累', async () => {
    h.failing.add('course_members');
    await expect(getCourseStanding('course-1', student('student-a'))).rejects.toMatchObject({ statusCode: 503 });
    await expect(getCourseStanding('course-1', teacher('owner-1'))).resolves.toBe('owner');
  });

  it('ensureCourseMember 返回课内身份，不在课里 403', async () => {
    await expect(ensureCourseMember('course-1', teacher('co-teacher'))).resolves.toBe('manager');
    await expect(ensureCourseMember('course-1', teacher('teacher-joined'))).resolves.toBe('member');
    await expect(ensureCourseMember('course-1', { id: 'platform-admin', role: 'admin' })).resolves.toBe('owner');
    await expect(ensureCourseMember('course-1', teacher('outsider'))).rejects.toMatchObject(NOT_MEMBER);
  });
});

/**
 * 按组 id 寻址的东西（任务板、观点图谱、本组讨论速览）和绑组空间同一个口径：
 * 本组成员和课程教职。原先任务板只查课程成员，组 A 的学生换个 id 就读写组 B 的任务。
 */
describe('ensureGroupAccess：组里的东西只给本组成员和课程教职', () => {
  const NOT_IN_GROUP = { statusCode: 403, message: 'Not a member of this group' };

  it('本组成员能进，带回组和课内身份', async () => {
    await expect(ensureGroupAccess('group-a', student('student-a'))).resolves.toEqual({
      id: 'group-a', course_id: 'course-1', name: '第一组', created_at: '2026-09-01T00:00:00Z', standing: 'member',
    });
    // 凭学生验证码入课的教师账号在组里，按组员算
    await expect(ensureGroupAccess('group-a', teacher('teacher-joined'))).resolves.toMatchObject({ standing: 'member' });
  });

  it('同课的别组成员进不来，平台身份是教师也一样', async () => {
    await expect(ensureGroupAccess('group-b', student('student-a'))).rejects.toMatchObject(NOT_IN_GROUP);
    await expect(ensureGroupAccess('group-b', teacher('teacher-joined'))).rejects.toMatchObject(NOT_IN_GROUP);
    await expect(ensureGroupAccess('group-a', teacher('teacher-invited'))).rejects.toMatchObject(NOT_IN_GROUP);
    await expect(ensureGroupAccess('group-b', student('student-forged'))).rejects.toMatchObject(NOT_IN_GROUP);
  });

  it.each([
    ['owner-1', 'teacher', 'owner'],
    ['co-teacher', 'teacher', 'manager'],
    ['platform-admin', 'admin', 'owner'],
  ] as const)('课程教职跨组：%s → %s', async (id, role, standing) => {
    await expect(ensureGroupAccess('group-b', { id, role })).resolves.toMatchObject({ id: 'group-b', standing });
  });

  it('组员行还在、人已被移出课程：不算数', async () => {
    await expect(ensureGroupAccess('group-a', student('student-removed'))).rejects.toMatchObject(NOT_MEMBER);
  });

  it('课程管理员按课算：在另一门课只是成员，进不了那门课的组', async () => {
    await expect(ensureGroupAccess('group-2b', teacher('co-teacher'))).rejects.toMatchObject(NOT_IN_GROUP);
  });

  it('组不存在 404', async () => {
    await expect(ensureGroupAccess('group-missing', teacher('owner-1'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('查组员失败：成员报 503，不当成「不在组里」；教职用不上那次查询，不受连累', async () => {
    h.failing.add('group_members');
    await expect(ensureGroupAccess('group-a', student('student-a'))).rejects.toMatchObject({ statusCode: 503 });
    await expect(ensureGroupAccess('group-b', teacher('co-teacher'))).resolves.toMatchObject({ standing: 'manager' });
  });
});

describe('成员行单独不算数：学生账号带着管理员行，也只是普通成员', () => {
  it('进不了别组的空间，共享空间里课内身份是 member', async () => {
    await expect(ensureSpaceAccess('space-b', student('student-forged'))).rejects.toMatchObject(ANOTHER_GROUP);
    await expect(ensureSpaceAccess('space-shared', student('student-forged'))).resolves.toMatchObject({ standing: 'member' });
  });

  it('getCourseStanding / ensureSpaceStaff 同样不认', async () => {
    await expect(getCourseStanding('course-1', student('student-forged'))).resolves.toBe('member');
    await expect(ensureSpaceStaff('space-shared', student('student-forged'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('缓存里那一行是管理员，学生账号也照查分组', async () => {
    await ensureSpaceAccess('space-shared', student('student-forged'));
    h.reads.length = 0;
    await expect(ensureSpaceAccess('space-b', student('student-forged'))).rejects.toMatchObject(ANOTHER_GROUP);
    expect(memberReads()).toEqual(['group_members']);
  });
});

/**
 * 个人助手的课程列表（/personal-agent/configs）按 listCourseStandings 给每门课标教师模式，
 * /personal-agent/stream 的门按 ensureCourseInstructor 判：两边各查各的库，口径必须一样，
 * 不然前端标着能用、第一句话就 403。
 */
describe('listCourseStandings 和逐课判定同一口径', () => {
  const admin = { id: 'platform-admin', role: 'admin' as const };
  const people = [
    teacher('owner-1'), teacher('owner-2'), teacher('co-teacher'), teacher('course-admin'), teacher('teacher-joined'),
    teacher('teacher-invited'), student('student-a'), student('student-forged'), teacher('outsider'),
  ];

  it('逐门和 getCourseStanding 一样，只列所在的课', async () => {
    expect(Object.fromEntries(await listCourseStandings(teacher('co-teacher')))).toEqual({ 'course-1': 'manager', 'course-2': 'member' });
    expect(Object.fromEntries(await listCourseStandings(teacher('owner-2')))).toEqual({ 'course-2': 'owner' });
    expect(Object.fromEntries(await listCourseStandings(student('student-forged')))).toEqual({ 'course-1': 'member' });

    for (const user of people) {
      const oneByOne: Record<string, CourseStanding> = {};
      for (const courseId of ['course-1', 'course-2']) {
        const standing = await getCourseStanding(courseId, user);
        if (standing !== 'none') oneByOne[courseId] = standing;
      }
      expect(Object.fromEntries(await listCourseStandings(user)), user.id).toEqual(oneByOne);
    }
  });

  it('isCourseStaff(getCourseStanding) 为真的，正好是 ensureCourseInstructor 放行的', async () => {
    const verdicts: boolean[] = [];
    for (const user of [...people, admin]) {
      for (const courseId of ['course-1', 'course-2']) {
        const staff = isCourseStaff(await getCourseStanding(courseId, user));
        const passed = await ensureCourseInstructor(courseId, user as AuthUser).then(() => true, () => false);
        expect(passed, `${user.id} @ ${courseId}`).toBe(staff);
        verdicts.push(passed);
      }
    }
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it('平台管理员所在的课按创建者对待，不在的课不列', async () => {
    h.db.course_members.push({ course_id: 'course-2', user_id: 'platform-admin', role: 'student' });
    expect(Object.fromEntries(await listCourseStandings(admin))).toEqual({ 'course-2': 'owner' });
  });

  it.each(['course_members', 'courses'])('查 %s 出错报 503，不拿半份结果当全部', async (table) => {
    h.failing.add(table);
    await expect(listCourseStandings(teacher('co-teacher'))).rejects.toMatchObject({ statusCode: 503 });
  });
});
