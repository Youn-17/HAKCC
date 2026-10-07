import { describe, expect, it } from 'vitest';
import type { AgentConversation, AgentMessage } from '../services/apiClient';
import {
  clampPanelWidth,
  conversationLabel,
  defaultPanelWidth,
  initialPanelWidth,
  mergeConversations,
  messagesFromApi,
  pickConversationToRestore,
  sortConversations,
  upsertConversation,
} from './workspaceAgentHistory';

/**
 * 知识空间 AI 助手的历史对话与面板宽度（纯逻辑）。
 */

const conv = (id: string, updatedAt: string, extra: Partial<AgentConversation> = {}): AgentConversation =>
  ({ id, title: `问题 ${id}`, updated_at: updatedAt, space_id: 'space-1', ...extra });

describe('sortConversations', () => {
  it('新的在前，同一条只留一次', () => {
    const out = sortConversations([
      conv('a', '2026-10-01T00:00:00Z'),
      conv('b', '2026-10-03T00:00:00Z'),
      conv('a', '2026-10-01T00:00:00Z'),
      conv('c', '2026-10-02T00:00:00Z'),
    ]);
    expect(out.map(c => c.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('pickConversationToRestore：打开面板时接着聊哪一段', () => {
  it('这个空间里最近的一段', () => {
    const list = [conv('old', '2026-10-01T00:00:00Z'), conv('new', '2026-10-03T00:00:00Z'), conv('mid', '2026-10-02T00:00:00Z')];
    expect(pickConversationToRestore(list, 'space-1')?.id).toBe('new');
  });

  it('别的空间里的不接：共享空间和各组的空间各聊各的', () => {
    const list = [conv('other', '2026-10-05T00:00:00Z', { space_id: 'space-2' }), conv('mine', '2026-10-01T00:00:00Z')];
    expect(pickConversationToRestore(list, 'space-1')?.id).toBe('mine');
    expect(pickConversationToRestore([list[0]], 'space-1')).toBeNull();
  });

  it('没有空间 id（手机整页打开）：不筛，取最近的', () => {
    const list = [conv('a', '2026-10-01T00:00:00Z', { space_id: 'space-9' }), conv('b', '2026-10-02T00:00:00Z', { space_id: 'space-8' })];
    expect(pickConversationToRestore(list, undefined)?.id).toBe('b');
  });

  it('一段都没聊过：回到空白', () => {
    expect(pickConversationToRestore([], 'space-1')).toBeNull();
  });
});

describe('upsertConversation：这一轮聊完，放到列表最前面', () => {
  it('新对话插到最前', () => {
    const out = upsertConversation([conv('a', '2026-10-01T00:00:00Z')], conv('b', '2026-10-02T00:00:00Z'));
    expect(out.map(c => c.id)).toEqual(['b', 'a']);
  });

  it('已有的对话挪到最前，标题保持第一句话，不被后面的提问改掉', () => {
    const list = [conv('b', '2026-10-02T00:00:00Z'), conv('a', '2026-10-01T00:00:00Z', { title: '最初的问题' })];
    const out = upsertConversation(list, { id: 'a', title: '后来的提问', updated_at: '2026-10-04T00:00:00Z' });

    expect(out.map(c => c.id)).toEqual(['a', 'b']);
    expect(out[0].title).toBe('最初的问题');
    expect(out[0].updated_at).toBe('2026-10-04T00:00:00Z');
  });
});

describe('mergeConversations：刷新历史列表时，本地刚放进去的不能被冲掉', () => {
  it('服务器没有的本地对话保留；两边都有的取服务器的标题、较新的时间', () => {
    const local = [conv('fresh', '2026-10-04T10:00:00Z'), conv('a', '2026-10-04T09:00:00Z', { title: '本地标题' })];
    const remote = [conv('a', '2026-10-01T00:00:00Z', { title: '服务器标题' }), conv('b', '2026-10-02T00:00:00Z')];
    const out = mergeConversations(local, remote);

    expect(out.map(c => c.id)).toEqual(['fresh', 'a', 'b']);
    expect(out.find(c => c.id === 'a')).toMatchObject({ title: '服务器标题', updated_at: '2026-10-04T09:00:00Z' });
  });

  it('服务器上新增的（别的设备聊的）也进来', () => {
    expect(mergeConversations([], [conv('x', '2026-10-01T00:00:00Z')]).map(c => c.id)).toEqual(['x']);
  });
});

describe('conversationLabel', () => {
  it('第一句话，压成一行', () => {
    expect(conversationLabel({ title: '  这个空间里\n大家在争论什么？ ' }, 'zh')).toBe('这个空间里 大家在争论什么？');
  });

  it('没有标题（或后端的占位名）就叫「新对话」', () => {
    expect(conversationLabel({ title: '' }, 'zh')).toBe('新对话');
    expect(conversationLabel({ title: 'New conversation' }, 'en')).toBe('New chat');
  });
});

describe('messagesFromApi：存下来的消息还原成对话', () => {
  const msg = (id: string, role: 'user' | 'assistant', content: string, tools?: string[]): AgentMessage =>
    ({ id, role, content, tools_used: tools, created_at: '2026-10-01T00:00:00Z' });

  it('保持顺序；助手用过的工具还原成「完成」的标签，同名只留一个', () => {
    const out = messagesFromApi([
      msg('1', 'user', '谁在 Build-on 谁？'),
      msg('2', 'assistant', '这一块里……', ['get_note_context', 'search_notes', 'get_note_context']),
    ]);

    expect(out.map(m => m.id)).toEqual(['1', '2']);
    expect(out[0].tools).toBeUndefined();
    expect(out[1].tools).toEqual([
      { name: 'get_note_context', status: 'done' },
      { name: 'search_notes', status: 'done' },
    ]);
  });

  it('空内容（回答中断时可能留下）不显示', () => {
    const out = messagesFromApi([msg('1', 'user', '问'), msg('2', 'assistant', '  '), msg('3', 'assistant', '答')]);
    expect(out.map(m => m.id)).toEqual(['1', '3']);
  });

  it('回答存着来源卡片（kb_sources）：读回来照样列出；没有的不带这一项', () => {
    const card = { n: 1, title: '论文.pdf', section: '方法', pageStart: 3, pageEnd: 4, excerpt: '访谈提纲', kind: 'attachment', noteId: 'note-1', relevance: 0.8 };
    const out = messagesFromApi([
      { ...msg('1', 'assistant', '见 [1]'), ai_metadata: { kb_sources: [card, { title: '缺编号的不要' }] } } as AgentMessage,
      msg('2', 'assistant', '没有资料'),
    ]);
    expect(out[0].kbSources).toEqual([card]);
    expect(out[1]).not.toHaveProperty('kbSources');
  });
});

describe('面板宽度', () => {
  it('默认占屏幕的一半，窄屏不低于 440，超宽屏不超过 1000', () => {
    expect(defaultPanelWidth(1440)).toBe(720);
    expect(defaultPanelWidth(1920)).toBe(960);
    expect(defaultPanelWidth(800)).toBe(440);
    expect(defaultPanelWidth(3000)).toBe(1000);
  });

  it('拖动范围：不窄过 360，不宽过屏幕的 85%', () => {
    expect(clampPanelWidth(100, 1440)).toBe(360);
    expect(clampPanelWidth(5000, 1440)).toBe(1224);
    expect(clampPanelWidth(700, 1440)).toBe(700);
  });

  it('学生拖过就记住；没记过、记的值不对就用默认的一半屏', () => {
    expect(initialPanelWidth(1440, '640')).toBe(640);
    expect(initialPanelWidth(1440, null)).toBe(720);
    expect(initialPanelWidth(1440, 'abc')).toBe(720);
    expect(initialPanelWidth(1440, '0')).toBe(720);
    // 换了小屏幕，记着的宽值也不能超出屏幕
    expect(initialPanelWidth(900, '1200')).toBe(765);
  });
});
