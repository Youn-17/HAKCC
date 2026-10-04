import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 函数体顶层的提前 return 之后不能再有钩子：开和关两种状态下钩子个数不一样，生产上就是 React #310 白屏。
 * NoteEditorModal 同一天犯过两次（有单独的 noteEditorHooks.test.ts）；FileViewerPage 的
 * `if (!isOpen) return null;` 后面也跟过四个 useCallback 和一个 useMemo，只是 Workspace 碰巧
 * 只在打开时挂载它才没炸。靠记忆挡不住这类错，所以把全部组件和 hooks 都扫一遍。
 *
 * 规则：函数体第一层（两格缩进）的 `if (...) return` 之后、这个函数收尾的 `}` / `};` 之前，
 * 不能出现 use 开头接大写字母的调用。
 */
const ROOT = resolve(__dirname, '..');
const HOOK_CALL = /(^|[^.\w])use[A-Z]\w*\(/;
const EARLY_RETURN = /^ {2}if \(.*\) return\b/;
const FUNCTION_END = /^};?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function lateHooks(src: string): string[] {
  const lines = src.split('\n');
  const found: string[] = [];
  lines.forEach((line, i) => {
    if (!EARLY_RETURN.test(line)) return;
    const end = lines.findIndex((l, j) => j > i && FUNCTION_END.test(l));
    for (let j = i + 1; j < (end < 0 ? lines.length : end); j++) {
      const text = lines[j].trim();
      if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) continue;
      if (HOOK_CALL.test(lines[j])) found.push(`${i + 1} 的提前 return 之后，${j + 1}: ${text}`);
    }
  });
  return found;
}

describe('钩子不能写在提前 return 之后', () => {
  it('扫描器本身认得出这种错', () => {
    const bad = [
      'const Modal = ({ isOpen }) => {',
      '  const [a, setA] = useState(0);',
      '  if (!isOpen) return null;',
      '  const b = useMemo(() => a + 1, [a]);',
      '  return b;',
      '};',
      'const Next = () => {',
      '  const c = useRef(null);',
      '  return c;',
      '};',
    ].join('\n');
    expect(lateHooks(bad)).toEqual(['3 的提前 return 之后，4: const b = useMemo(() => a + 1, [a]);']);
  });

  it('components/ 和 hooks/ 下的每个文件', () => {
    const offenders = [...sourceFiles(join(ROOT, 'components')), ...sourceFiles(join(ROOT, 'hooks'))]
      .flatMap(path => lateHooks(readFileSync(path, 'utf-8')).map(hit => `${relative(ROOT, path)}：${hit}`));
    expect(offenders).toEqual([]);
  });
});
