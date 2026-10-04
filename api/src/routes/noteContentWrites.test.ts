import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 写 notes.content 的地方一律先过 sanitizeNoteHtml。
 *
 * 前端 components/htmlSinks.test.ts 管「把 HTML 放进页面」，这里管「把 HTML 写进库」：
 * 研究导出、以后的新界面、第三方工具拿到的都是库里的原样（2026-09 存储型 XSS 加固）。
 * 同样要求内容分层（segmentNoteContent）用的是消毒后、真正入库的那个值，
 * 否则 content_segments 和库里的正文对不上，研究数据重算不出来。
 *
 * 做法：用 TypeScript 语法树找出所有 .from('notes').insert/update/upsert(...)，
 * 取写进去的 content，顺着变量往回找一层，要求来源里调用了 sanitizeNoteHtml。
 */
const SRC = resolve(__dirname, '..');
const SANITIZER = 'sanitizeNoteHtml(';
const WRITE_METHODS = new Set(['insert', 'update', 'upsert']);

/**
 * 条件写的通用函数（services/noteMetadata.ts）：写哪些列由调用方传进来的回调算出，函数体里那次写看不透。
 * 所以函数体内不查，改为把每个调用方回调返回的对象当成写入内容来查。
 */
const PASS_THROUGH_WRITERS = new Set(['updateNoteGuarded']);

interface ContentWrite {
  where: string;
  problem?: string;
}

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

/** 沿着链式调用往里找 .from('notes')。 */
function targetsNotes(expr: ts.Expression): boolean {
  let e: ts.Expression = expr;
  for (;;) {
    if (ts.isCallExpression(e)) {
      if (ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'from') {
        const table = e.arguments[0];
        return !!table && ts.isStringLiteralLike(table) && table.text === 'notes';
      }
      e = e.expression;
    } else if (ts.isPropertyAccessExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) {
      e = e.expression;
    } else {
      return false;
    }
  }
}

function enclosingScope(node: ts.Node): ts.Node {
  let n: ts.Node | undefined = node.parent;
  while (n && !ts.isFunctionLike(n) && !ts.isSourceFile(n)) n = n.parent;
  return n ?? node.getSourceFile();
}

function descendants(root: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node) => { out.push(n); ts.forEachChild(n, walk); };
  walk(root);
  return out;
}

function isNamed(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

/** 某个变量在作用域里拿到过的所有值：声明时的初始值和之后的每次赋值。 */
function valuesOf(name: string, scope: ts.Node): ts.Expression[] {
  return descendants(scope).flatMap((n) => {
    if (ts.isVariableDeclaration(n) && isNamed(n.name, name) && n.initializer) return [n.initializer];
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && isNamed(n.left, name)) return [n.right];
    return [];
  });
}

/** 值里（或它来自的变量里）调用了 sanitizeNoteHtml。 */
function isSanitized(expr: ts.Expression, scope: ts.Node, seen = new Set<string>()): boolean {
  if (expr.getText().includes(SANITIZER)) return true;
  let e: ts.Expression = expr;
  // safeContent ?? ''、String(x) 这类包装往里看一层
  while (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind)
    && ts.isStringLiteralLike(e.right)) {
    return isSanitized(e.left, scope, seen);
  }
  if (ts.isIdentifier(e) && !seen.has(e.text)) {
    seen.add(e.text);
    const values = valuesOf(e.text, scope);
    return values.length > 0 && values.every(v => isSanitized(v, scope, seen));
  }
  return false;
}

/** 这次写库里 content 的值。null 表示写法看不透（展开运算符之类），要求改写成显式字段。 */
function contentValues(arg: ts.Expression | undefined, scope: ts.Node, seen = new Set<string>()): ts.Expression[] | null {
  if (!arg) return [];
  if (ts.isParenthesizedExpression(arg)) return contentValues(arg.expression, scope, seen);
  if (ts.isConditionalExpression(arg)) {
    const whenTrue = contentValues(arg.whenTrue, scope, seen);
    const whenFalse = contentValues(arg.whenFalse, scope, seen);
    return whenTrue === null || whenFalse === null ? null : [...whenTrue, ...whenFalse];
  }
  if (ts.isObjectLiteralExpression(arg)) {
    const out: ts.Expression[] = [];
    for (const prop of arg.properties) {
      if (ts.isSpreadAssignment(prop)) {
        // 展开本函数里的局部对象（{ ...updateData, metadata }）就看它的 content；展开参数、req.body 这类看不透
        const inner = ts.isIdentifier(prop.expression) && valuesOf(prop.expression.text, scope).length > 0
          ? contentValues(prop.expression, scope, seen)
          : null;
        if (inner === null) return null;
        out.push(...inner);
      }
      if (ts.isPropertyAssignment(prop) && prop.name.getText() === 'content') out.push(prop.initializer);
      if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'content') out.push(prop.name);
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(arg)) {
    const all = arg.elements.map(el => contentValues(el, scope, seen));
    return all.some(v => v === null) ? null : all.flat() as ts.Expression[];
  }
  if (ts.isIdentifier(arg)) {
    // updateData.content = … 或 const row = { content: … }
    const name = arg.text;
    if (seen.has(name)) return [];
    seen.add(name);
    const out: ts.Expression[] = [];
    for (const n of descendants(scope)) {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left))
        && isNamed(n.left.expression, name)) {
        const key = ts.isPropertyAccessExpression(n.left) ? n.left.name.text : n.left.argumentExpression.getText().replace(/['"`]/g, '');
        if (key === 'content') out.push(n.right);
      }
    }
    for (const init of valuesOf(name, scope)) {
      const inner = contentValues(init, scope, seen);
      if (inner === null) return null;
      out.push(...inner);
    }
    return out;
  }
  return null;
}

function isPassThroughWriter(scope: ts.Node): boolean {
  return ts.isFunctionDeclaration(scope) && !!scope.name && PASS_THROUGH_WRITERS.has(scope.name.text);
}

/** 调用方回调返回的对象：箭头函数的表达式体，或函数体里的每个 return。回调不是字面量就看不透。 */
function builtValues(build: ts.Expression | undefined, scope: ts.Node): ts.Expression[] | null {
  if (!build || !(ts.isArrowFunction(build) || ts.isFunctionExpression(build))) return null;
  if (!ts.isBlock(build.body)) return contentValues(build.body, scope);
  const returns = descendants(build.body)
    .filter((n): n is ts.ReturnStatement => ts.isReturnStatement(n) && enclosingScope(n) === build);
  const all = returns.map(r => contentValues(r.expression, scope));
  return all.some(v => v === null) ? null : all.flat() as ts.Expression[];
}

/** 扫一个文件，列出写 notes.content 的每一处，以及没有消毒的原因。 */
function scanNoteContentWrites(fileName: string, text: string): ContentWrite[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const writes: ContentWrite[] = [];
  const check = (node: ts.Node, values: ts.Expression[] | null, scope: ts.Node) => {
    const where = `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    if (values === null) {
      writes.push({ where, problem: '写入对象用了展开或看不透的写法，请把 content 写成显式字段' });
    } else if (values.length > 0) {
      const raw = values.filter(v => !isSanitized(v, scope));
      writes.push({ where, problem: raw.length ? `content 没有经过 sanitizeNoteHtml：${raw.map(v => v.getText()).join(' / ')}` : undefined });
      // 同一个函数里算内容分层的，必须用消毒后的值
      for (const call of descendants(scope)) {
        if (ts.isCallExpression(call) && isNamed(call.expression, 'segmentNoteContent')
          && call.arguments[0] && !isSanitized(call.arguments[0], scope)) {
          writes.push({ where, problem: `segmentNoteContent 用的不是消毒后的正文：${call.arguments[0].getText()}` });
        }
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && WRITE_METHODS.has(node.expression.name.text) && targetsNotes(node.expression.expression)) {
      const scope = enclosingScope(node);
      if (!isPassThroughWriter(scope)) check(node, contentValues(node.arguments[0], scope), scope);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && PASS_THROUGH_WRITERS.has(node.expression.text)) {
      const scope = enclosingScope(node);
      check(node, builtValues(node.arguments[1], scope), scope);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return writes;
}

function scanAll(): ContentWrite[] {
  return sourceFiles().flatMap(path =>
    scanNoteContentWrites(relative(SRC, path).split('\\').join('/'), readFileSync(path, 'utf-8')));
}

describe('写 notes.content 的地方', () => {
  it('每一处都先过 sanitizeNoteHtml，内容分层也用消毒后的值', () => {
    const problems = scanAll().filter(w => w.problem).map(w => `${w.where}  ${w.problem}`);
    expect(problems).toEqual([]);
  });

  it('扫描确实找到了已知的写入路径（防止扫描器悄悄失效）', () => {
    const files = new Set(scanAll().map(w => w.where.split(':')[0]));
    for (const file of ['routes/notes.ts', 'routes/riseAbove.ts', 'routes/ctTool.ts', 'routes/turingTest.ts', 'routes/noteAiFeedback.ts']) {
      expect(files).toContain(file);
    }
    expect(scanAll().filter(w => w.where.startsWith('routes/notes.ts:')).length).toBeGreaterThanOrEqual(3);
  });

  it('扫描器能认出漏掉消毒的写法', () => {
    const bad = scanNoteContentWrites('bad.ts', `
      async function create(req) {
        const { content } = req.body;
        const seg = segmentNoteContent(content);
        await supabase.from('notes').insert({ title: 't', content, content_segments: seg.segments });
      }
      async function update(req) {
        const patch = { updated_at: 'now' };
        patch.content = req.body.content;
        await supabase.from('notes').update(patch).eq('id', req.params.id);
      }
      async function spread(req) {
        await supabase.from('notes').insert({ ...req.body });
      }
      async function guarded(req) {
        await updateNoteGuarded(req.params.id, row => ({ content: req.body.content }));
      }
      async function guardedParam(req, patch) {
        await updateNoteGuarded(req.params.id, row => ({ ...patch, metadata: row.metadata }));
      }
    `);
    expect(bad.map(w => w.problem)).toEqual([
      expect.stringContaining('content 没有经过 sanitizeNoteHtml'),
      expect.stringContaining('segmentNoteContent 用的不是消毒后的正文'),
      expect.stringContaining('content 没有经过 sanitizeNoteHtml'),
      expect.stringContaining('展开'),
      expect.stringContaining('content 没有经过 sanitizeNoteHtml'),
      expect.stringContaining('展开'),
    ]);

    const good = scanNoteContentWrites('good.ts', `
      async function create(req) {
        const safeContent = req.body.content == null ? req.body.content : await sanitizeNoteHtml(String(req.body.content));
        const seg = segmentNoteContent(safeContent ?? '');
        await supabase.from('notes').insert({ content: safeContent, content_segments: seg.segments });
        await supabase.from('notes').update({ deleted_at: 'now' }).eq('id', 'x');
      }
      async function updateNoteGuarded(noteId, build) {
        const changes = build({});
        await supabase.from('notes').update(changes).eq('id', noteId);
      }
      async function put(req) {
        const safeContent = await sanitizeNoteHtml(String(req.body.content ?? ''));
        const updateData = { updated_at: 'now' };
        updateData.content = safeContent;
        await updateNoteGuarded(req.params.id, row => {
          if (row.file_url) return row.md ? { ...updateData, metadata: {} } : updateData;
          return { metadata: row.metadata };
        });
      }
    `);
    expect(good.filter(w => w.problem)).toEqual([]);
    // insert 那一处和经 updateNoteGuarded 的那一处都认出来了，函数体内那次写不算
    expect(good).toHaveLength(2);
  });
});
