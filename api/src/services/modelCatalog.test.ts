import { describe, it, expect } from 'vitest';
import { extractChatContent, stripThinkBlocks } from './modelCatalog';

const SYSTEM = [
  'You are helping a learner read one specific document inside a Knowledge Building classroom.',
  'Answer strictly from the document below. If the answer is not in it, say so plainly instead of guessing.',
  'Be concise. Prefer pointing the learner to the passage that matters over summarising everything.',
  'End with one question that could turn this into a public idea their classmates can build on.',
].join('\n\n');

const reply = (message: Record<string, unknown>) => ({ choices: [{ message }] });

describe('stripThinkBlocks', () => {
  it('剥掉成对与未闭合的思考标签', () => {
    expect(stripThinkBlocks('<think>盘算一下</think>答案在这里')).toBe('答案在这里');
    expect(stripThinkBlocks('正文<thinking>后面没有闭合')).toBe('正文');
  });
});

describe('extractChatContent', () => {
  it('有正文就用正文', () => {
    expect(extractChatContent(reply({ content: '核心主张是……' }), SYSTEM)).toBe('核心主张是……');
  });

  it('正文被 think 标签占满时退回 reasoning_content', () => {
    const json = reply({ content: '<think>算了半天</think>', reasoning_content: '这份文档主张 X。' });
    expect(extractChatContent(json, SYSTEM)).toBe('这份文档主张 X。');
  });

  it('推演里复述了系统提示词就当作没有答案，不呈给学生', () => {
    const json = reply({
      content: '',
      reasoning_content: '指示说："Be concise. Prefer pointing the learner to the passage that matters over summarising everything." 但这里没有段落可指向。所以回答应该……',
    });
    expect(extractChatContent(json, SYSTEM)).toBeNull();
  });

  it('没传系统提示词时保持原有兜底行为，不误伤既有调用方', () => {
    const json = reply({ content: '', reasoning_content: '推理模型把正文放在这里。' });
    expect(extractChatContent(json)).toBe('推理模型把正文放在这里。');
  });

  it('提示词太短不足以判别时不做判定', () => {
    const json = reply({ content: '', reasoning_content: 'Be brief. 然后我想……' });
    expect(extractChatContent(json, 'Be brief.')).toBe('Be brief. 然后我想……');
  });

  it('两者皆空返回 null', () => {
    expect(extractChatContent(reply({ content: '', reasoning_content: '  ' }), SYSTEM)).toBeNull();
    expect(extractChatContent({}, SYSTEM)).toBeNull();
  });
});
