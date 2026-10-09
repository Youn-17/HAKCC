import { describe, expect, it } from 'vitest';
import {
  ballBounds,
  DEFAULT_BALL_RATIO,
  pickCourse,
  inboxWaiting,
  isHelpStaff,
  isSmallBall,
  quickQuestions,
  ratioFromTop,
  readBallRatio,
  readGrounding,
  routeInfo,
  shouldShowHelp,
  topFromRatio,
  unseenTeacherReplies,
} from './helpWidgetModel';

describe('挂在哪些页面', () => {
  it('从地址认出课程和页面', () => {
    expect(routeInfo('/workspace/c-1')).toEqual({ courseId: 'c-1', surface: 'canvas' });
    expect(routeInfo('/workspace/c-1/note/n-9')).toEqual({ courseId: 'c-1', surface: 'note-editor' });
    expect(routeInfo('/workspace/c-1/turing-test/a-1')).toEqual({ courseId: 'c-1', surface: 'turing-test' });
    expect(routeInfo('/dashboard')).toEqual({ courseId: null, surface: 'dashboard' });
  });

  it('只给学生，而且只在登录后的页面', () => {
    expect(shouldShowHelp('student', '/dashboard')).toBe(true);
    expect(shouldShowHelp('student', '/workspace/c-1/note/n-1')).toBe(true);
    // 图灵测试是匿名群聊实验，不放一个能问「谁是 AI」的助手
    expect(shouldShowHelp('student', '/workspace/c-1/turing-test')).toBe(false);
    expect(shouldShowHelp('student', '/workspace/c-1/turing-test/act-1')).toBe(false);
    // 2026-10-05 起教师、管理员也有：看学生的求助，自己也能问
    expect(shouldShowHelp('teacher', '/workspace/c-1')).toBe(true);
    expect(shouldShowHelp('admin', '/dashboard')).toBe(true);
    // 主持图灵测试的老师不是被试
    expect(shouldShowHelp('teacher', '/workspace/c-1/turing-test')).toBe(true);
    expect(shouldShowHelp('teacher', '/')).toBe(false);
    expect(shouldShowHelp(undefined, '/dashboard')).toBe(false);
    expect(shouldShowHelp('student', '/')).toBe(false);
    expect(shouldShowHelp('student', '/login')).toBe(false);
  });
});

describe('球的位置', () => {
  it('手机上底部让得更多：标签栏和新建笔记的按钮都在那里', () => {
    const desktop = ballBounds(900, 110, false);
    const phone = ballBounds(812, 110, true);
    expect(desktop.max).toBeGreaterThan(desktop.min);
    expect(812 - (phone.max + 110)).toBeGreaterThan(900 - (desktop.max + 110));
    // 手机上球的下沿离屏幕底边超过新建按钮的上沿（约 153px）
    expect(812 - (phone.max + 110 - 24)).toBeGreaterThan(153);
  });

  it('按比例存，换了窗口高度还在相对原来的位置', () => {
    const small = ballBounds(700, 110, false);
    const big = ballBounds(1200, 110, false);
    const ratio = ratioFromTop(topFromRatio(0.5, small), small);
    expect(ratio).toBeCloseTo(0.5, 2);
    expect(topFromRatio(ratio, big)).toBe(Math.round(big.min + 0.5 * (big.max - big.min)));
  });

  it('超出范围的都夹回去', () => {
    const b = ballBounds(900, 110, false);
    expect(topFromRatio(3, b)).toBe(b.max);
    expect(topFromRatio(-1, b)).toBe(b.min);
    expect(ratioFromTop(-500, b)).toBe(0);
  });

  it('窗口矮到放不下时不出负数范围', () => {
    const b = ballBounds(150, 110, true);
    expect(b.max).toBe(b.min);
    expect(ratioFromTop(b.min, b)).toBe(1);
  });

  it('读不到存储（这里连 window 都没有）就用默认位置', () => {
    expect(readBallRatio()).toBe(DEFAULT_BALL_RATIO);
  });
});

describe('问哪门课', () => {
  it('优先最近进过、而且还在列表里的那门', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(pickCourse(list, 'b')).toBe('b');
    expect(pickCourse(list, 'gone')).toBe('a');
    expect(pickCourse(list, null)).toBe('a');
    expect(pickCourse([], 'b')).toBeNull();
  });
});

describe('老师的新回复', () => {
  const now = Date.parse('2026-09-29T08:00:00Z');
  const q = (at: string | null) => ({ teacherAnswer: at ? '回复' : null, teacherAnsweredAt: at });

  it('只数上次打开以后的', () => {
    const items = [q('2026-09-29T07:00:00Z'), q('2026-09-28T07:00:00Z'), q(null)];
    expect(unseenTeacherReplies(items, '2026-09-28T12:00:00Z', now)).toBe(1);
  });

  it('没有打开记录时只算最近一周', () => {
    expect(unseenTeacherReplies([q('2026-09-01T00:00:00Z'), q('2026-09-28T00:00:00Z')], null, now)).toBe(1);
  });
});

describe('回答依据', () => {
  it('读服务端写进处境的依据', () => {
    expect(readGrounding({ grounding: { manual: [{ num: '04', title: '写一条笔记' }], teacherAnswers: 1, covered: true } }))
      .toEqual({ manual: [{ num: '04', title: '写一条笔记' }], teacherAnswers: 1, covered: true });
  });

  it('旧记录没有、或者形状不对，都不会让界面出错', () => {
    expect(readGrounding({})).toBeNull();
    expect(readGrounding(null)).toBeNull();
    expect(readGrounding({ grounding: 'x' })).toBeNull();
    expect(readGrounding({ grounding: { manual: [null, { num: '<b>' }, { num: '15', title: 3 }], covered: 'yes' } }))
      .toEqual({ manual: [{ num: '15', title: '3' }], teacherAnswers: 0, covered: null });
  });
});

describe('常见问题', () => {
  it('按页面给，手机上少给一条', () => {
    expect(quickQuestions('note-editor', 'zh', false)).toContain('写完的笔记怎么保存？');
    expect(quickQuestions('document', 'zh', false)).toContain('怎么给文档加批注？');
    expect(quickQuestions('dashboard', 'en', false)[0]).toBe('How do I join a new course?');
    expect(quickQuestions('canvas', 'zh', true)).toHaveLength(3);
    expect(quickQuestions('mobile-notes', 'zh', true)).toContain('手机上能用吗？');
  });
});

describe('教师、管理员', () => {
  it('哪些账号算教职', () => {
    expect(isHelpStaff('teacher')).toBe(true);
    expect(isHelpStaff('admin')).toBe(true);
    expect(isHelpStaff('student')).toBe(false);
    expect(isHelpStaff(null)).toBe(false);
  });

  it('球上的数：学生求助加上教师转来的；没数据是 0', () => {
    expect(inboxWaiting({ student: 3, teacher: 2 })).toBe(5);
    expect(inboxWaiting({ student: 1, teacher: 0 })).toBe(1);
    expect(inboxWaiting(null)).toBe(0);
  });

  it('教师的常见问题按教师端给：首页问设置，课程里问分组、支架', () => {
    expect(quickQuestions('dashboard', 'zh', false, 'teacher')).toContain('怎么导出研究数据？');
    expect(quickQuestions('canvas', 'zh', false, 'teacher')).toContain('怎么给学生分组？');
    expect(quickQuestions('canvas', 'zh', true, 'teacher')).toHaveLength(3);
    expect(quickQuestions('dashboard', 'zh', false, 'teacher')).not.toContain('怎么加入一门新课？');
  });
});

describe('isSmallBall', () => {
  it('知识空间里用鼠标时是小号；首页、手指点的设备、窄屏照旧（2026-10-09）', () => {
    expect(isSmallBall('canvas', false, false)).toBe(true);
    expect(isSmallBall('note-editor', false, false)).toBe(true);
    expect(isSmallBall('document', false, false)).toBe(true);
    expect(isSmallBall('discussion-room', false, false)).toBe(true);
    expect(isSmallBall('dashboard', false, false)).toBe(false);
    expect(isSmallBall('canvas', true, false)).toBe(false);
    expect(isSmallBall('canvas', false, true)).toBe(false);
  });
});
