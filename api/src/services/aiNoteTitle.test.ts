import { describe, it, expect } from 'vitest';
import { cleanFeedbackTitle, deriveAiNoteTitle } from './aiNoteTitle';

const FALLBACK = 'AI 延伸';

describe('deriveAiNoteTitle', () => {
  it('取反馈里的引导性问题作标题', () => {
    const body = '你提到「机器只是在做统计匹配」。那么统计匹配和理解之间还剩下什么区别？可以举一个它一定会失败的例子。';
    expect(deriveAiNoteTitle(body, FALLBACK)).toBe('统计匹配和理解之间还剩下什么区别？');
  });

  it('问题在末尾时同样能取到，而不是取第一句复述', () => {
    const body = '你说图灵测试关注行为表现。判断标准只看输出的话，如何区分装作理解和真的理解？';
    const title = deriveAiNoteTitle(body, FALLBACK);
    expect(title).toContain('如何区分');
    expect(title).not.toContain('你说图灵测试');
  });

  it('没有问句时退回第一个句子', () => {
    const body = '这一条需要一个具体的观察或来源来支撑它的知识主张。补上之后同伴才好接着往下推。';
    expect(deriveAiNoteTitle(body, FALLBACK)).toBe('这一条需要一个具体的观察或来源来支撑它的知识…');
  });

  it('过短的片段当作取不到，用通用标签兜底', () => {
    expect(deriveAiNoteTitle('嗯？', FALLBACK)).toBe(FALLBACK);
    expect(deriveAiNoteTitle('', FALLBACK)).toBe(FALLBACK);
  });

  it('剥掉 HTML 与 markdown 标记', () => {
    const body = '<p>你的<strong>论证</strong>缺一环。**证据从哪里来**，能说清楚吗？</p>';
    const title = deriveAiNoteTitle(body, FALLBACK);
    expect(title).not.toMatch(/[<>*]/);
    expect(title).toContain('证据从哪里来');
  });

  it('西文的小数点和缩写不算句末，不会把第一句切成半截', () => {
    const body = 'Your claim rests on GPT-3.5 behaviour, i.e. a single model generation. Does it still hold for newer ones?';
    expect(deriveAiNoteTitle(body, FALLBACK)).toBe('Does it still hold for newer ones?');
  });

  it('英文按词边界截断，不切断单词', () => {
    const body = 'Consider whether your claim about attention mechanisms still holds for very long contexts and sparse inputs. What evidence would change your mind?';
    const title = deriveAiNoteTitle(body, FALLBACK);
    expect(title).toBe('What evidence would change your mind?');
  });

  it('长句截断后不留半个词，并以省略号收尾', () => {
    const body = 'Your note asserts a strong causal relationship between model scale and emergent reasoning ability without naming a single measurement.';
    const title = deriveAiNoteTitle(body, FALLBACK);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).not.toMatch(/\s…$/);
  });
});

describe('cleanFeedbackTitle：采纳反馈发布的笔记用的标题（模型给的，要洗一遍）', () => {
  it('去掉引号、书名号、「标题：」和句末标点', () => {
    expect(cleanFeedbackTitle('「高阶思维的编码标准」')).toBe('高阶思维的编码标准');
    expect(cleanFeedbackTitle('标题：教师不可替代之处的边界。')).toBe('教师不可替代之处的边界');
    expect(cleanFeedbackTitle('"Evidence for the retrieval claim."')).toBe('Evidence for the retrieval claim');
    expect(cleanFeedbackTitle('  检索练习与间隔 \n ')).toBe('检索练习与间隔');
  });

  it('问句、对着「你」说的不要：放到公共画布上同学看不懂（线上原来的标题就是这样）', () => {
    expect(cleanFeedbackTitle('你认同或质疑其中哪一条？')).toBe('');
    expect(cleanFeedbackTitle('编码时用什么标准区分高低阶')).toBe('编码时用什么标准区分高低阶');
    expect(cleanFeedbackTitle('哪条边界最该坚持?')).toBe('');
    expect(cleanFeedbackTitle('你的论证还缺证据')).toBe('');
    expect(cleanFeedbackTitle('What you could add next')).toBe('');
  });

  it('写缺点的不要：卡片连着学生的笔记、全班都看得到（10-05 试跑出的几条）', () => {
    expect(cleanFeedbackTitle('缺少个人回应与取舍')).toBe('');
    expect(cleanFeedbackTitle('AI代写分类缺乏个人体验')).toBe('');
    expect(cleanFeedbackTitle('高阶思维判断标准的缺失')).toBe('');
    expect(cleanFeedbackTitle('Missing evidence for the claim')).toBe('');
    expect(cleanFeedbackTitle('教师不可替代作用的可争论命题')).toBe('教师不可替代作用的可争论命题');
  });

  it('太短、太长、不是字符串：不要', () => {
    expect(cleanFeedbackTitle('证据')).toBe('');
    expect(cleanFeedbackTitle('这是一个非常非常长的标题已经远远超过了二十二个字的上限了吧')).toBe('');
    expect(cleanFeedbackTitle('Evidence')).toBe('');
    expect(cleanFeedbackTitle(undefined)).toBe('');
    expect(cleanFeedbackTitle(42)).toBe('');
  });
});
