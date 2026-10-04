import { describe, expect, it } from 'vitest';
import { MANUAL_SECTIONS, MANUAL_INTRO, MANUAL_FOOTER, type Block } from './manualContent';
import { DEMOS } from './ManualDemos';

const allBlocks = (): Block[] => [
  ...MANUAL_INTRO,
  ...MANUAL_SECTIONS.flatMap(s => s.blocks),
];

describe('手册结构', () => {
  it('章节编号连续且不重复', () => {
    const nums = MANUAL_SECTIONS.map(s => Number(s.num));
    expect(new Set(nums).size).toBe(nums.length);
    nums.forEach((n, i) => expect(n).toBe(i + 1));
  });

  it('锚点 id 不重复 —— 重复会让目录跳错地方', () => {
    const ids = MANUAL_SECTIONS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('只有一节是教师专属', () => {
    expect(MANUAL_SECTIONS.filter(s => s.teacherOnly)).toHaveLength(1);
  });

  it('学生看到的版本不含任何教师专属内容', () => {
    const studentSections = MANUAL_SECTIONS.filter(s => !s.teacherOnly);
    expect(studentSections.some(s => s.teacherOnly)).toBe(false);
    expect(studentSections.length).toBe(MANUAL_SECTIONS.length - 1);
  });
});

describe('双语完整性', () => {
  it('每个章节标题中英都有', () => {
    for (const s of MANUAL_SECTIONS) {
      expect(s.title.zh.trim()).not.toBe('');
      expect(s.title.en.trim()).not.toBe('');
    }
  });

  it('段落、步骤、列表的中英都不为空', () => {
    for (const b of allBlocks()) {
      if (b.kind === 'p' || b.kind === 'h3') {
        expect(b.zh.trim()).not.toBe('');
        expect(b.en.trim()).not.toBe('');
      }
      if (b.kind === 'steps' || b.kind === 'list') {
        expect(b.zh.length).toBeGreaterThan(0);
        // 条数必须一致，否则切到英文会少看内容
        expect(b.en.length).toBe(b.zh.length);
      }
    }
  });

  it('表格每行的单元格数和表头一致 —— 对不上会错位', () => {
    for (const b of allBlocks()) {
      if (b.kind !== 'table') continue;
      for (const row of b.rows) expect(row.length).toBe(b.head.length);
    }
  });

  it('提示框中英条数一致', () => {
    for (const b of allBlocks()) {
      if (b.kind === 'callout') expect(b.en.length).toBe(b.zh.length);
    }
  });

  it('常见问题的每一条中英答案条数一致', () => {
    for (const b of allBlocks()) {
      if (b.kind !== 'faq') continue;
      for (const item of b.items) {
        expect(item.q.zh.trim()).not.toBe('');
        expect(item.q.en.trim()).not.toBe('');
        expect(item.a.en.length).toBe(item.a.zh.length);
      }
    }
  });

  it('页脚双语齐全', () => {
    expect(MANUAL_FOOTER.zh.trim()).not.toBe('');
    expect(MANUAL_FOOTER.en.trim()).not.toBe('');
  });
});

describe('图与演示', () => {
  it('每张截图都指向 /manual/ 下的文件', () => {
    const figures = allBlocks().filter((b): b is Extract<Block, { kind: 'figure' }> => b.kind === 'figure');
    expect(figures.length).toBeGreaterThan(10);
    for (const f of figures) expect(f.src).toMatch(/^\/manual\/[\w.-]+$/);
  });

  it('截图不重复引用同一个文件', () => {
    const srcs = allBlocks()
      .filter((b): b is Extract<Block, { kind: 'figure' }> => b.kind === 'figure')
      .map(f => f.src);
    expect(new Set(srcs).size).toBe(srcs.length);
  });

  it('每张图都有中英文说明 —— 说明同时当 alt 文本用', () => {
    for (const b of allBlocks()) {
      if (b.kind === 'figure' || b.kind === 'demo') {
        expect(b.cap.zh.trim()).not.toBe('');
        expect(b.cap.en.trim()).not.toBe('');
      }
    }
  });

  it('录屏都指向 /manual/ 下、且不带扩展名 —— 渲染器自己拼 .webm / .mp4', () => {
    const clips = allBlocks().filter((b): b is Extract<Block, { kind: 'clip' }> => b.kind === 'clip');
    expect(clips.length).toBeGreaterThan(0);
    for (const c of clips) {
      expect(c.src).toMatch(/^\/manual\/[\w-]+$/);
    }
  });

  it('录屏不重复引用同一段', () => {
    const srcs = allBlocks()
      .filter((b): b is Extract<Block, { kind: 'clip' }> => b.kind === 'clip')
      .map(c => c.src);
    expect(new Set(srcs).size).toBe(srcs.length);
  });

  it('每段录屏的 webm / mp4 / 海报三个文件都在', () => {
    // 直接查文件，不信约定：少一个 mp4 只会让 Safari 那边静默不播，
    // 页面看着正常，问题不会自己暴露。
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    for (const b of allBlocks()) {
      if (b.kind !== 'clip') continue;
      for (const f of [`public${b.src}.webm`, `public${b.src}.mp4`, `public${b.src}.jpg`]) {
        expect(existsSync(f), `missing ${f}`).toBe(true);
      }
    }
  });

  it('录屏也有中英文说明 —— 同时当 aria-label 用', () => {
    for (const b of allBlocks()) {
      if (b.kind !== 'clip') continue;
      expect(b.cap.zh.trim()).not.toBe('');
      expect(b.cap.en.trim()).not.toBe('');
    }
  });

  it('引用到的演示都真的存在', () => {
    for (const b of allBlocks()) {
      if (b.kind === 'demo') expect(DEMOS[b.id]).toBeTypeOf('function');
    }
  });

  it('写好的演示都被用上了，没有留下死代码', () => {
    const used = new Set(allBlocks().filter(b => b.kind === 'demo').map(b => (b as { id: string }).id));
    for (const id of Object.keys(DEMOS)) expect(used.has(id)).toBe(true);
  });
});

describe('行内标记', () => {
  it('加粗标记成对出现', () => {
    const texts: string[] = [];
    for (const b of allBlocks()) {
      if (b.kind === 'p' || b.kind === 'h3') texts.push(b.zh, b.en);
      if (b.kind === 'steps' || b.kind === 'list') texts.push(...b.zh, ...b.en);
      if (b.kind === 'callout') texts.push(...b.zh, ...b.en);
    }
    for (const s of texts) {
      expect((s.match(/\*\*/g) ?? []).length % 2, `unbalanced ** in: ${s.slice(0, 50)}`).toBe(0);
    }
  });

  it('正文里不含 HTML 标签 —— 渲染器不走 dangerouslySetInnerHTML', () => {
    for (const b of allBlocks()) {
      if (b.kind !== 'p') continue;
      expect(b.zh).not.toMatch(/<[a-z/]/i);
      expect(b.en).not.toMatch(/<[a-z/]/i);
    }
  });
});
