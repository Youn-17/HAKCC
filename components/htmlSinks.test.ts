import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 把字符串当 HTML 写进页面的地方，一律先消毒。
 *
 * 笔记正文是作者存的原始 HTML，后端原样入库。编辑器载入、质性编码取文字、
 * 手机端列表预览三处都直接 innerHTML 过，别人打开时就执行了作者写进去的
 * <img onerror>（2026-09 修复）。同一类错出现了三次，所以用测试挡：
 * 新的写入点要么在同一处过 DOMPurify.sanitize，要么登记在下面并写明为什么安全。
 */
const ROOT = resolve(__dirname, '..');
const DIRS = ['components', 'hooks', 'services', 'contexts', 'pages', 'src', 'utils', 'lib'];
const ROOT_FILES = ['App.tsx', 'index.tsx'];
const SINK = /\.(?:innerHTML|outerHTML)\s*=(?!=)|dangerouslySetInnerHTML|insertAdjacentHTML\s*\(|createContextualFragment\s*\(|document\.write(?:ln)?\s*\(|execCommand\(\s*['"]insertHTML/;
const SANITIZED = /DOMPurify\.sanitize\(/;

const ALLOWED: { file: string; snippet: string; why: string }[] = [
  { file: 'components/noteText.ts', snippet: 'div.innerHTML = html', why: '解析在没有浏览上下文的文档里，不加载资源、不跑处理器' },
  { file: 'components/NoteEditorModal.tsx', snippet: 'tpl.innerHTML = scaffoldMarkerHtml(', why: 'template 内容是惰性的，scaffoldMarkerHtml 已转义' },
  { file: 'components/NoteEditorModal.tsx', snippet: 'input.innerHTML = bodyHtml', why: '回写编辑器里已有（载入时已消毒）的内容' },
  { file: 'components/NoteEditorModal.tsx', snippet: 'pEl.innerHTML = beforeHtml', why: '同上' },
  { file: 'components/NoteEditorModal.tsx', snippet: 'pEl.innerHTML = afterHtml', why: '同上' },
  { file: 'components/FileViewerPage.tsx', snippet: '{ __html: docHtml }', why: 'docHtml = DOMPurify 输出再加标题 id' },
  { file: 'components/DocAiPanel.tsx', snippet: '{ __html: html }', why: 'html 在上面的 useMemo 里过了 DOMPurify' },
];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(path);
      }
    }
  };
  DIRS.map(d => join(ROOT, d)).filter(existsSync).forEach(walk);
  ROOT_FILES.map(f => join(ROOT, f)).filter(existsSync).forEach(f => out.push(f));
  return out;
}

function sinks() {
  return sourceFiles().flatMap(path => {
    const file = relative(ROOT, path).split('\\').join('/');
    const lines = readFileSync(path, 'utf-8').split('\n');
    return lines.flatMap((line, i) => {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || !SINK.test(line)) return [];
      // JSX 的 dangerouslySetInnerHTML={{ 常把 __html 换到下一行，只有这种写法连着看三行
      const multiline = line.includes('dangerouslySetInnerHTML') && !line.includes('__html');
      const context = multiline ? lines.slice(i, i + 3).join('\n') : line;
      return [{ file, line: i + 1, code, context }];
    });
  });
}

describe('HTML 写入点', () => {
  it('每一处都消毒过，或者登记过为什么安全', () => {
    const unsafe = sinks()
      .filter(s => !SANITIZED.test(s.context))
      .filter(s => !ALLOWED.some(a => a.file === s.file && s.context.includes(a.snippet)))
      .map(s => `${s.file}:${s.line}  ${s.code}`);
    expect(unsafe).toEqual([]);
  });

  it('名单里没有过期条目', () => {
    const found = sinks();
    const stale = ALLOWED
      .filter(a => !found.some(s => s.file === a.file && s.context.includes(a.snippet)))
      .map(a => `${a.file}  ${a.snippet}`);
    expect(stale).toEqual([]);
  });

  it('编辑器载入正文这一处必须消毒', () => {
    const load = sinks().filter(s => s.file === 'components/NoteEditorModal.tsx' && s.code.startsWith('editorRef.current.innerHTML'));
    expect(load).toHaveLength(1);
    expect(load[0].code).toMatch(SANITIZED);
  });

  it('对话式笔记里的 AI 回复先转义再进编辑器', () => {
    const src = readFileSync(join(ROOT, 'components/Workspace.tsx'), 'utf-8');
    const start = src.indexOf('<AiDialogueNote');
    const end = src.indexOf('/>', src.indexOf('onPublishAsNote=', start));
    const handlers = src.slice(start, end);
    expect(handlers.match(/plainTextToNoteHtml\(text\)/g)).toHaveLength(2);
    expect(handlers).not.toMatch(/\$\{text\}/);
  });
});
