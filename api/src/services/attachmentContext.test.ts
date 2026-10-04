import { describe, expect, it } from 'vitest';

type Attachment = { file_url: string; file_name: string; mime_type?: string; text?: string };

/**
 * 附件正文的去向：**只喂模型，不入库**。
 *
 * 之前它被拼进消息 content 存了下来，后果有两层：一份四万字的 PDF 在
 * 对话框里整篇铺开；研究导出的 messages 里 content_text 和 word_count
 * 把它算成了学生写的字。后者不会报错，只会让数据悄悄失真。
 *
 * 这里复刻 noteConversations.ts 里的两个函数并锁住行为。
 */
function stripAttachmentText(list: Attachment[]): Attachment[] {
  return list.map(({ text: _text, ...rest }) => rest);
}

function appendAttachmentContext<T extends { role: string; content?: string | null }>(
  history: T[], list: Attachment[],
): T[] {
  const docs = list.filter(a => !a.mime_type?.startsWith('image/'));
  if (docs.length === 0) return history;
  const note = docs.map(a => (a.text?.trim()
    ? `\n\n[附件 ${a.file_name} 的内容]\n${a.text}`
    : `\n\n[学生附上了文件 ${a.file_name}，但它的文字内容抽不出来（可能是扫描版 PDF、加密文档或纯图片文件）。你只知道文件名，需要时请直接说明，不要猜测内容。]`))
    .join('');
  const lastUser = history.map(m => m.role).lastIndexOf('user');
  if (lastUser < 0) return history;
  const next = [...history];
  next[lastUser] = { ...next[lastUser], content: (next[lastUser].content ?? '') + note };
  return next;
}

const doc = (name: string, text?: string): Attachment =>
  ({ file_url: `https://x/${name}`, file_name: name, mime_type: 'application/pdf', text });
const img = (): Attachment =>
  ({ file_url: 'https://x/a.png', file_name: 'a.png', mime_type: 'image/png' });

describe('落库前剥掉附件正文', () => {
  it('正文不进库，文件信息保留', () => {
    const stored = stripAttachmentText([doc('paper.pdf', '一万字正文…')]);
    expect(stored[0]).toEqual({ file_url: 'https://x/paper.pdf', file_name: 'paper.pdf', mime_type: 'application/pdf' });
    expect('text' in stored[0]).toBe(false);
  });

  it('没有正文的附件原样保留', () => {
    expect(stripAttachmentText([img()])[0].file_name).toBe('a.png');
  });
});

describe('喂给模型时才接上正文', () => {
  const history = [
    { role: 'user', content: '第一问' },
    { role: 'assistant', content: '回答' },
    { role: 'user', content: '这份材料讲了什么？' },
  ];

  it('正文接在最后一条学生消息上，历史不动', () => {
    const out = appendAttachmentContext(history, [doc('paper.pdf', '知识建构的十二条原则')]);
    expect(out[0].content).toBe('第一问');
    expect(out[1].content).toBe('回答');
    expect(out[2].content).toContain('这份材料讲了什么？');
    expect(out[2].content).toContain('知识建构的十二条原则');
  });

  // 图片走视觉模型，不需要也不应该在文字里描述
  it('图片附件不产生任何文字说明', () => {
    expect(appendAttachmentContext(history, [img()])).toBe(history);
    expect(appendAttachmentContext(history, [])).toBe(history);
  });

  // 扫描版 PDF 抽不出字。含糊其辞会让 AI 装作读过了
  it('抽不出正文时明确告诉模型「你读不到」', () => {
    const out = appendAttachmentContext(history, [doc('scan.pdf')]);
    expect(out[2].content).toContain('抽不出来');
    expect(out[2].content).toContain('不要猜测内容');
  });

  it('多个附件依次接上', () => {
    const out = appendAttachmentContext(history, [doc('a.pdf', 'AAA'), doc('b.pdf', 'BBB')]);
    expect(out[2].content).toContain('AAA');
    expect(out[2].content).toContain('BBB');
  });
});
