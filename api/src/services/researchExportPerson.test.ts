import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 研究导出「按人导出」（2026-10-09 用户：要能导出一个人的所有数据，可选）。
 * 跑真的 buildAllDatasets，只替换数据库：没给数据的表一律当空表。
 */

const h = vi.hoisted(() => {
  const fixtures: Record<string, unknown[]> = {};
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: fixtures[table] ?? [], error: null, count: (fixtures[table] ?? []).length });
    const proxy: unknown = new Proxy({}, {
      get(_target, prop: string) {
        if (prop === 'then') return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => result().then(ok, fail);
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => Promise.resolve({ data: (fixtures[table] ?? [])[0] ?? null, error: null });
        }
        return () => proxy;
      },
    });
    return proxy;
  };
  return { fixtures, from };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));

import { buildAllDatasets, buildReadme, restrictToPerson, DATASET_KEYS, type ExportScope } from './researchExport';
import type { ParticipantIdentity } from './participantCode';

const person = (userId: string, code: string, name: string, isTeacher = false): [string, ParticipantIdentity] =>
  [userId, { userId, code, name, email: '', role: isTeacher ? 'teacher' : 'student', isTeacher }];

function scope(filters: ExportScope['filters'] = {}): ExportScope {
  return {
    courseId: 'course-1',
    filters,
    tz: 8,
    englishName: 'AI and Learning',
    abbr: 'AL',
    identities: new Map([person('s1', 'SAL01', '林晓'), person('s2', 'SAL02', '周子涵'), person('s3', 'SAL03', '赵一凡'), person('t1', 'TAL01', '刘老师', true)]),
    spaceIds: ['space-1'],
    spaceById: new Map([['space-1', { id: 'space-1', title: '第 3 周', group_id: null }]]),
    groupById: new Map([['g1', { id: 'g1', name: '一组', condition: 'treatment' }]]),
    groupOfUser: new Map([['s1', 'g1'], ['s2', 'g1'], ['s3', 'g1']]),
    overrideOfUser: new Map(),
    participantScope: null,
    courseStartMs: Date.parse('2026-09-14T00:00:00Z'),
  };
}

const note = (id: string, authorId: string, title: string, created = '2026-10-01T02:00:00Z') => ({
  id, space_id: 'space-1', author_id: authorId, type: 'note', title, content: '<p>正文</p>', views: ['view-welcome'], tags: [],
  epistemic_status: null, is_ai_generated: false, ai_trigger_type: null, inquiry_question: null, promising_reason: null,
  scaffold_id: null, scaffold_responses: null, ai_adoption_scaffold_id: null, content_segments: null, segment_stats: null,
  created_at: created, updated_at: created, deleted_at: null,
});
const relation = (id: string, source: string, target: string, creator: string) => ({
  id, space_id: 'space-1', source_note_id: source, target_note_id: target, relation_type: 'extend',
  creator_id: creator, ai_suggested: false, created_at: '2026-10-02T02:00:00Z',
});
const thread = (id: string, over: Record<string, unknown>) => ({
  id, note_id: 'n1', space_id: 'space-1', target_type: 'ai', group_id: null, target_user_id: null,
  created_by: 's1', created_at: '2026-10-02T02:00:00Z', deleted_at: null, ...over,
});
const message = (id: string, threadId: string, senderKind: 'user' | 'assistant', senderId: string | null, content: string) => ({
  id, thread_id: threadId, sender_id: senderId, sender_kind: senderKind, content, scaffold_step_id: null,
  created_at: '2026-10-02T03:00:00Z',
});

beforeEach(() => {
  for (const key of Object.keys(h.fixtures)) delete h.fixtures[key];
  h.fixtures.notes = [
    note('n1', 's1', '林晓的想法'),
    note('n2', 's2', '周子涵接着写', '2026-10-01T03:00:00Z'),
    note('n3', 's3', '赵一凡的想法', '2026-10-01T04:00:00Z'),
    note('n4', 's1', '林晓接着赵一凡写', '2026-10-01T05:00:00Z'),
  ];
  h.fixtures.relations = [
    relation('r1', 'n2', 'n1', 's2'),   // 同学在林晓的笔记上 Build-on：林晓是接收方
    relation('r2', 'n4', 'n3', 's1'),   // 林晓在同学的笔记上 Build-on：林晓是发起方
    relation('r3', 'n3', 'n2', 's3'),   // 和林晓无关
  ];
  h.fixtures.note_conversation_threads = [
    thread('th-ai', {}),                                                        // 林晓和 AI
    thread('th-dm', { target_type: 'member', created_by: 's2', target_user_id: 's1' }),  // 周子涵私聊林晓
    thread('th-group', { target_type: 'group', group_id: 'g1', created_by: 's3' }),       // 小组讨论
    thread('th-other', { created_by: 's2', note_id: 'n2' }),                     // 周子涵和 AI
  ];
  h.fixtures.note_conversation_messages = [
    message('m1', 'th-ai', 'user', 's1', '这样说有证据吗？'),
    message('m2', 'th-ai', 'assistant', null, 'AI 的回答'),
    message('m3', 'th-dm', 'user', 's2', '周子涵对林晓说'),
    message('m4', 'th-group', 'user', 's3', '赵一凡在组里说'),
    message('m5', 'th-group', 'user', 's1', '林晓在组里说'),
    message('m6', 'th-other', 'user', 's2', '周子涵问 AI'),
  ];
  h.fixtures.note_revisions = [
    { id: 'rv1', note_id: 'n1', editor_id: 't1', content: '<p>老师改过</p>', created_at: '2026-10-03T02:00:00Z' },
    { id: 'rv2', note_id: 'n2', editor_id: 's2', content: '<p>周子涵自己改</p>', created_at: '2026-10-03T03:00:00Z' },
  ];
  h.fixtures.course_sessions = [{ session_no: 1, week_no: 1, status: 'held', planned_date: '2026-10-01', metrics: {} }];
});

describe('按人导出', () => {
  it('只留和这个人有关的行：Ta 的笔记、Ta 发起和接收的互动；序号重新排', async () => {
    const built = await buildAllDatasets(scope({ participantUserId: 's1' }));
    expect(built.datasets.notes.rows.map(r => r.title)).toEqual(['林晓的想法', '林晓接着赵一凡写']);
    expect(built.datasets.notes.rows.map(r => r.seq)).toEqual([1, 2]);
    expect(built.datasets.participants.rows.map(r => r.participant_id)).toEqual(['SAL01']);

    const buildOns = built.datasets.interactions.rows.filter(r => String(r.interaction_type).startsWith('build_on'));
    expect(buildOns.map(r => [r.from_participant_id, r.to_participant_id]).sort()).toEqual([['SAL01', 'SAL03'], ['SAL02', 'SAL01']]);
    for (const row of built.datasets.interactions.rows) {
      expect([row.from_participant_id, row.to_participant_id]).toContain('SAL01');
    }
    expect(built.counts.notes).toBe(2);
  });

  it('对话：Ta 发的、Ta 和 AI 对话里 AI 的回复、同学私聊 Ta 的；小组里别人说的不含', async () => {
    const built = await buildAllDatasets(scope({ participantUserId: 's1' }));
    expect(built.datasets.messages.rows.map(r => r.message_id).sort()).toEqual(['m1', 'm2', 'm3', 'm5']);
  });

  it('修订史：Ta 的笔记被老师改的也在；课次记录是全班的，不含', async () => {
    const built = await buildAllDatasets(scope({ participantUserId: 's1' }));
    expect(built.datasets.note_revisions.rows.map(r => r.revision_id ?? r.note_id)).toHaveLength(1);
    expect(built.datasets.note_revisions.rows[0].participant_id).toBe('TAL01');
    expect(built.datasets.sessions.rows).toEqual([]);
    // 不按人时课次记录照常有
    expect((await buildAllDatasets(scope())).datasets.sessions.rows).toHaveLength(1);
  });

  it('不在名单里的人：各表都是空的，并说明原因', async () => {
    const built = await buildAllDatasets(scope({ participantUserId: 'nobody' }));
    for (const key of DATASET_KEYS) expect(built.datasets[key].rows).toEqual([]);
    expect(built.warnings.join()).toContain('找不到这位参与者');
  });

  it('README 写明是谁、按什么口径留的行；带姓名时才写姓名', async () => {
    const s = scope({ participantUserId: 's1' });
    const built = await buildAllDatasets(s);
    const readme = buildReadme(s, built, '2026-10-09T00:00:00Z', ['notes', 'interactions', 'messages']);
    expect(readme).toContain('- 参与者:SAL01(只含和这个人有关的行');
    expect(readme).not.toContain('林晓');
    expect(readme).toContain('## 按人导出');
    expect(readme).toContain('小组讨论里别人的消息不含');
    const named = { ...s, filters: { ...s.filters, includeNames: true } };
    expect(buildReadme(named, built, '2026-10-09T00:00:00Z', ['notes'])).toContain('SAL01(林晓)');
    // 不按人时没有这一节
    expect(buildReadme(scope(), built, '2026-10-09T00:00:00Z', ['notes'])).not.toContain('## 按人导出');
  });
});

describe('restrictToPerson', () => {
  it('编号为空时什么都不留（不会把编号为空的行当成这个人的）', () => {
    const empty = Object.fromEntries(DATASET_KEYS.map(k => [k, { key: k, rows: [{ seq: 1, participant_id: '' }], truncated: false }]));
    const out = restrictToPerson(empty as never, { userId: 'x', code: '' }, { noteAuthorOf: () => undefined, threadOf: () => undefined });
    for (const key of DATASET_KEYS) expect(out[key].rows).toEqual([]);
  });
});
