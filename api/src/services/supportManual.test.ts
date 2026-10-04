import { describe, expect, it } from 'vitest';
import { MANUAL_SECTIONS } from '../../../components/manual/manualContent';
import {
  buildManualChunks,
  EXCERPT_BUDGET,
  manualDocument,
  manualHints,
  renderManualDataModule,
  selectManualExcerpts,
  splitAnswerSources,
  tokenize,
} from './supportManual';
import { STUDENT_MANUAL } from './supportManualData';

/**
 * 求助的回答以学生版使用手册为依据。后端读不到前端源码，手册以快照形式放在
 * supportManualData.ts；这里负责生成它，也负责发现它过期了。
 */

describe('手册快照', () => {
  it('和 components/manual/manualContent.ts 一致（手册改了就跑 -u 重新生成）', async () => {
    await expect(renderManualDataModule(buildManualChunks(MANUAL_SECTIONS)))
      .toMatchFileSnapshot('./supportManualData.ts');
  });

  it('只收学生能看到的章节，教师端一个字都不进', () => {
    const teacherNums = MANUAL_SECTIONS.filter(s => s.teacherOnly).map(s => s.num);
    const studentNums = MANUAL_SECTIONS.filter(s => !s.teacherOnly).map(s => s.num);
    expect(teacherNums.length).toBeGreaterThan(0);
    const inSnapshot = new Set(STUDENT_MANUAL.map(c => c.num));
    for (const num of teacherNums) expect(inSnapshot.has(num)).toBe(false);
    for (const num of studentNums) expect(inSnapshot.has(num)).toBe(true);
  });

  it('常见问题每一问单独成段，问题就是小标题', () => {
    const faq = MANUAL_SECTIONS.find(s => s.id === 'faq')!;
    const items = faq.blocks.flatMap(b => (b.kind === 'faq' ? b.items : []));
    const chunks = STUDENT_MANUAL.filter(c => c.num === faq.num);
    expect(chunks).toHaveLength(items.length);
    expect(chunks.map(c => c.heading?.zh)).toEqual(items.map(i => i.q.zh));
  });

  it('纯文本里不留 ** 和 ` 这类标记', () => {
    for (const c of STUDENT_MANUAL) {
      expect(c.text.zh).not.toMatch(/\*\*|`/);
      expect(c.text.en).not.toMatch(/\*\*|`/);
    }
  });
});

describe('切词', () => {
  it('中文切成相邻两字，问句里的虚词不算', () => {
    const tokens = tokenize('怎么保存笔记');
    expect(tokens).toEqual(expect.arrayContaining(['保存', '存笔', '笔记']));
    expect(tokens).not.toContain('怎么');
  });

  it('英文去掉常用词，词形变化落到同一个词上', () => {
    expect(tokenize('How do I contribute?')).toEqual(tokenize('contributing'));
    expect(tokenize('the notes')).toEqual(tokenize('note'));
    expect(tokenize('the notes')).toHaveLength(1);
  });
});

describe('整本手册进提示词', () => {
  it('每一段都在，按章节和小标题排好', () => {
    const doc = manualDocument('zh');
    for (const c of STUDENT_MANUAL) {
      expect(doc).toContain(c.text.zh);
      if (c.heading) expect(doc).toContain(`### ${c.heading.zh}`);
    }
    expect(doc.startsWith(`## ${STUDENT_MANUAL[0].num} ${STUDENT_MANUAL[0].section.zh}`)).toBe(true);
  });

  it('大小放得进快速档模型的上下文（中文不超过两万字）', () => {
    expect(manualDocument('zh').length).toBeLessThan(20_000);
    expect(manualDocument('en').length).toBeLessThan(55_000);
  });

  it('没有教师端的内容', () => {
    expect(manualDocument('zh')).not.toMatch(/^## 14 /m);
  });
});

describe('按问题挑手册段落（作为提示）', () => {
  const top = (q: string, lang: 'zh' | 'en' = 'zh') => selectManualExcerpts(q, lang)[0];

  it('找贡献按钮 → 04 写一条笔记', () => {
    expect(top('贡献按钮在哪')?.num).toBe('04');
  });

  it('关掉笔记后内容没了 → 常见问题「写的笔记不见了」', () => {
    expect(top('写完的笔记怎么保存？关掉以后内容没了')?.heading).toBe('写的笔记不见了');
  });

  it('接着同学的笔记写 → 05 Build-on', () => {
    expect(top('怎么在同学的笔记上 Build-on？')?.num).toBe('05');
  });

  it('常见问题按原问法也能命中', () => {
    const hit = top('支架插错了怎么去掉');
    expect(['04', '15']).toContain(hit?.num);
    expect(selectManualExcerpts('密码忘了怎么办', 'zh').some(e => e.heading === '密码忘了怎么办')).toBe(true);
  });

  it('英文提问用英文手册', () => {
    const hit = top("How do I build on a classmate's note?", 'en');
    expect(hit?.num).toBe('05');
    expect(hit?.text).toMatch(/Build on/i);
  });

  it('和平台无关的问题挑不出段落', () => {
    expect(selectManualExcerpts('明天会下雨吗', 'zh')).toEqual([]);
    expect(selectManualExcerpts('？？？', 'zh')).toEqual([]);
  });

  it('挑出来的段落总长不超过预算，第一段除外', () => {
    for (const q of ['AI 反馈', '画布上的笔记怎么移动', '综合升华讨论室怎么发布']) {
      const picked = selectManualExcerpts(q, 'zh');
      expect(picked.length).toBeGreaterThan(0);
      expect(picked.length).toBeLessThanOrEqual(5);
      const rest = picked.slice(1).reduce((n, e) => n + e.text.length, 0);
      expect(picked[0].text.length + rest).toBeLessThanOrEqual(EXCERPT_BUDGET.zh + picked[0].text.length);
    }
  });

  it('提示最多给三处', () => {
    expect(manualHints('AI 反馈', 'zh').length).toBeLessThanOrEqual(3);
    expect(manualHints('明天会下雨吗', 'zh')).toEqual([]);
  });
});

describe('模型回答末尾的来源行', () => {
  it('取出章节号，并从回答里去掉', () => {
    const out = splitAnswerSources('1. 点右下角「贡献」。\n2. 再关掉笔记页。\nSOURCES: 04, 15');
    expect(out.answer).toBe('1. 点右下角「贡献」。\n2. 再关掉笔记页。');
    expect(out.sections).toEqual(['04', '15']);
    expect(out.covered).toBe(true);
  });

  it('NONE 表示手册没写到', () => {
    const out = splitAnswerSources('手册里没有写到这个问题，可以点下面的「转给老师」。\nSOURCES: NONE');
    expect(out.covered).toBe(false);
    expect(out.sections).toEqual([]);
    expect(out.answer).not.toMatch(/SOURCES/);
  });

  it('只认学生手册里真有的章节，编号补足两位', () => {
    const out = splitAnswerSources('……\n**SOURCES:** 4, 14, 99, Q2');
    expect(out.sections).toEqual(['04']);
    expect(out.precedents).toEqual([2]);
    expect(out.covered).toBe(true);
  });

  it('模型没写来源行，回答原样保留，covered 为 null', () => {
    const out = splitAnswerSources('点右下角「贡献」。');
    expect(out).toEqual({ answer: '点右下角「贡献」。', sections: [], precedents: [], covered: null });
  });

  it('回答里正常的「来源：……」句子不会被当成标记删掉', () => {
    const text = '引用到笔记的内容下面会注明来源：引自《文件名》';
    expect(splitAnswerSources(text).answer).toBe(text);
  });

  it('来源行后面又补了一句，照样把来源行去掉，补的那句留着', () => {
    const out = splitAnswerSources('点右下角「贡献」。\nSOURCES: 04\n\n还有问题可以再问我。');
    expect(out.answer).toBe('点右下角「贡献」。\n\n还有问题可以再问我。');
    expect(out.sections).toEqual(['04']);
  });

  it('模型把关键词写成中文「来源」、后面只有编号时也认', () => {
    const out = splitAnswerSources('点「建立于此」。\n来源：05');
    expect(out.answer).toBe('点「建立于此」。');
    expect(out.sections).toEqual(['05']);
  });
});
