/**
 * 按姓名首字母排（2026-10-10 用户：分组时学生按名字首字母排列，好分组）。
 *
 * 中文按拼音（Intl.Collator 的 zh 排序，浏览器和 Node 都是 ICU 的拼音规则），英文按字母，
 * 先按首字母分段，段内再按拼音排。ICU 只认常用读音，多音的姓会分错段（曾 céng、解 jiě、单 dān……），
 * 所以常见的多音姓按姓氏读音单列：曾 Zeng、解 Xie、单 Shan、仇 Qiu、区 Ou、查 Zha……
 */

const collator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base', numeric: true });
const LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ';
/** 拼音排序里每个声母打头的第一个字（I、U、V 没有字打头） */
const BOUNDS = '阿八嚓哒妸发旮哈讥咔垃妈拏噢妑七呥仨他屲夕丫帀';
const SURNAME_INITIAL: Record<string, string> = {
  曾: 'Z', 解: 'X', 单: 'S', 仇: 'Q', 区: 'O', 查: 'Z', 朴: 'P', 覃: 'Q', 种: 'C', 谌: 'C',
  繁: 'P', 秘: 'B', 翟: 'Z', 员: 'Y', 句: 'G', 召: 'S', 祭: 'Z',
};

/** 姓名的首字母（A–Z）；数字、符号或空名字归到 # */
export function nameInitial(name: string): string {
  const ch = name.trim().charAt(0);
  if (!ch) return '#';
  if (/[a-z]/i.test(ch)) return ch.toUpperCase();
  if (SURNAME_INITIAL[ch]) return SURNAME_INITIAL[ch];
  if (!/[㐀-鿿]/.test(ch)) return '#';
  let letter = '#';
  for (let i = 0; i < BOUNDS.length; i++) {
    if (collator.compare(ch, BOUNDS[i]) >= 0) letter = LETTERS[i];
  }
  return letter;
}

export function compareNames(a: string, b: string): number {
  const ia = nameInitial(a);
  const ib = nameInitial(b);
  if (ia !== ib) {
    if (ia === '#') return 1;
    if (ib === '#') return -1;
    return ia < ib ? -1 : 1;
  }
  return collator.compare(a.trim(), b.trim());
}

export function sortByName<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((x, y) => compareNames(nameOf(x), nameOf(y)));
}
