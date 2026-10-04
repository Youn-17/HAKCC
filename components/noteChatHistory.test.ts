import { describe, expect, it } from 'vitest';
import type { NoteConversationThread } from '../services/apiClient';
import {
  formatThreadTime,
  nextThreadAfterDelete,
  previewOf,
  visibleHistoryThreads,
  withFirstQuestion,
  withThreadFirst,
} from './noteChatHistory';

/**
 * 笔记 AI 助手「历史对话」的纯逻辑：列哪些、删了以后选谁、列表里怎么认出是哪一段、时间怎么写。
 */

const NOTE = 'note-1';
const thread = (id: string, extra: Partial<NoteConversationThread> = {}): NoteConversationThread => ({
  id, noteId: NOTE, spaceId: 's', courseId: 'c', targetType: 'ai', createdBy: 'me',
  createdAt: '2026-09-29T08:00:00.000Z', updatedAt: '2026-09-29T08:00:00.000Z', participants: [],
  preview: `问题 ${id}`, ...extra,
});
const none = new Set<string>();

describe('previewOf', () => {
  it('压成一行、去掉首尾空白，最多 80 字', () => {
    expect(previewOf('  检索练习\n\n为什么   有效？ ')).toBe('检索练习 为什么 有效？');
    expect(previewOf('问'.repeat(200))).toBe('问'.repeat(80));
    expect(previewOf('   \n ')).toBe('');
  });
});

describe('visibleHistoryThreads', () => {
  it('只列这条笔记上的 AI 对话；别的笔记、同学私聊、群聊都不列', () => {
    const list = [
      thread('a'),
      thread('other-note', { noteId: 'note-2' }),
      thread('group', { targetType: 'group' }),
      thread('member', { targetType: 'member' }),
    ];
    expect(visibleHistoryThreads(list, { noteId: NOTE, deletedIds: none }).map(t => t.id)).toEqual(['a']);
  });

  it('同一条线程出现两次只列一次（新建时本地插入，随后列表又带回来）', () => {
    expect(visibleHistoryThreads([thread('a'), thread('b'), thread('a')], { noteId: NOTE, deletedIds: none }).map(t => t.id)).toEqual(['a', 'b']);
  });

  it('这次编辑里删掉的不列，哪怕晚到的列表又把它带回来', () => {
    expect(visibleHistoryThreads([thread('a'), thread('b')], { noteId: NOTE, deletedIds: new Set(['a']) }).map(t => t.id)).toEqual(['b']);
  });

  it('还没问过话的空白对话（preview 为 null）不列，眼前正开着的那段除外', () => {
    const list = [thread('blank', { preview: null }), thread('asked')];
    expect(visibleHistoryThreads(list, { noteId: NOTE, deletedIds: none }).map(t => t.id)).toEqual(['asked']);
    expect(visibleHistoryThreads(list, { noteId: NOTE, selectedId: 'blank', deletedIds: none }).map(t => t.id)).toEqual(['blank', 'asked']);
  });

  it('本地刚建、还不知道有没有内容的（preview 未定义）按有内容算', () => {
    expect(visibleHistoryThreads([thread('fresh', { preview: undefined })], { noteId: NOTE, deletedIds: none })).toHaveLength(1);
  });

  it('顺序照传进来的：服务端已经按最近有动静的排好', () => {
    expect(visibleHistoryThreads([thread('c'), thread('a'), thread('b')], { noteId: NOTE, deletedIds: none }).map(t => t.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('nextThreadAfterDelete', () => {
  it('删掉眼前这段以后接着显示剩下的最近一段（问过话的）', () => {
    const list = [thread('now'), thread('blank', { preview: null }), thread('older')];
    expect(nextThreadAfterDelete(list, 'now', { noteId: NOTE, deletedIds: new Set(['now']) })?.id).toBe('older');
  });

  it('没有剩下的就是 null：回到空白，下一问会开新的', () => {
    expect(nextThreadAfterDelete([thread('only')], 'only', { noteId: NOTE, deletedIds: new Set(['only']) })).toBeNull();
    expect(nextThreadAfterDelete([thread('only'), thread('blank', { preview: null })], 'only', { noteId: NOTE, deletedIds: new Set(['only']) })).toBeNull();
  });
});

describe('withFirstQuestion', () => {
  it('第一次问话：记下这句，列表里从此用它认这段对话', () => {
    const next = withFirstQuestion([thread('a', { preview: null }), thread('b')], 'a', '  帮我看看\n这个想法  ');
    expect(next.find(t => t.id === 'a')!.preview).toBe('帮我看看 这个想法');
  });

  it('已经有第一句的不改；别的线程不动；空话不记', () => {
    const list = [thread('a', { preview: '原来的第一句' }), thread('b', { preview: null })];
    expect(withFirstQuestion(list, 'a', '新的问题').find(t => t.id === 'a')!.preview).toBe('原来的第一句');
    expect(withFirstQuestion(list, 'a', '新的问题').find(t => t.id === 'b')!.preview).toBeNull();
    expect(withFirstQuestion(list, 'b', '   ').find(t => t.id === 'b')!.preview).toBeNull();
  });
});

describe('withThreadFirst', () => {
  it('新建的放最前面；后端复用了已有的，就把它挪到最前面，不重复', () => {
    expect(withThreadFirst([thread('a'), thread('b')], thread('c')).map(t => t.id)).toEqual(['c', 'a', 'b']);
    expect(withThreadFirst([thread('a'), thread('b')], thread('b')).map(t => t.id)).toEqual(['b', 'a']);
  });
});

describe('formatThreadTime', () => {
  const now = new Date('2026-09-29T15:00:00');
  it('今天的只写钟点', () => {
    expect(formatThreadTime('2026-09-29T09:05:00', 'zh', now)).toBe('今天 09:05');
    expect(formatThreadTime('2026-09-29T09:05:00', 'en', now)).toBe('Today 09:05');
  });
  it('别的日子写「月/日 钟点」', () => {
    expect(formatThreadTime('2026-09-28T21:30:00', 'zh', now)).toBe('9/28 21:30');
  });
  it('没有时间或时间不对就不写', () => {
    expect(formatThreadTime(undefined, 'zh', now)).toBe('');
    expect(formatThreadTime('not a date', 'zh', now)).toBe('');
  });
});
