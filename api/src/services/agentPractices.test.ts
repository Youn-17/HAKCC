import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase', () => ({ supabase: {} }));

import {
  PRACTICE_LIMITS,
  answerFeatures,
  cardsFor,
  duplicateOf,
  evidenceSentence,
  featureStats,
  kindRates,
  pairTurns,
  pickCandidates,
  practiceSection,
  taskKind,
  trialVerdict,
  type AgentTurnRecord,
  type FeatureId,
  type PracticeCard,
  type TaskKind,
} from './agentPractices';

/** 做法卡（第五步）：任务类型、回答里的做法、接没接住、按类比较、挑候选、试用撤回、放进提示词 */

describe('任务类型和回答里的做法', () => {
  it('任务类型：做东西、代写、改自己的、规划、普通提问', () => {
    expect(taskKind('帮我做一个对比表网页')).toBe('make');
    expect(taskKind('帮我写一段观点，我直接贴上去')).toBe('ghostwrite');
    expect(taskKind('帮我改一下这句话：The essay was never the learning.')).toBe('polish');
    expect(taskKind('我想写一条 Rise-above，你能帮我规划步骤吗？')).toBe('plan');
    expect(taskKind('这几条笔记的分歧在哪？')).toBe('ask');
  });

  it('从回答和存下来的元数据看做法', () => {
    const f = answerFeatures('可以从这两个开头接下去：「我更认同……」。见《The autocomplete trap》和《Evidence: desirable difficulties》。你更想回应哪一条？', {
      question: { id: 'q' }, plan: { steps: [{ title: '找笔记' }] }, artifacts: [{ id: 'a' }],
    });
    expect(f.sort()).toEqual(['asked_choice', 'cited_notes', 'ends_with_question', 'gave_starters', 'made_page', 'made_plan', 'short_answer'].sort());
    expect(answerFeatures('长'.repeat(500), {})).toEqual([]);
  });
});

describe('一条条回答和接没接住', () => {
  const t0 = Date.parse('2026-10-11T02:00:00Z');
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  const msgs = [
    { id: 'u1', role: 'user' as const, content: '帮我做个对比表', meta: {}, createdAt: at(0) },
    { id: 'a1', role: 'assistant' as const, content: '做哪种？', meta: { question: { id: 'q1' }, practice_cards: ['card-1'] }, createdAt: at(1) },
    { id: 'u2', role: 'user' as const, content: '选第一种', meta: { choice: { question_id: 'q1', label: '对比表' } }, createdAt: at(50) },
    { id: 'a2', role: 'assistant' as const, content: '做好了。', meta: { artifacts: [{ id: 'art-1' }] }, createdAt: at(52) },
    { id: 'u3', role: 'user' as const, content: '这几条笔记在说什么', meta: {}, createdAt: at(200) },
    { id: 'a3', role: 'assistant' as const, content: '在说代理测量。', meta: {}, createdAt: at(201) },
  ];

  it('回答了选项卡算接住（隔了 49 分钟也算）；网页放进笔记算接住；没人理的不算；带上用过的做法卡', () => {
    const turns = pairTurns('workspace', 'c1', 'stu', msgs, new Set(['art-1']));
    expect(turns.map(t => [t.id, t.kind, t.adopted, t.engaged])).toEqual([
      ['a1', 'make', false, true],
      ['a2', 'make', true, false],
      ['a3', 'ask', false, false],
    ]);
    expect(turns[0].cards).toEqual(['card-1']);
    expect(turns[1].question).toBe('选第一种');
  });
});

const turn = (kind: TaskKind, features: FeatureId[], took: boolean, cards: string[] = []): AgentTurnRecord => ({
  id: Math.random().toString(36).slice(2), surface: 'workspace', conversationId: 'c', userId: 'u', question: 'q', reply: 'r',
  kind, features, createdAt: '2026-10-11T00:00:00Z', adopted: took, engaged: false, cards,
});

describe('按类比较、挑候选', () => {
  // 做东西：先给选项卡的 10 次接住 8 次，没给的 15 次接住 3 次
  const make = [
    ...Array.from({ length: 10 }, (_, i) => turn('make', ['asked_choice'], i < 8)),
    ...Array.from({ length: 15 }, (_, i) => turn('make', [], i < 3)),
  ];

  it('一类不到 20 条不比；够了就算两边的接住率', () => {
    expect(featureStats(make.slice(0, 19))).toEqual([]);
    const stat = featureStats(make).find(s => s.feature === 'asked_choice')!;
    expect(stat.with).toEqual({ took: 8, total: 10, rate: 0.8 });
    expect(stat.without).toEqual({ took: 3, total: 15, rate: 0.2 });
    expect(stat.lift).toBeCloseTo(0.6);
    expect(kindRates(make).make.total).toBe(25);
    expect(evidenceSentence(stat)).toBe('「做东西（网页、题目、表格）」这类问题里，先用选项卡让学生定方向的回答 10 次里 8 次被接住（80%），没这样做的 15 次里 3 次（20%）。');
  });

  it('挑候选：差得够多才提；同类同做法已经有卡（被拒过也算）就不再提', () => {
    const stats = featureStats(make);
    expect(pickCandidates(stats, []).map(s => s.feature)).toEqual(['asked_choice']);
    expect(pickCandidates(stats, [{ task_kind: 'make', evidence: { feature: 'asked_choice' } }])).toEqual([]);
    const flat = [...Array.from({ length: 12 }, (_, i) => turn('ask', ['short_answer'], i < 6)), ...Array.from({ length: 12 }, (_, i) => turn('ask', [], i < 5))];
    expect(pickCandidates(featureStats(flat), [])).toEqual([]);
  });
});

describe('试用和放进提示词', () => {
  it('没用满 20 次：还在试用；用满了不比采用前高就撤回，高了就留着', () => {
    expect(trialVerdict(0.3, Array.from({ length: 5 }, () => turn('make', [], true))).verdict).toBe('trial');
    const worse = trialVerdict(0.5, Array.from({ length: PRACTICE_LIMITS.trialUses }, (_, i) => turn('make', [], i < 8)));
    expect(worse).toMatchObject({ verdict: 'retire', uses: 20, rate: 0.4 });
    expect(worse.reason).toBe('试用 20 次，接住率 40%，没比采用前（50%）高');
    expect(trialVerdict(0.3, Array.from({ length: 20 }, (_, i) => turn('make', [], i < 12))).verdict).toBe('keep');
    expect(trialVerdict(null, Array.from({ length: 30 }, () => turn('make', [], false))).verdict).toBe('trial');
  });

  const card = (id: string, kind: TaskKind, practice: string): PracticeCard => ({
    id, course_id: 'c', task_kind: kind, practice, rationale: null, evidence: {}, origin: 'teacher', status: 'active',
    baseline_rate: null, decided_at: null, retired_reason: null, created_at: '2026-10-11T00:00:00Z',
  });

  it('只放这类任务的、最多三张；没有就不加这一段', () => {
    const cards = [card('1', 'make', '做自测题时最后一题留成开放题'), card('2', 'ask', '回答最后交回一个问题'), card('3', 'make', '先用选项卡定方向'), card('4', 'make', '先列计划'), card('5', 'make', '标出处')];
    expect(cardsFor(cards, 'make').map(c => c.id)).toEqual(['1', '3', '4']);
    expect(practiceSection(cardsFor(cards, 'ask'))).toBe('PRACTICES THAT WORKED IN THIS COURSE (approved by the teacher; follow them when they fit this request):\n- 回答最后交回一个问题');
    expect(practiceSection([])).toBe('');
  });

  it('同类里意思差不多的算重复', () => {
    const cards = [card('1', 'make', '做自测题时最后一题留成开放题，让学生自己写')];
    expect(duplicateOf('做自测题时，最后一题留成开放题让学生自己写', 'make', cards)).toBe('1');
    expect(duplicateOf('做自测题时，最后一题留成开放题让学生自己写', 'ask', cards)).toBeNull();
  });
});
