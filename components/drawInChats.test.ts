// @vitest-environment jsdom
/**
 * 「画一张……」在文档 AI 侧栏和对话式笔记里也管用（2026-09-29 用户要求：任何 AI 对话界面都能画）。
 * 挂真组件，只把接口换成假的：
 *   - 识别到绘图指令就直接出图，不走对话模型；等图的时候放绘图动画；
 *   - 其余的话照常走对话模型；
 *   - 画不成，把原因告诉学生，刚才那句话放回输入框。
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
    ai: { listConfigs: vi.fn(), chat: vi.fn(), image: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
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
    await mountPanel();

    await say('画一只在月球上看书的猫');
    expect(api.ai.image).toHaveBeenCalledWith({ course_id: 'course-1', prompt: '画一只在月球上看书的猫', feature: 'doc_ai' });
    expect(api.ai.chat).not.toHaveBeenCalled();
    const progress = await waitFor(() => host.querySelector(PROGRESS), '绘图动画');
    expect(progress.textContent).toContain('读懂你的描述');
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
    expect(api.ai.chat).toHaveBeenCalledWith(expect.objectContaining({ course_id: 'course-1', feature: 'doc_ai' }));
    expect(host.querySelector(PROGRESS)).toBeNull();
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
    expect(api.noteConversations.generateImage).toHaveBeenCalledWith('thread-1', { prompt: '画一张同学们围坐讨论的插画' });
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
