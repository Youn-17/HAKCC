import { describe, expect, it } from 'vitest';
import { compareNames, nameInitial, sortByName } from './nameOrder';

/**
 * 分组名单按姓名首字母排（2026-10-10）：中文按拼音，多音的姓按姓氏读音，英文按字母，其他放最后。
 */

describe('姓名首字母', () => {
  it('常见的姓按拼音取首字母', () => {
    expect(['蔡文涵', '何烨', '黄嘉杰', '蒋子康', '吕子芳', '秦志劼', '丘越', '王文琪', '肖穗雨', '羊思贤', '钟佳丞', '欧阳修'].map(nameInitial))
      .toEqual(['C', 'H', 'H', 'J', 'L', 'Q', 'Q', 'W', 'X', 'Y', 'Z', 'O']);
  });

  it('多音的姓按姓氏读音：曾 Zeng、解 Xie、单 Shan、仇 Qiu、区 Ou、查 Zha', () => {
    expect(['曾涛', '解震楠', '单田芳', '仇英', '区家麟', '查良镛'].map(nameInitial)).toEqual(['Z', 'X', 'S', 'Q', 'O', 'Z']);
  });

  it('英文名按字母（大小写不分）；数字、符号、空名字归到 #', () => {
    expect(['Zhenhai', 'oliver Chen', '3号', '', ' '].map(nameInitial)).toEqual(['Z', 'O', '#', '#', '#']);
  });
});

describe('排序', () => {
  it('先按首字母分段，段内按拼音；曾 排在 Z 段，解 排在 X 段；# 放最后', () => {
    const names = ['曾涛', '张子尧', '蔡文涵', '解震楠', '肖穗雨', '3号', '陈厚迪', 'Zhenhai', '阿明', '吴瑞涵'];
    const sorted = sortByName(names, n => n);
    expect(sorted[0]).toBe('阿明');
    expect(sorted.at(-1)).toBe('3号');
    expect(sorted.indexOf('蔡文涵')).toBeLessThan(sorted.indexOf('陈厚迪'));
    expect(sorted.indexOf('吴瑞涵')).toBeLessThan(sorted.indexOf('解震楠'));
    expect(sorted.indexOf('解震楠')).toBeLessThan(sorted.indexOf('曾涛'));
    expect(sorted.slice(sorted.indexOf('曾涛')).every(n => ['Z', '#'].includes(nameInitial(n)))).toBe(true);
    expect(compareNames('Chen Yuhan', '陈语涵')).not.toBe(0);
  });
});
