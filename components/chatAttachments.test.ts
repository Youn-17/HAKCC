import { describe, expect, it } from 'vitest';
import { attachmentQuestionHint, restoreTurnAttachments } from './chatAttachments';

describe('挂了附件、还没写问题时的提示', () => {
  it('一份文件、一张图、几个附件各说各的', () => {
    expect(attachmentQuestionHint([{ mime_type: 'application/pdf' }], 'zh')).toBe('想问这份文件什么？写一句再发送');
    expect(attachmentQuestionHint([{ mime_type: 'image/png' }], 'zh')).toBe('想问这张图什么？写一句再发送');
    expect(attachmentQuestionHint([{ mime_type: 'image/png' }, { mime_type: 'application/pdf' }], 'zh')).toBe('想问这些附件什么？写一句再发送');
    expect(attachmentQuestionHint([{ mime_type: 'image/jpeg' }], 'en')).toBe('What do you want to ask about this image? Type a question to send.');
  });
});

describe('出错时把附件放回输入框', () => {
  const a = (n: number) => ({ file_url: `https://files.test/${n}` });

  it('这一轮的排前面，等回答时又挂上的跟在后面；同一个文件只留一份，最多 4 个', () => {
    expect(restoreTurnAttachments([a(1), a(2)], [])).toEqual([a(1), a(2)]);
    expect(restoreTurnAttachments([a(1), a(2)], [a(2), a(3)])).toEqual([a(1), a(2), a(3)]);
    expect(restoreTurnAttachments([a(1), a(2), a(3)], [a(4), a(5)])).toEqual([a(1), a(2), a(3), a(4)]);
    expect(restoreTurnAttachments([], [a(1)])).toEqual([a(1)]);
  });
});
