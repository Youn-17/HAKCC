import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * index.css 里的 .safe-area-top / .safe-area-bottom 写在 Tailwind 的层外，优先级高过所有工具类。
 * 和同一侧的 p-* / py-* / pt-* / pb-* 写在一起，电脑上 env() 是 0，那一侧的内边距就被清零。
 * 笔记页的顶栏和底栏曾经因此贴边。
 */
const ROOT = resolve(__dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('安全区类不和同侧的内边距写在一起', () => {
  it('components/ 和 App.tsx 里没有这样的 className', () => {
    const offenders: string[] = [];
    for (const file of [...tsxFiles(join(ROOT, 'components')), join(ROOT, 'App.tsx')]) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const classes = (match[1] ?? match[2]).split(/\s+/);
        const has = (re: RegExp) => classes.some(c => re.test(c));
        const clashTop = classes.includes('safe-area-top') && has(/^(p|py|pt)-/);
        const clashBottom = classes.includes('safe-area-bottom') && has(/^(p|py|pb)-/);
        if (clashTop || clashBottom) offenders.push(`${relative(ROOT, file)}: ${(match[1] ?? match[2]).slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
