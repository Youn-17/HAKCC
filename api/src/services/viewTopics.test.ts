import { describe, expect, it } from 'vitest';
import {
  buildTopicPrompt,
  notesInView,
  parseTopics,
  REGENERATE_AFTER_MS,
  shouldRegenerate,
  topicSignature,
  WELCOME_VIEW_ID,
  type TopicNote,
} from './viewTopics';

/**
 * 问题栏后面滚动的讨论主题：哪些笔记算这个视图的、什么时候重新生成、模型给的结果怎么洗。
 */

const note = (id: string, over: Partial<TopicNote> = {}): TopicNote => ({
  id, title: `笔记 ${id}`, content: `<p>正文 ${id}</p>`, updated_at: '2026-10-05T01:00:00Z',
  views: ['v-1'], type: 'note', is_ai_generated: false, ...over,
});

describe('哪些笔记算这个视图的（和画布一致）', () => {
  const notes = [
    note('a'),
    note('b', { views: ['v-2'] }),
    note('c', { views: [] }),
    note('d', { views: ['v-gone'] }),
    note('e', { type: 'view' }),
    note('f', { is_ai_generated: true }),
  ];
  const existing = new Set(['v-1', 'v-2']);

  it('普通视图：views 里有它；视图卡、AI 写的不算', () => {
    expect(notesInView(notes, 'v-1', existing).map(n => n.id)).toEqual(['a']);
  });

  it('主画布：还收没有归属、或归属的视图已经不在的笔记', () => {
    expect(notesInView(notes, WELCOME_VIEW_ID, existing).map(n => n.id)).toEqual(['c', 'd']);
  });
});

describe('签名', () => {
  it('同一批笔记顺序不同签名一样；改了一条签名就变', () => {
    const a = [note('a'), note('b')];
    expect(topicSignature(a)).toBe(topicSignature([...a].reverse()));
    expect(topicSignature(a)).not.toBe(topicSignature([note('a'), note('b', { updated_at: '2026-10-05T02:00:00Z' })]));
  });
});

describe('什么时候重新生成', () => {
  const now = Date.parse('2026-10-05T03:00:00Z');
  it('没生成过：要', () => {
    expect(shouldRegenerate(null, 's1', now)).toBe(true);
  });
  it('笔记没变：不要', () => {
    expect(shouldRegenerate({ signature: 's1', created_at: '2026-10-05T00:00:00Z' }, 's1', now)).toBe(false);
  });
  it('变了但离上次不到 3 分钟：先不要（给旧的）；过了 3 分钟：要', () => {
    const recent = new Date(now - REGENERATE_AFTER_MS + 1000).toISOString();
    const old = new Date(now - REGENERATE_AFTER_MS - 1000).toISOString();
    expect(shouldRegenerate({ signature: 's1', created_at: recent }, 's2', now)).toBe(false);
    expect(shouldRegenerate({ signature: 's1', created_at: old }, 's2', now)).toBe(true);
  });
});

describe('提示词', () => {
  it('笔记编号 n1…，带标题和一段正文；规则里写明只做定位、不下结论', () => {
    const { system, user, idOf } = buildTopicPrompt([note('a', { title: '检索练习' }), note('b')]);
    expect(user.split('\n')[0]).toBe('[n1] 检索练习：正文 a');
    expect(idOf.get('n2')).toBe('b');
    expect(system).toContain('只做定位，不做综合');
    expect(system).toContain('不出现「大家在讨论」');
  });
});

describe('模型给的结果', () => {
  const idOf = new Map([['n1', 'a'], ['n2', 'b'], ['n3', 'c']]);

  it('编号换回笔记 id；按条数排；对不上的编号丢掉', () => {
    const topics = parseTopics({ topics: [
      { label: '回想与重读', noteIds: ['n1'] },
      { label: '检索练习的边界', noteIds: ['n1', 'n2', 'n9'] },
    ] }, idOf);
    expect(topics).toEqual([
      { label: '检索练习的边界', noteIds: ['a', 'b'], count: 2 },
      { label: '回想与重读', noteIds: ['a'], count: 1 },
    ]);
  });

  it('引号、句末标点去掉；一条笔记都对不上、标签太长、不是数组：不要', () => {
    const topics = parseTopics({ topics: [
      { label: '「AI 依赖」。', noteIds: ['n3'] },
      { label: '没有出处的主题', noteIds: ['n7'] },
      { label: '这是一个特别特别特别特别长的不像主题的一整句话了吧', noteIds: ['n1'] },
      { label: '缺编号', noteIds: 'n1' },
    ] }, idOf);
    expect(topics).toEqual([{ label: 'AI 依赖', noteIds: ['c'], count: 1 }]);
    expect(parseTopics(null, idOf)).toEqual([]);
    expect(parseTopics({ topics: 'x' }, idOf)).toEqual([]);
  });

  it('同名的合并，最多 6 个', () => {
    const list = Array.from({ length: 8 }, (_, i) => ({ label: `主题${i % 7}`, noteIds: ['n1'] }));
    const topics = parseTopics({ topics: list }, idOf);
    expect(topics).toHaveLength(6);
  });
});
