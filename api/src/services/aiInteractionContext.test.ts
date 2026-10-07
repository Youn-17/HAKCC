import { describe, expect, it } from 'vitest';
import { formatAiInteractionSection, type AiInteractionData, type FeedbackStatRow, type InsertionStatRow } from './aiInteractionContext';
import { isGenAiScaffold } from './feedbackLabels';

/**
 * 知识空间 AI 助手提示词里「AI 反馈和 AI 内容插入」这一段的写法（2026-10-06）。
 * 接到路由上的效果见 routes/workspaceAgent.test.ts。
 */

const feedback = (over: Partial<FeedbackStatRow>): FeedbackStatRow => ({
  id: 'f', note_id: 'n', user_id: 'u1', trigger_type: 'no_evidence', status: 'new', rejection_tag: null, published_note_id: null, review_state: null, ...over,
});
const insertion = (over: Partial<InsertionStatRow>): InsertionStatRow => ({
  id: 'i', note_id: 'n', user_id: 'u1', scaffold_id: null, reason_tag: null, feedback_id: null, source_message_id: 'm', ...over,
});
const data = (over: Partial<AiInteractionData>): AiInteractionData => ({
  feedbacks: [], insertions: [], scaffolds: new Map(), names: new Map(), ...over,
});
const staff = (d: AiInteractionData) => formatAiInteractionSection(d, { viewerId: 't', isStaff: true });

describe('AI 内容插入：选的是哪类支架', () => {
  it('混着的：GenAI、别的支架、只选了理由、什么都没选，分开数', () => {
    const text = staff(data({
      insertions: [
        insertion({ id: '1', scaffold_id: 'g' }),
        insertion({ id: '2', scaffold_id: 'kb' }),
        insertion({ id: '3', reason_tag: 'new_idea' }),
        insertion({ id: '4' }),
      ],
      scaffolds: new Map([['g', { title: 'GenAI对这个概念的解释是', gai: true }], ['kb', { title: '我的理论是', gai: false }]]),
    }));
    expect(text).toContain('4 time(s): GenAI scaffold 1, other scaffold 1, a reason tag instead of a scaffold 1, nothing chosen 1.');
    expect(text).not.toContain('every one with a GenAI scaffold');
  });

  it('支架后来被删了：算「别的支架」，名字写明已经不在列表里', () => {
    const text = staff(data({ insertions: [insertion({ scaffold_id: 'gone' })] }));
    expect(text).toContain('other scaffold 1');
    expect(text).toContain('「a scaffold no longer listed」 1');
  });

  it('GenAI 支架只认 metadata.gai = true', () => {
    expect(isGenAiScaffold({ gai: true })).toBe(true);
    expect(isGenAiScaffold({ gai: false })).toBe(false);
    expect(isGenAiScaffold({ gai: 'true' })).toBe(false);
    expect(isGenAiScaffold(null)).toBe(false);
  });
});

describe('AI 反馈卡', () => {
  it('不同意的理由：认得的写中文，认不得的照原样，没写的说没给', () => {
    const text = staff(data({
      feedbacks: [
        feedback({ id: '1', status: 'rejected', rejection_tag: 'off_track' }),
        feedback({ id: '2', status: 'rejected', rejection_tag: 'legacy_tag' }),
        feedback({ id: '3', status: 'rejected' }),
      ],
    }));
    expect(text).toContain('disagreed 3 (和我的探究无关 1, legacy_tag 1, no reason given 1)');
  });

  it('早期的触发类型没有中文名：照原样写（下划线换空格）', () => {
    expect(staff(data({ feedbacks: [feedback({ trigger_type: 'evidence_gap' })] }))).toContain('By type: evidence gap 1.');
  });

  it('采纳了都已发布：不写「还没发布」', () => {
    const text = staff(data({ feedbacks: [feedback({ status: 'accepted', published_note_id: 'p' })] }));
    expect(text).toContain('adopted 1 (1 posted on the canvas as their own notes);');
  });
});

describe('采纳之后（10-05 起：学生先改原笔记，贡献时再判定）', () => {
  it('发布了、在原笔记里回应了、还在等，三种分开数；没有判定记录的旧行算还在等', () => {
    const text = staff(data({
      feedbacks: [
        feedback({ id: '1', status: 'accepted', published_note_id: 'p', review_state: 'published' }),
        feedback({ id: '2', status: 'accepted', review_state: 'addressed' }),
        feedback({ id: '3', status: 'accepted', review_state: 'pending' }),
        feedback({ id: '4', status: 'accepted', review_state: 'uncertain' }),
        feedback({ id: '5', status: 'accepted' }),
      ],
    }));
    expect(text).toContain("adopted 5 (1 posted on the canvas as their own notes, 1 answered by the student's own revision of the original note, so no separate note, 3 still waiting for the student's revision)");
  });

  it('学生看全班：只数发布成笔记的（在原笔记里回应的不是单独公开的）', () => {
    const text = formatAiInteractionSection(data({
      feedbacks: [
        feedback({ id: '1', user_id: 'other', status: 'accepted', published_note_id: 'p' }),
        feedback({ id: '2', user_id: 'other', status: 'accepted', review_state: 'addressed' }),
      ],
    }), { viewerId: 'me', isStaff: false });
    expect(text).toContain('Visible to everyone on the canvas: 1 adopted AI feedback card(s) posted as notes');
  });
});

describe('按人分（只给教职）', () => {
  it('没有名字的成员不写 id；超过 20 人只列最活跃的 20 个', () => {
    const feedbacks = Array.from({ length: 25 }, (_, i) => feedback({ id: `f${i}`, user_id: `u${i}` }));
    const text = staff(data({ feedbacks, names: new Map([['u0', '林晓']]) }));
    expect(text).toContain('林晓: 1 card(s)');
    expect(text).toContain('a member without a name: 1 card(s)');
    expect(text).not.toContain('u1:');
    expect(text).toContain('… and 5 more.');
  });
});
