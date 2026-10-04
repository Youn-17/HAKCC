import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canCreateCourseSpace, ideaGraphGroup, isCourseStaff, taskBoardGroup } from './courseStanding';

const GROUPS = [
  { id: 'group-a', memberIds: ['student-a', 'teacher-joined'] },
  { id: 'group-b', memberIds: ['student-b'] },
];

describe('isCourseStaff：课内身份以后端为准', () => {
  it('拿到课内身份就只看它，不看平台身份', () => {
    expect(isCourseStaff('owner', 'teacher')).toBe(true);
    expect(isCourseStaff('manager', 'teacher')).toBe(true);
    // 凭学生验证码入课、或受邀还没设为管理员的教师账号
    expect(isCourseStaff('member', 'teacher')).toBe(false);
    expect(isCourseStaff('member', 'student')).toBe(false);
  });

  it('还没拿到（请求在路上、旧版后端不带）按平台身份，和原来一样', () => {
    expect(isCourseStaff(null, 'teacher')).toBe(true);
    expect(isCourseStaff(undefined, 'admin')).toBe(true);
    expect(isCourseStaff(null, 'student')).toBe(false);
  });
});

describe('canCreateCourseSpace：建空间只认创建者（和平台管理员）', () => {
  it('课程管理员也不行，和后端 POST /courses/:id/spaces 一致', () => {
    expect(canCreateCourseSpace('owner', 'teacher')).toBe(true);
    expect(canCreateCourseSpace('owner', 'admin')).toBe(true);
    expect(canCreateCourseSpace('manager', 'teacher')).toBe(false);
    expect(canCreateCourseSpace('member', 'teacher')).toBe(false);
  });

  it('拿不到课内身份时按平台身份', () => {
    expect(canCreateCourseSpace(null, 'teacher')).toBe(true);
    expect(canCreateCourseSpace(undefined, 'admin')).toBe(true);
    expect(canCreateCourseSpace(null, 'student')).toBe(false);
  });
});

describe('观点图谱打开哪个组', () => {
  it('在组里就是自己的组，教职也一样', () => {
    expect(ideaGraphGroup(GROUPS, 'student-b', false)?.id).toBe('group-b');
    expect(ideaGraphGroup(GROUPS, 'teacher-joined', false)?.id).toBe('group-a');
  });

  it('课程教职不在组里：先看第一个组', () => {
    expect(ideaGraphGroup(GROUPS, 'owner-1', true)?.id).toBe('group-a');
  });

  it('普通成员没分组：不回落到别的组（那是一个 403）', () => {
    expect(ideaGraphGroup(GROUPS, 'teacher-invited', false)).toBeUndefined();
  });
});

describe('任务板看哪个组', () => {
  it('普通成员只有自己的组，选了别的组也不算', () => {
    expect(taskBoardGroup(GROUPS, 'teacher-joined', false, 'group-b')?.id).toBe('group-a');
    expect(taskBoardGroup(GROUPS, 'teacher-invited', false, 'group-a')).toBeUndefined();
  });

  it('课程教职：选了哪个看哪个，没选先看自己的组，再退到第一个组', () => {
    expect(taskBoardGroup(GROUPS, 'owner-1', true, 'group-b')?.id).toBe('group-b');
    expect(taskBoardGroup(GROUPS, 'owner-1', true, null)?.id).toBe('group-a');
    expect(taskBoardGroup(GROUPS, 'student-b', true, null)?.id).toBe('group-b');
    expect(taskBoardGroup(GROUPS, 'owner-1', true, 'group-gone')?.id).toBe('group-a');
    expect(taskBoardGroup([], 'owner-1', true, null)).toBeUndefined();
  });
});

describe('工作区不再按平台身份给教职才有的操作', () => {
  const workspace = readFileSync(resolve(__dirname, 'Workspace.tsx'), 'utf-8');
  const propsOf = (tag: string) => {
    const start = workspace.indexOf(`<${tag}`);
    return workspace.slice(start, workspace.indexOf('/>', start));
  };

  it('改删笔记的三处判断', () => {
    const checks = workspace.split('\n').filter(line => line.includes('authorId === user?.id'));
    expect(checks.length).toBeGreaterThanOrEqual(3);
    for (const line of checks) {
      expect(line).not.toContain('userRole');
      expect(line).toContain('viewerIsStaff');
    }
  });

  it('文档阅读页、观点图谱、小组管理拿的都是课内身份', () => {
    expect(propsOf('FileViewerPage')).toContain('isStaff={viewerIsStaff}');
    expect(propsOf('FileViewerPage')).toContain('canEdit={canEditNote(viewingFile)}');
    expect(propsOf('GroupIdeaGraph')).toContain('isTeacher={viewerIsStaff}');
    expect(propsOf('GroupManagementModal')).toContain('isStaff={viewerIsStaff}');
    expect(propsOf('GroupManagementModal')).not.toContain('userRole');
  });

  it('小组管理弹窗里没有平台身份判断', () => {
    const modal = readFileSync(resolve(__dirname, 'GroupManagementModal.tsx'), 'utf-8');
    expect(modal).not.toMatch(/userRole/);
  });

  it('侧栏、支架管理、成员管理、AI 研究助手、探究面板、视图面板拿的也是课内身份', () => {
    for (const tag of ['Sidebar', 'ScaffoldModal', 'MemberManagementModal', 'AISidePanel', 'InquiryPanel', 'ViewPanel']) {
      expect(propsOf(tag), tag).toContain('isStaff={viewerIsStaff}');
      expect(propsOf(tag), tag).not.toContain('userRole');
    }
    // 编辑器只有「打开即记已读」一处用到身份；手机端不传 isStaff，按平台身份
    expect(propsOf('NoteEditorModal')).toContain('isStaff={viewerIsStaff}');
  });

  it('这几个组件里没有平台身份判断', () => {
    for (const file of ['Sidebar.tsx', 'ScaffoldModal.tsx', 'MemberManagementModal.tsx', 'AISidePanel.tsx', 'InquiryPanel.tsx', 'ViewPanel.tsx']) {
      const src = readFileSync(resolve(__dirname, file), 'utf-8');
      expect(src, file).not.toMatch(/userRole/);
    }
  });

  it('工作区里只剩交给子组件的 userRole，自己不再按平台身份判断', () => {
    expect(workspace).not.toMatch(/userRole === '(teacher|admin|student)'/);
  });
});
