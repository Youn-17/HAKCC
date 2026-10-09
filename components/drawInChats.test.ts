// @vitest-environment jsdom
/**
 * 「画一张……」在文档 AI 侧栏和对话式笔记里也管用（2026-09-29 用户要求：任何 AI 对话界面都能画）。
 * 挂真组件，只把接口换成假的：
 *   - 要画就直接出图，不走对话模型；等图的时候放绘图动画；
 *   - 其余的话照常走对话模型；
 *   - 画不成，把原因告诉学生，刚才那句话放回输入框。
 * 2026-10-09 起要不要画由服务端的 Jev 判断（/ai/draw-route）：换了说法的也画，画完说「颜色淡一点」是改上一张；
 * 和图不沾边的句子不去问；服务端没回就按「画一张……」这类说法认。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Note } from '../types';

const api = vi.hoisted(() => {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  Element.prototype.scrollTo = function scrollTo() {} as Element['scrollTo'];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return {
    ai: { listConfigs: vi.fn(), chat: vi.fn(), image: vi.fn(), drawRoute: vi.fn() },
    documents: { chatHistory: vi.fn(), recordChatTurn: vi.fn() },
    noteConversations: { list: vi.fn(), listMessages: vi.fn(), sendAIMessage: vi.fn(), generateImage: vi.fn() },
  };
});
vi.mock('../services/apiClient', () => api);

import DocAiPanel from './DocAiPanel';
import AiDialogueNote from './AiDialogueNote';

const IMAGE_URL = 'https://storage.example.test/generated/cat.png';
const PROGRESS = '[role="status"][aria-label^="正在画"]';

let host: HTMLDivElement;
let root: Root;

const ROUTE = { p_draw: 0.99, decided_by: 'jev' };
const draws = (mode: 'new' | 'edit' = 'new', form: string | null = null) =>
  ({ draw: true, mode, form, decided_by: 'jev', route: { ...ROUTE, mode } });

beforeEach(() => {
  vi.clearAllMocks();
  // 默认服务端判断不可用：按「画一张……」这类说法认（和以前一样）
  api.ai.drawRoute.mockRejectedValue(new Error('offline'));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function waitFor<T>(probe: () => T | null | undefined | false, label: string, timeoutMs = 2000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value as T;
    if (Date.now() - started > timeoutMs) throw new Error(`等不到：${label}`);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  }
}

async function say(text: string) {
  const box = await waitFor(() => {
    const el = host.querySelector('textarea');
    return el && !el.disabled ? el : null;
  }, '输入框可用');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  return box;
}

function gate<T>(value: T) {
  let release!: () => void;
  const promise = new Promise<T>(resolve => { release = () => resolve(value); });
  return { promise, release: () => act(async () => { release(); }) };
}

describe('文档 AI 侧栏', () => {
  const mountPanel = async () => {
    api.ai.listConfigs.mockResolvedValue({ configs: [{ providerId: 'deepseek', isVerified: true, enabledModels: ['deepseek-v4-flash'] }] });
    api.documents.chatHistory.mockResolvedValue({ threads: [] });
    api.documents.recordChatTurn.mockResolvedValue({ thread_id: 'doc-thread-1' });
    await act(async () => {
      root.render(React.createElement(DocAiPanel, {
        noteId: 'note-1', courseId: 'course-1', docTitle: '细胞分裂', docText: '有丝分裂分为前期、中期、后期和末期。', lang: 'zh',
      }));
    });
    await waitFor(() => api.ai.listConfigs.mock.calls.length > 0, '读课程 AI 配置');
    await act(async () => { await Promise.resolve(); });
  };

  it('说「画一只……」：不问对话模型，直接出图；等图时放绘图动画，画好的图显示出来并存进对话记录', async () => {
    const pending = gate({ url: IMAGE_URL, markdown: `![画一只在月球上看书的猫](${IMAGE_URL})`, provider_id: 'dmx', model: 'qwen-image-plus' });
    api.ai.image.mockReturnValue(pending.promise);
    api.ai.drawRoute.mockResolvedValue(draws('new', 'picture'));
    await mountPanel();

    await say('画一只在月球上看书的猫');
    await waitFor(() => api.ai.image.mock.calls.length > 0, '出图');
    expect(api.ai.drawRoute).toHaveBeenCalledWith({ text: '画一只在月球上看书的猫', previous: null, last_reply: null, forced: false });
    // 带上文档和这段对话：服务端先读它们弄清楚要画什么（2026-10-09）；Jev 定下的种类和判断经过一起带过去
    expect(api.ai.image).toHaveBeenCalledWith({
      course_id: 'course-1', prompt: '画一只在月球上看书的猫', feature: 'doc_ai',
      context: { title: '细胞分裂', text: '有丝分裂分为前期、中期、后期和末期。', history: [] },
      mode: 'new', form: 'picture', route: { ...ROUTE, mode: 'new' },
    });
    expect(api.ai.chat).not.toHaveBeenCalled();
    const progress = await waitFor(() => host.querySelector(PROGRESS), '绘图动画');
    expect(progress.textContent).toContain('读懂你的意思');
    expect(host.textContent).not.toContain('正在读这份文档');

    await pending.release();
    await waitFor(() => host.querySelector(`img[src="${IMAGE_URL}"]`), '画好的图');
    expect(host.querySelector(PROGRESS)).toBeNull();
    await waitFor(() => api.documents.recordChatTurn.mock.calls.length > 0, '存进对话记录');
    expect(api.documents.recordChatTurn).toHaveBeenCalledWith('note-1', {
      question: '画一只在月球上看书的猫',
      answer: `![画一只在月球上看书的猫](${IMAGE_URL})`,
      thread_id: null,
      provider_id: 'dmx',
      model: 'qwen-image-plus',
    });
  });

  it('普通提问照常走对话模型，不出图、不放绘图动画', async () => {
    api.ai.chat.mockResolvedValue({ reply: '核心主张是细胞周期受检查点调控。', provider_id: 'deepseek', model: 'deepseek-v4-flash' });
    await mountPanel();

    await say('这份文档的核心主张是什么？');
    await waitFor(() => host.textContent?.includes('检查点调控'), '回复');
    expect(api.ai.image).not.toHaveBeenCalled();
    // 和图不沾边：不去问要不要画
    expect(api.ai.drawRoute).not.toHaveBeenCalled();
    expect(api.ai.chat).toHaveBeenCalledWith(expect.objectContaining({ course_id: 'course-1', feature: 'doc_ai' }));
    expect(host.querySelector(PROGRESS)).toBeNull();
  });

  it('换了说法（没有「画」字）也画：服务端判断要画、画成时间线', async () => {
    api.ai.image.mockResolvedValue({ url: IMAGE_URL, markdown: `![四个时期](${IMAGE_URL})\n\n画了有丝分裂的四个时期。`, provider_id: 'hakcc', model: 'diagram', caption: '画了有丝分裂的四个时期。', kind: 'diagram' });
    api.ai.drawRoute.mockResolvedValue(draws('new', 'timeline'));
    await mountPanel();

    await say('能把这几个时期可视化一下吗？');
    await waitFor(() => host.querySelector(`img[src="${IMAGE_URL}"]`), '画好的图');
    expect(api.ai.image).toHaveBeenCalledWith(expect.objectContaining({ prompt: '能把这几个时期可视化一下吗？', mode: 'new', form: 'timeline' }));
    expect(api.ai.chat).not.toHaveBeenCalled();
  });

  it('服务端判断不是要画（问画图要注意什么）：照常走对话模型', async () => {
    api.ai.chat.mockResolvedValue({ reply: '先想清楚要表达的关系。', provider_id: 'deepseek', model: 'deepseek-v4-flash' });
    api.ai.drawRoute.mockResolvedValue({ draw: false, mode: 'new', form: null, decided_by: 'jev', route: { p_draw: 0.06 } });
    await mountPanel();

    await say('画一张图需要注意什么？');
    await waitFor(() => host.textContent?.includes('要表达的关系'), '回复');
    expect(api.ai.image).not.toHaveBeenCalled();
  });

  it('画完说「颜色再淡一点」：带上刚才那张去改，动画写「读懂你要怎么改」', async () => {
    api.ai.image.mockResolvedValueOnce({
      url: IMAGE_URL, markdown: `![月球上的猫](${IMAGE_URL})\n\n画了一只在月球上看书的猫。`, provider_id: 'dmx', model: 'seedream',
      caption: '画了一只在月球上看书的猫。', kind: 'picture', drawing: { kind: 'picture', prompt: 'A cat reading on the moon' },
    });
    api.ai.drawRoute.mockResolvedValueOnce(draws('new', 'picture'));
    await mountPanel();
    await say('画一只在月球上看书的猫');
    await waitFor(() => host.querySelector(`img[src="${IMAGE_URL}"]`), '第一张');

    const pending = gate({ url: `${IMAGE_URL}?v=2`, markdown: `![淡一点](${IMAGE_URL}?v=2)`, provider_id: 'dmx', model: 'seedream', kind: 'picture' });
    api.ai.image.mockReturnValueOnce(pending.promise);
    api.ai.drawRoute.mockResolvedValueOnce(draws('edit', 'picture'));
    await say('颜色再淡一点');
    await waitFor(() => api.ai.image.mock.calls.length > 1, '改图');
    const previous = { request: '画一只在月球上看书的猫', caption: '画了一只在月球上看书的猫。', kind: 'picture', prompt: 'A cat reading on the moon' };
    expect(api.ai.drawRoute).toHaveBeenLastCalledWith({ text: '颜色再淡一点', previous, last_reply: null, forced: false });
    expect(api.ai.image.mock.calls[1][0]).toMatchObject({ mode: 'edit', form: 'picture', context: { previous } });
    const progress = await waitFor(() => host.querySelector(PROGRESS), '绘图动画');
    expect(progress.textContent).toContain('读懂你要怎么改');
    await pending.release();
  });

  it('画不成：说明原因，那句话放回输入框', async () => {
    api.ai.image.mockRejectedValue(new Error('本课程未配置 MiniMax 或 DMX'));
    await mountPanel();

    const box = await say('帮我画一幅细胞分裂的水彩画');
    await waitFor(() => host.textContent?.includes('本课程未配置 MiniMax 或 DMX'), '失败原因');
    expect(box.value).toBe('帮我画一幅细胞分裂的水彩画');
    expect(host.querySelector(PROGRESS)).toBeNull();
    expect(api.documents.recordChatTurn).not.toHaveBeenCalled();
  });
});

describe('对话式笔记', () => {
  const NOTE = { id: 'note-1', title: '采纳的反馈' } as unknown as Note;
  const earlier = {
    id: 'm-1', threadId: 'thread-1', senderId: null, senderKind: 'assistant', content: '你的观点可以补一个例子。',
    attachments: [], aiMetadata: { source_note_id: 'note-0' }, createdAt: '2026-09-29T01:00:00.000Z',
  };

  const mountDialogue = async () => {
    api.noteConversations.list.mockResolvedValue({
      conversations: [{ id: 'thread-1', targetType: 'ai', providerId: 'deepseek', model: 'deepseek-v4-flash' }],
      aiConfigs: [],
    });
    api.noteConversations.listMessages.mockResolvedValue({ messages: [earlier] });
    await act(async () => {
      root.render(React.createElement(AiDialogueNote, {
        note: NOTE, lang: 'zh', onClose: () => {}, onInsertToSource: () => {}, onPublishAsNote: () => {},
      }));
    });
    await waitFor(() => host.textContent?.includes('补一个例子'), '已有的对话');
  };

  it('说「画一张……」：直接出图，不走对话模型；等图时放绘图动画，画完显示出来', async () => {
    const pending = gate({});
    api.noteConversations.generateImage.mockReturnValue(pending.promise);
    await mountDialogue();

    await say('画一张同学们围坐讨论的插画');
    await waitFor(() => api.noteConversations.generateImage.mock.calls.length > 0, '出图');
    // 服务端判断不可用（默认）：按说法认，新画一张
    expect(api.noteConversations.generateImage).toHaveBeenCalledWith('thread-1', { prompt: '画一张同学们围坐讨论的插画', mode: 'new', form: null });
    expect(api.noteConversations.sendAIMessage).not.toHaveBeenCalled();
    await waitFor(() => host.querySelector(PROGRESS), '绘图动画');

    api.noteConversations.listMessages.mockResolvedValue({
      messages: [
        earlier,
        { ...earlier, id: 'm-2', senderKind: 'user', content: '画一张同学们围坐讨论的插画', aiMetadata: { direct_image: true } },
        { ...earlier, id: 'm-3', content: `![画一张同学们围坐讨论的插画](${IMAGE_URL})`, aiMetadata: { direct_image: true } },
      ],
    });
    await pending.release();
    await waitFor(() => host.querySelector(`img[src="${IMAGE_URL}"]`), '画好的图');
    expect(host.querySelector(PROGRESS)).toBeNull();
  });

  it('上一条是 AI 画的图，说「把第三个框改成检索练习」：按改图去画', async () => {
    api.noteConversations.generateImage.mockResolvedValue({});
    api.noteConversations.listMessages.mockResolvedValue({
      messages: [
        earlier,
        { ...earlier, id: 'm-2', senderKind: 'user', content: '画一张我们讨论的观点关系图', aiMetadata: { direct_image: true } },
        {
          ...earlier, id: 'm-3', content: `![关系图](${IMAGE_URL})\n\n画了五个看法之间的关系。`,
          aiMetadata: { direct_image: true, drawing: { kind: 'diagram', caption: '画了五个看法之间的关系。', diagram: { type: 'graph', nodes: [], edges: [] } } },
        },
      ],
    });
    api.noteConversations.list.mockResolvedValue({
      conversations: [{ id: 'thread-1', targetType: 'ai', providerId: 'deepseek', model: 'deepseek-v4-flash' }],
      aiConfigs: [],
    });
    api.ai.drawRoute.mockResolvedValue(draws('edit', 'graph'));
    await act(async () => {
      root.render(React.createElement(AiDialogueNote, {
        note: NOTE, lang: 'zh', onClose: () => {}, onInsertToSource: () => {}, onPublishAsNote: () => {},
      }));
    });
    await waitFor(() => host.textContent?.includes('五个看法'), '刚画的图');

    await say('把第三个框改成检索练习');
    await waitFor(() => api.noteConversations.generateImage.mock.calls.length > 0, '改图');
    expect(api.ai.drawRoute).toHaveBeenCalledWith({
      text: '把第三个框改成检索练习',
      previous: { request: '画一张我们讨论的观点关系图', caption: '画了五个看法之间的关系。', kind: 'diagram', diagram: { type: 'graph', nodes: [], edges: [] } },
      last_reply: null,
      forced: false,
    });
    expect(api.noteConversations.generateImage).toHaveBeenCalledWith('thread-1', {
      prompt: '把第三个框改成检索练习', mode: 'edit', form: 'graph', route: { ...ROUTE, mode: 'edit' },
    });
    expect(api.noteConversations.sendAIMessage).not.toHaveBeenCalled();
  });

  it('普通追问照常走对话模型', async () => {
    api.noteConversations.sendAIMessage.mockResolvedValue({});
    await mountDialogue();

    await say('能再举一个例子吗？');
    await waitFor(() => api.noteConversations.sendAIMessage.mock.calls.length > 0, '发给对话模型');
    expect(api.noteConversations.sendAIMessage).toHaveBeenCalledWith('thread-1', {
      content: '能再举一个例子吗？', provider_id: 'deepseek', model: 'deepseek-v4-flash',
    });
    expect(api.noteConversations.generateImage).not.toHaveBeenCalled();
  });
});
