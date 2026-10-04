import { describe, expect, it } from 'vitest';
import { detectQuestionLanguage, extractFinalAnswer, languageDirective } from './finalAnswer';

const reply = (message: Record<string, unknown>) => ({ choices: [{ message }] });

describe('提问语言判定', () => {
  it('有汉字就按中文答', () => {
    expect(detectQuestionLanguage('贡献按钮在哪')).toBe('zh');
  });

  it('中英混写仍算中文 —— 学生写「AI 反映速度太慢」问的是中文', () => {
    expect(detectQuestionLanguage('AI 反映速度太慢了怎么办呀')).toBe('zh');
  });

  it('纯英文按英文答', () => {
    expect(detectQuestionLanguage('why is the AI so slow?')).toBe('en');
  });

  it('只有符号数字时落到英文，而不是崩掉', () => {
    expect(detectQuestionLanguage('???  123')).toBe('en');
  });
});

describe('回复语言指令', () => {
  it('中文指令写死简体中文，并禁止开头来一句英文', () => {
    const d = languageDirective('zh');
    expect(d).toContain('简体中文');
    expect(d.toLowerCase()).toContain('do not open with an english sentence');
  });

  it('两种语言都明确禁止展示推理过程', () => {
    expect(languageDirective('zh').toLowerCase()).toContain('do not show your reasoning');
    expect(languageDirective('en').toLowerCase()).toContain('do not show your reasoning');
  });
});

describe('只取正式答案', () => {
  it('正常回答原样返回', () => {
    expect(extractFinalAnswer(reply({ content: '点笔记右上角的贡献按钮。' })))
      .toBe('点笔记右上角的贡献按钮。');
  });

  it('content 为空时返回 null，绝不回退到思维链', () => {
    // 这就是学生看到一整屏英文推理的那个 case
    const json = reply({
      content: '',
      reasoning_content: 'The user is asking in Chinese... I need to answer in Chinese...',
    });
    expect(extractFinalAnswer(json)).toBeNull();
  });

  it('只有空白也算没答上来', () => {
    expect(extractFinalAnswer(reply({ content: '   \n  ' }))).toBeNull();
  });

  it('剥掉 content 里的 <think> 块，只留后面的答案', () => {
    const json = reply({ content: '<think>Let me consider the options.</think>\n点右上角的贡献按钮。' });
    expect(extractFinalAnswer(json)).toBe('点右上角的贡献按钮。');
  });

  it('<think> 被截断没有闭标签时，后面整段都是草稿，一并丢掉', () => {
    const json = reply({ content: '先说结论。\n<think>Hmm, actually the button is' });
    expect(extractFinalAnswer(json)).toBe('先说结论。');
  });

  it('只有思考没有答案时返回 null —— 调用方据此转给教师', () => {
    expect(extractFinalAnswer(reply({ content: '<think>thinking hard</think>' }))).toBeNull();
  });

  it('返回结构不对时返回 null，不抛异常', () => {
    expect(extractFinalAnswer(null)).toBeNull();
    expect(extractFinalAnswer({})).toBeNull();
    expect(extractFinalAnswer({ choices: [] })).toBeNull();
    expect(extractFinalAnswer(reply({ content: 42 }))).toBeNull();
  });
});
