/**
 * 教师端几张截图用到的演示数据：概览、教学日志、AI 设置与触发设置、学生求助。
 */
import * as W from './world.mjs';
import { state } from './mockApi.mjs';

const at = (date, hm) => `${date}T${hm}:00+08:00`;

export function handleTeacher(on) {
  const summary = () => ({
    id: W.COURSE_ID, title: W.COURSE.title, instructorId: W.TEACHER_ID, instructorName: '刘老师', coverImage: null, tags: W.COURSE.tags,
    verificationCode: 'K7Q2', createdAt: W.COURSE.created_at, studentCount: 32, noteCount: 86, lastActivityAt: W.ago(0, 1),
    hasAi: true, hasUnreadFeedback: false, unreadFeedbackCount: 0,
  });
  on('GET', /^\/dashboard\/teacher-overview$/, () => ({
    overview: { generatedAt: W.NOW.toISOString(), totals: { totalCourses: 1, totalStudents: 32, totalNotes: 86, aiEnabledCourses: 1, pendingFeedbackCount: 2 }, courses: [summary()] },
  }));
  on('GET', /^\/sessions\/pending$/, () => ({ sessions: [] }));
  on('GET', /^\/courses\/[^/]+\/sessions$/, () => {
    const mk = (n, date, status, metrics, extra = {}) => ({
      id: `ses-${n}`, courseId: W.COURSE_ID, sessionNo: n, weekNo: n, plannedDate: date, plannedStart: '10:00', plannedMinutes: 90,
      plannedAt: at(date, '10:00'), status, actualDate: status === 'held' ? date : null, actualStart: status === 'held' ? '10:00' : null,
      actualMinutes: status === 'held' ? 90 : null, movedToDate: null, movedToStart: null, cancelReason: null, note: null,
      confirmedAt: status === 'held' ? at(date, '11:40') : null, metrics, aiSummary: null, aiSummaryAt: null, aiSummaryEdited: false, courseTitle: W.COURSE.title, ...extra,
    });
    const sessions = [
      mk(1, '2026-09-07', 'held', { participants: 29, notes: 12, build_ons: 5, ai_feedbacks: 4 }),
      mk(2, '2026-09-14', 'held', { participants: 31, notes: 18, build_ons: 11, ai_feedbacks: 9 }, {
        aiSummary: '这次课 31 人参与，新增 18 条笔记、11 次 Build-on。讨论从「AI 会不会让人变懒」开始，第二个小时出现了第一批质疑类笔记，集中在「用得好反而要多想」。AI 反馈 9 条，其中「缺证据」6 条。',
        aiSummaryAt: at('2026-09-14', '12:10'),
      }),
      mk(3, '2026-09-21', 'held', { participants: 30, notes: 21, build_ons: 16, ai_feedbacks: 7 }, {
        aiSummary: '这次课 30 人参与，新增 21 条笔记、16 次 Build-on。「AI 算不算理解」一线出现了本学期第一条综合升华。课后要跟进：第 2 组有两条提问两天内没有人回应。',
        aiSummaryAt: at('2026-09-21', '12:05'), aiSummaryEdited: true,
      }),
      mk(4, '2026-09-28', 'planned', {}),
      mk(5, '2026-10-05', 'rescheduled', {}, { movedToDate: '2026-10-09', movedToStart: '14:00', note: '国庆调课' }),
      mk(6, '2026-10-12', 'planned', {}),
    ];
    return {
      sessions,
      summary: { total: 16, held: 3, cancelled: 0, rescheduled: 1, pending: 1 },
      config: { courseType: 'elective', creditHours: 2, totalWeeks: 16, startDate: '2026-09-07', timezone: 'Asia/Shanghai', schedule: [] },
    };
  });
  on('GET', /^\/courses\/[^/]+\/trigger-settings$/, () => ({
    settings: {
      enabled_triggers: ['no_reasoning', 'no_evidence', 'promising_seed', 'unclear'], cooldown_seconds: 120, auto_feedback_enabled: true,
      custom_context: '本课程讨论生成式 AI 对学习的影响。反馈请用中文，每次只提一个问题。', sensitivity: 'balanced', response_language: 'auto',
      response_style: 'socratic', ai_persona: '', max_feedback_length: 300, experiment_mode: false,
    },
  }));
  on('GET', /^\/ai\/model-catalog$/, () => ({
    dmx: { text: [], vision: [], image: [], defaults: [] },
    native: { deepseek: [{ id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', fast: true }, { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }] },
    tiers: { fast: ['deepseek-flash'], chat: ['deepseek-flash', 'deepseek-v4-pro'] },
  }));
  const helpQuestions = () => {
    const q = (id, who, question, status, ai, extra = {}) => ({
      id, courseId: W.COURSE_ID, spaceId: W.SPACE_ID, userId: `u-${id}`, userName: who, question, aiAnswer: ai, aiProvider: 'deepseek', aiModel: 'deepseek-flash',
      aiResolved: status === 'resolved' ? true : null, escalatedAt: status === 'escalated' ? W.ago(0, 3) : null, escalationNote: extra.note ?? null,
      teacherAnswer: null, teacherAnsweredAt: null, status, attachments: [], createdAt: extra.createdAt ?? W.ago(0, 4), updatedAt: W.ago(0, 3),
      context: { page: `/workspace/${W.COURSE_ID}`, panel: 'idea-graph', viewport: '1440×900', appVersion: 'v1.33', model: 'deepseek-flash' },
    });
    const questions = [
      q('q1', '周子涵', '观点图谱一直显示「还没有分组」，可我已经在第 2 组里了', 'escalated', '观点图谱按小组计算。显示「还没有分组」通常是老师还没把你分进小组，请联系老师确认。', { note: '我在小组列表里能看到自己' }),
      q('q2', '孙佳怡', '观点图谱显示还没有分组，但是我有小组', 'escalated', '观点图谱按小组计算。请确认老师已经把你分进小组。', { createdAt: W.ago(0, 6) }),
      q('q3', '吴浩然', '怎么把 AI 的回答放进笔记？', 'resolved', '在 AI 回复下面点「添加到 Note」，选一条支架说明你怎么用它，就会带着「AI 来源」标记插进笔记。', { createdAt: W.ago(1, 2) }),
    ];
    return questions;
  };
  on('GET', /^\/support\/questions$/, () => {
    const questions = helpQuestions();
    return { questions: questions.filter(x => x.status === 'escalated'), counts: { total: 3, waiting: 2, answered: 0, solvedByAi: 1 } };
  });
  // 教师端的「使用帮助」小球（2026-10-05）：等回复的学生求助
  on('GET', /^\/support\/inbox$/, () => {
    state.answeredHelp ??= [];
    const student = helpQuestions()
      .filter(x => x.status === 'escalated' && !state.answeredHelp.includes(x.id))
      .map(x => ({ ...x, courseTitle: '人工智能与学习', askerRole: 'student' }));
    return { student, teacher: [], counts: { student: student.length, teacher: 0 } };
  });
  on('POST', /^\/support\/questions\/(?<id>[^/]+)\/answer$/, ({ params, body }) => {
    state.answeredHelp ??= [];
    state.answeredHelp.push(params.id);
    return { question: { id: params.id, status: 'teacher_answered', teacherAnswer: body.answer, teacherAnsweredAt: new Date().toISOString() } };
  });
  on('GET', /^\/dashboard\/courses\/[^/]+\/learner-profiles$/, () => ({ profiles: [] }));
  on('GET', /^\/dashboard\/courses\/[^/]+\/needs-attention$/, () => ({ items: [] }));
  on('GET', /^\/courses\/[^/]+\/stats$/, () => ({ studentCount: 32, spaceCount: 3, noteCount: 86 }));
  on('GET', /^\/courses\/[^/]+\/goals$/, () => ({ goals: [] }));
  on('GET', /^\/courses\/[^/]+\/materials$/, () => ({ materials: [] }));
  on('GET', /^\/courses\/[^/]+\/tasks$/, () => ({ tasks: [] }));
}
