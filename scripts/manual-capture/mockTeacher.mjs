/**
 * 教师端几张截图用到的演示数据：概览、教学日志、AI 设置与触发设置、学生求助。
 */
import fs from 'node:fs';
import * as W from './world.mjs';
import { state } from './mockApi.mjs';

const at = (date, hm) => `${date}T${hm}:00+08:00`;

export function handleTeacher(on) {
  const summary = () => ({
    id: W.COURSE_ID, title: W.COURSE.title, instructorId: W.TEACHER_ID, instructorName: '刘老师', coverImage: null, tags: W.COURSE.tags,
    verificationCode: 'K7Q2', createdAt: W.COURSE.created_at, studentCount: 32, noteCount: 86, lastActivityAt: W.ago(0, 1),
    hasAi: true, hasUnreadFeedback: false, unreadFeedbackCount: 0,
    // 刘老师是这门课的创建者：「我的课程」里显示「课程管理」（2026-10-06 起）
    viewerStanding: 'owner',
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

  // ── 讨论分析（知识空间顶栏「分析」，2026-10-09）：按演示笔记现算，口径照 api/src/services/spaceAnalytics.ts 简化 ──
  on('GET', /^\/spaces\/[^/]+\/analytics$/, () => ({ overview: analyticsOverview(), signature: 'demo', generatedAt: W.NOW.toISOString() }));
  on('GET', /^\/spaces\/[^/]+\/analytics\/students\/(?<uid>[^/]+)$/, ({ params }) => ({ student: analyticsStudent(params.uid) }));
  on('GET', /^\/spaces\/[^/]+\/analytics\/wordcloud$/, ({ query }) => {
    // 演示词云是服务器上用 Python（jieba + wordcloud）对这批演示笔记排好的，存在 analyticsDemoCloud.json
    if (!query.author_id) return DEMO_CLOUD;
    const mine = new Set(studentNotes().filter(n => n.author_id === query.author_id).map(n => n.id));
    const terms = DEMO_CLOUD.terms.filter(t => t.note_ids.some(id => mine.has(id)));
    const keep = new Set(terms.map(t => t.word));
    return { ...DEMO_CLOUD, terms, docs: mine.size, cloud: { ...DEMO_CLOUD.cloud, items: DEMO_CLOUD.cloud.items.filter(i => keep.has(i.word)) } };
  });
}

const DEMO_CLOUD = JSON.parse(fs.readFileSync(new URL('./analyticsDemoCloud.json', import.meta.url), 'utf8'));
const STUDENT_IDS = Object.keys(W.PEOPLE).filter(id => id !== W.TEACHER_ID);
const studentNotes = () => state.notes.filter(n => STUDENT_IDS.includes(n.author_id) && n.type !== 'view');
const buildOns = () => {
  const byId = new Map(state.notes.map(n => [n.id, n]));
  return state.relations
    .map(r => ({ ...r, from: byId.get(r.source_note_id)?.author_id, to: byId.get(r.target_note_id)?.author_id }))
    .filter(r => r.from && r.to);
};
const dayOf = iso => new Date(iso).toISOString().slice(0, 10);
const QUIET_MS = 7 * 86_400_000;

function analyticsOverview() {
  const notes = studentNotes();
  const rels = buildOns();
  const lastAt = new Map();
  for (const n of notes) if (!lastAt.has(n.author_id) || lastAt.get(n.author_id) < n.created_at) lastAt.set(n.author_id, n.created_at);
  for (const r of rels) if (!lastAt.has(r.from) || lastAt.get(r.from) < r.created_at) lastAt.set(r.from, r.created_at);
  const fbs = Object.values(state.feedbacks).flat();
  const participation = STUDENT_IDS.map(id => {
    const mine = notes.filter(n => n.author_id === id);
    const fb = fbs.filter(f => f.userId === id);
    return {
      userId: id, name: W.PEOPLE[id], avatar: null,
      notes: mine.length,
      buildOnsGiven: rels.filter(r => r.from === id && r.to !== id).length,
      buildOnsReceived: rels.filter(r => r.to === id && r.from !== id).length,
      chars: mine.reduce((sum, n) => sum + String(n.content ?? '').replace(/<[^>]+>/g, '').replace(/\s/g, '').length, 0),
      scaffolds: mine.reduce((sum, n) => sum + (String(n.content ?? '').match(/data-scaffold-id=/g) ?? []).length, 0),
      lastAt: lastAt.get(id) ?? null,
      quiet: !lastAt.has(id) || Date.parse(lastAt.get(id)) < W.NOW.getTime() - QUIET_MS,
      aiFeedback: { received: fb.length, adopted: fb.filter(f => ['accepted', 'inserted', 'followed_up'].includes(f.status)).length },
      aiUse: [6, 2, 4, 1, 0, 3, 0, 1][STUDENT_IDS.indexOf(id)] ?? 0,
    };
  }).sort((a, b) => (b.notes + b.buildOnsGiven) - (a.notes + a.buildOnsGiven));
  // 和服务端 timelineDays 一样：从最早一次发言到今天，至少一周
  const end = Date.parse(dayOf(W.NOW.toISOString()));
  const earliest = [...notes.map(n => n.created_at), ...rels.map(r => r.created_at)].sort()[0];
  const start = Math.min(earliest ? Date.parse(dayOf(earliest)) : end, end - 6 * 86_400_000);
  const days = [];
  for (let t = start; t <= end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const timeline = days.map(day => ({
    day,
    notes: notes.filter(n => dayOf(n.created_at) === day).length,
    buildOns: rels.filter(r => dayOf(r.created_at) === day).length,
    active: new Set([...notes.filter(n => dayOf(n.created_at) === day).map(n => n.author_id), ...rels.filter(r => dayOf(r.created_at) === day).map(r => r.from)]).size,
  }));
  const linkCount = new Map();
  for (const r of rels) if (r.from !== r.to) linkCount.set(`${r.from}→${r.to}`, (linkCount.get(`${r.from}→${r.to}`) ?? 0) + 1);
  const received = new Map();
  for (const r of rels) if (r.from !== r.to) received.set(r.target_note_id, (received.get(r.target_note_id) ?? 0) + 1);
  const unanswered = notes.filter(n => !received.get(n.id)).sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(n => ({ id: n.id, title: n.title, authorId: n.author_id, authorName: W.PEOPLE[n.author_id], createdAt: n.created_at }));
  const typeCount = new Map();
  for (const r of rels) typeCount.set(r.relation_type, (typeCount.get(r.relation_type) ?? 0) + 1);
  const scaffoldGroup = new Map(state.scaffolds.map(sc => [sc.id, sc.metadata?.l2_zh ?? sc.category]));
  const groupCount = new Map();
  for (const n of notes) for (const m of String(n.content ?? '').matchAll(/data-scaffold-id="([^"]+)"/g)) {
    const g = scaffoldGroup.get(m[1]) ?? '表达与改进观点';
    groupCount.set(g, (groupCount.get(g) ?? 0) + 1);
  }
  const count = map => [...map.entries()].map(([label, c]) => ({ label, count: c })).sort((a, b) => b.count - a.count);
  const adopted = fbs.filter(f => ['accepted', 'inserted', 'followed_up'].includes(f.status)).length;
  return {
    summary: {
      students: STUDENT_IDS.length,
      activeStudents: participation.filter(p => p.notes + p.buildOnsGiven > 0).length,
      quietStudents: participation.filter(p => p.quiet).length,
      notes: notes.length,
      teacherNotes: state.notes.filter(n => n.author_id === W.TEACHER_ID).length,
      riseAbove: notes.filter(n => n.type === 'riseabove').length,
      buildOns: rels.length,
      unanswered: unanswered.length,
      chars: participation.reduce((sum, p) => sum + p.chars, 0),
      feedback: { total: Math.max(fbs.length, 9), adopted: Math.max(adopted, 7), rejected: 2, ignored: 0, pending: 0 },
      aiUse: participation.reduce((sum, p) => sum + p.aiUse, 0),
      firstAt: notes.map(n => n.created_at).sort()[0] ?? null,
      lastAt: [...lastAt.values()].sort().at(-1) ?? null,
    },
    timeline,
    participation,
    network: {
      nodes: participation.map(p => ({ id: p.userId, name: p.name, notes: p.notes, buildOns: p.buildOnsGiven + p.buildOnsReceived })),
      links: [...linkCount.entries()].map(([key, c]) => { const [from, to] = key.split('→'); return { from, to, count: c }; }),
    },
    unanswered: unanswered.slice(0, 30),
    scaffoldGroups: groupCount.size ? count(groupCount) : [{ label: '表达与改进观点', count: 6 }, { label: '思考后询问 GAI', count: 3 }, { label: 'GAI 回答的判断与取舍', count: 2 }],
    relationTypes: count(typeCount),
  };
}

function analyticsStudent(uid) {
  const o = analyticsOverview();
  const p = o.participation.find(x => x.userId === uid) ?? o.participation[0];
  const notes = studentNotes().filter(n => n.author_id === p.userId);
  const rels = buildOns();
  const received = new Map();
  for (const r of rels) if (r.from !== r.to) received.set(r.target_note_id, (received.get(r.target_note_id) ?? 0) + 1);
  const partners = rows => {
    const m = new Map();
    for (const id of rows) m.set(id, (m.get(id) ?? 0) + 1);
    return [...m.entries()].map(([userId, count]) => ({ userId, name: W.PEOPLE[userId], count })).sort((a, b) => b.count - a.count);
  };
  return {
    member: { id: p.userId, name: p.name, avatar: null, isStaff: false },
    summary: { notes: p.notes, buildOnsGiven: p.buildOnsGiven, buildOnsReceived: p.buildOnsReceived, chars: p.chars, scaffolds: p.scaffolds, aiUse: p.aiUse, firstAt: notes.map(n => n.created_at).sort()[0] ?? null, lastAt: p.lastAt, quiet: p.quiet },
    timeline: o.timeline.map(t => ({
      day: t.day,
      notes: notes.filter(n => dayOf(n.created_at) === t.day).length,
      buildOns: rels.filter(r => r.from === p.userId && r.to !== p.userId && dayOf(r.created_at) === t.day).length,
    })),
    notes: notes.map(n => ({ id: n.id, title: n.title, createdAt: n.created_at, type: n.type, received: received.get(n.id) ?? 0, scaffolds: (String(n.content ?? '').match(/data-scaffold-id=/g) ?? []).length, chars: String(n.content ?? '').replace(/<[^>]+>/g, '').replace(/\s/g, '').length }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    builtOn: partners(rels.filter(r => r.from === p.userId && r.to !== p.userId).map(r => r.to)),
    builtOnBy: partners(rels.filter(r => r.to === p.userId && r.from !== p.userId).map(r => r.from)),
    relationTypes: { given: [], received: [] },
    scaffoldGroups: [],
    scaffoldTitles: p.scaffolds ? [{ label: '我的想法/观点是', count: p.scaffolds }] : [],
    feedback: { total: 3, adopted: 2, rejected: 1, ignored: 0, pending: 0, byType: [{ label: 'no_evidence', count: 2 }, { label: 'promising_seed', count: 1 }] },
    unanswered: notes.filter(n => !received.get(n.id)).length,
  };
}
