import { describe, expect, it } from 'vitest';
import { keywordsOf, rankPrecedents, PRECEDENT_MIN_SCORE, type PrecedentRow } from './supportPrecedents';

const row = (id: string, question: string, teacher_answer: string | null = null, ai_answer: string | null = null): PrecedentRow =>
  ({ id, question, teacher_answer, ai_answer });

describe('求助语料的关键词切分', () => {
  it('英文按词切，短词（介词冠词）丢掉', () => {
    expect(keywordsOf('how do I build on a note')).toEqual(['how', 'build', 'note']);
  });

  it('中文切成相邻两字，而不是整句一个词', () => {
    // 整句一个 token 的话，「研究数据怎么导出」永远匹配不上「怎么导出研究数据」，
    // 中文求助的复用就等于没有。
    expect(keywordsOf('贡献按钮')).toEqual(['贡献', '献按', '按钮']);
  });

  it('语序不同的同一个问题，关键词高度重合', () => {
    const a = new Set(keywordsOf('研究数据怎么导出'));
    const b = keywordsOf('怎么导出研究数据');
    const shared = b.filter(t => a.has(t));
    expect(shared.length / b.length).toBeGreaterThan(0.6);
  });

  it('重复的两字组只算一次，免得同一个词被加倍计权', () => {
    expect(keywordsOf('导出导出')).toEqual(['导出', '出导']);
  });

  it('纯符号和单字问不出关键词，返回空而不是全表命中', () => {
    expect(keywordsOf('???')).toEqual([]);
    expect(keywordsOf('a b c')).toEqual([]);
  });

  it('大小写归一', () => {
    expect(keywordsOf('Build')).toEqual(['build']);
  });
});

describe('往届问答的匹配', () => {
  it('关键词对不上就不返回，宁可让 AI 自己答', () => {
    const rows = [row('1', '怎么导出研究数据')];
    expect(rankPrecedents(rows, 'how do I upload an image')).toEqual([]);
  });

  it('问同一件事时命中', () => {
    const rows = [
      row('1', '怎么导出研究数据', '在教师端研究页签点数据导出'),
      row('2', '贡献按钮在哪里'),
    ];
    const hit = rankPrecedents(rows, '研究数据怎么导出');
    expect(hit.map(r => r.id)).toEqual(['1']);
  });

  it('问题本身没有关键词时返回空，不能拿一条无关的旧答案去误导学生', () => {
    expect(rankPrecedents([row('1', '怎么导出研究数据')], '?')).toEqual([]);
  });

  it('排除自己那一条 —— 否则 AI 会把学生刚提的问题当成已解决的先例', () => {
    const rows = [row('self', '贡献按钮在哪里', '在笔记右上角')];
    expect(rankPrecedents(rows, '贡献按钮在哪里', { excludeId: 'self' })).toEqual([]);
  });

  it('只匹配问题和教师答案，不匹配 AI 自己的回答', () => {
    // AI 的回答又长又全，什么词都沾得上；让它参与匹配会把区分度抹平。
    const rows = [row('1', '完全无关的问题', null, '贡献 按钮 在 哪里 支架 导出 研究 数据')];
    expect(rankPrecedents(rows, '贡献按钮在哪里')).toEqual([]);
  });

  it('按匹配度排序，最贴近的排前面', () => {
    const rows = [
      row('weak', '导出 无关词甲 无关词乙'),
      row('strong', '导出 研究 数据 怎么弄'),
    ];
    const hit = rankPrecedents(rows, '导出 研究 数据');
    expect(hit[0].id).toBe('strong');
  });

  it('同分时保持传入顺序 —— 调用方靠这一点把本课程的先例排在历届前面', () => {
    const rows = [row('thisCourse', '贡献 按钮'), row('lastYear', '贡献 按钮')];
    expect(rankPrecedents(rows, '贡献 按钮').map(r => r.id)).toEqual(['thisCourse', 'lastYear']);
  });

  it('最多给三条，别把上下文撑爆', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(String(i), '贡献 按钮 在哪'));
    expect(rankPrecedents(rows, '贡献 按钮 在哪')).toHaveLength(3);
  });

  it('阈值卡在三个词命中一个', () => {
    expect(PRECEDENT_MIN_SCORE).toBeCloseTo(0.34, 2);
    // 四个关键词只命中一个 = 0.25，低于阈值，应当落空。
    const rows = [row('1', '导出')];
    expect(rankPrecedents(rows, '导出 支架 贡献 图谱')).toEqual([]);
  });
});
