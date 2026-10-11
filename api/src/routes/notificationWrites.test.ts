import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 写 notifications 的地方只用线上库里真有的列。
 *
 * 线上 public.notifications 只有下面九列（2026-10-10 查生产库 information_schema），没有 metadata。
 * 写入时多带一个不存在的键，PostgREST 整条拒收（PGRST204）；supabase-js 不抛异常，错误只在返回值里。
 * 学生采纳 / 插入 / 不采纳 AI 反馈后通知授课教师的那条带了 metadata，又是 void 掉的，
 * 生产库里这类通知一条都没有。路由测试的模拟库什么列都收，那条测试一直是绿的。
 *
 * 做法同 noteContentWrites.test.ts：用 TypeScript 语法树找出所有 .from('notifications').insert/update/upsert(...)，
 * 取写进去的对象的键。写的是变量就顺着往回找：声明和赋值、rows.push({...})、row.key = …、
 * Object.assign(row, {...})、rows.map(r => ({...}))。看不透的写法（展开参数、另一个函数拼出来的行）
 * 也算不通过，请改成显式字段。线上加了列，先在这里的名单里加上。
 */
const NOTIFICATION_COLUMNS = new Set(['id', 'user_id', 'type', 'title', 'message', 'read', 'link_type', 'link_id', 'created_at']);
const SRC = resolve(__dirname, '..');
const WRITE_METHODS = new Set(['insert', 'update', 'upsert']);

interface NotificationWrite {
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

/** 沿着链式调用往里找 .from('notifications')。 */
function targetsNotifications(expr: ts.Expression): boolean {
  let e: ts.Expression = expr;
  for (;;) {
    if (ts.isCallExpression(e)) {
      if (ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'from') {
        const table = e.arguments[0];
        return !!table && ts.isStringLiteralLike(table) && table.text === 'notifications';
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

/** 对象字面量里的键名；算出来的键（[key]: …）看不透，返回 null。 */
function keyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return null;
}

/** 从用到变量的地方往外一层层找，第一个声明了它的作用域。参数和解构出来的变量看不透。 */
function declaringScope(name: string, site: ts.Node): ts.Node | null {
  for (let scope: ts.Node | null = enclosingScope(site); scope; scope = ts.isSourceFile(scope) ? null : enclosingScope(scope)) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(p => isNamed(p.name, name))) return null;
    if (descendants(scope).some(n => ts.isVariableDeclaration(n) && isNamed(n.name, name))) return scope;
  }
  return null;
}

/** 写进 notifications 的列名。null 表示写法看不透。 */
function columnsOf(arg: ts.Expression | undefined, seen = new Set<string>()): string[] | null {
  if (!arg) return [];
  let e: ts.Expression = arg;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) {
    e = e.expression;
  }
  const union = (parts: Array<string[] | null>) => (parts.some(p => p === null) ? null : (parts as string[][]).flat());

  if (ts.isConditionalExpression(e)) return union([columnsOf(e.whenTrue, seen), columnsOf(e.whenFalse, seen)]);
  if (ts.isObjectLiteralExpression(e)) {
    return union(e.properties.map((prop) => {
      if (ts.isSpreadAssignment(prop)) return columnsOf(prop.expression, seen);
      if (ts.isShorthandPropertyAssignment(prop)) return [prop.name.text];
      const key = prop.name ? keyName(prop.name) : null;
      return key === null ? null : [key];
    }));
  }
  if (ts.isArrayLiteralExpression(e)) {
    return union(e.elements.map(el => (ts.isSpreadElement(el) ? columnsOf(el.expression, seen) : columnsOf(el, seen))));
  }
  if (ts.isIdentifier(e)) {
    const scope = declaringScope(e.text, e);
    if (!scope) return null;
    const id = `${scope.pos}:${e.text}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const name = e.text;
    const parts: Array<string[] | null> = [];
    for (const n of descendants(scope)) {
      // const rows = […] / rows = …
      if (ts.isVariableDeclaration(n) && isNamed(n.name, name) && n.initializer) parts.push(columnsOf(n.initializer, seen));
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (isNamed(n.left, name)) parts.push(columnsOf(n.right, seen));
        // row.link_type = … / row['link_type'] = …
        if (ts.isPropertyAccessExpression(n.left) && isNamed(n.left.expression, name)) parts.push([n.left.name.text]);
        if (ts.isElementAccessExpression(n.left) && isNamed(n.left.expression, name)) {
          const key = n.left.argumentExpression;
          parts.push(ts.isStringLiteralLike(key) ? [key.text] : null);
        }
      }
      if (ts.isCallExpression(n)) {
        // rows.push({…}) / rows.unshift({…})
        if (ts.isPropertyAccessExpression(n.expression) && isNamed(n.expression.expression, name)
          && ['push', 'unshift'].includes(n.expression.name.text)) {
          parts.push(...n.arguments.map(a => (ts.isSpreadElement(a) ? columnsOf(a.expression, seen) : columnsOf(a, seen))));
        }
        // Object.assign(row, {…})
        if (ts.isPropertyAccessExpression(n.expression) && isNamed(n.expression.expression, 'Object')
          && n.expression.name.text === 'assign' && n.arguments[0] && isNamed(n.arguments[0], name)) {
          parts.push(...n.arguments.slice(1).map(a => columnsOf(a, seen)));
        }
      }
    }
    return union(parts);
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const method = e.expression.name.text;
    // rows.map(r => ({…}))：看回调返回的对象
    if (method === 'map' || method === 'flatMap') {
      const fn = e.arguments[0];
      if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return null;
      if (!ts.isBlock(fn.body)) return columnsOf(fn.body, seen);
      const returns = descendants(fn.body)
        .filter((n): n is ts.ReturnStatement => ts.isReturnStatement(n) && enclosingScope(n) === fn);
      return union(returns.map(r => columnsOf(r.expression, seen)));
    }
    // 筛选、截取不改行的形状
    if (['filter', 'slice', 'concat'].includes(method)) {
      return union([columnsOf(e.expression.expression, seen), ...e.arguments.map(a => columnsOf(a, seen))]);
    }
  }
  return null;
}

/** 扫一个文件，列出写 notifications 的每一处，以及用错列的原因。 */
function scanNotificationWrites(fileName: string, text: string): NotificationWrite[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const writes: NotificationWrite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && WRITE_METHODS.has(node.expression.name.text) && targetsNotifications(node.expression.expression)) {
      const where = `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      const columns = columnsOf(node.arguments[0]);
      if (columns === null) {
        writes.push({ where, problem: '看不透写了哪些列（展开参数、调别的函数拼行之类），请把写入的对象写成显式字段' });
      } else {
        const unknown = [...new Set(columns.filter(c => !NOTIFICATION_COLUMNS.has(c)))];
        writes.push({ where, problem: unknown.length ? `notifications 没有这些列：${unknown.join(', ')}` : undefined });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return writes;
}

function scanAll(): NotificationWrite[] {
  return sourceFiles().flatMap(path =>
    scanNotificationWrites(relative(SRC, path).split('\\').join('/'), readFileSync(path, 'utf-8')));
}

describe('写 notifications 的地方', () => {
  it('每一处都只用线上库里有的列', () => {
    const problems = scanAll().filter(w => w.problem).map(w => `${w.where}  ${w.problem}`);
    expect(problems).toEqual([]);
  });

  it('扫描确实找到了已知的写入路径（防止扫描器悄悄失效）', () => {
    const writes = scanAll();
    const files = new Set(writes.map(w => w.where.split(':')[0]));
    for (const file of ['routes/noteAiFeedback.ts', 'routes/feedback.ts', 'routes/notifications.ts']) {
      expect(files).toContain(file);
    }
    // POST 一处 insert，标为已读两处 update
    expect(writes.filter(w => w.where.startsWith('routes/notifications.ts:')).length).toBeGreaterThanOrEqual(3);
  });

  it('扫描器能认出用错列和看不透的写法', () => {
    const bad = scanNotificationWrites('bad.ts', `
      async function respond(note, feedbackId, status) {
        void supabase.from('notifications').insert({
          user_id: 'teacher-1', type: 'ai_feedback_response', title: 't', message: 'm',
          metadata: { note_id: note.id, feedback_id: feedbackId, status },
        });
      }
      async function pushed(rows) {
        const notices = [];
        for (const r of rows) notices.push({ user_id: r.user_id, type: 'x', title: 't', message: 'm', note_id: r.note_id });
        await supabase.from('notifications').insert(notices);
      }
      async function mapped(rows) {
        await supabase.from('notifications').insert(rows.map(r => ({ user_id: r.id, type: 'x', title: 't', message: 'm', url: r.url })));
      }
      async function assigned() {
        const row = { user_id: 'u', type: 'x', title: 't', message: 'm' };
        row.is_read = false;
        await supabase.from('notifications').insert(row);
      }
      async function marked(id) {
        await supabase.from('notifications').update({ is_read: true }).eq('id', id);
      }
      async function fromParam(row) {
        await supabase.from('notifications').insert(row);
      }
      async function spread(req) {
        await supabase.from('notifications').insert({ ...req.body, read: false });
      }
      async function built(user) {
        await supabase.from('notifications').insert(buildNotice(user));
      }
    `);
    expect(bad.map(w => w.problem)).toEqual([
      'notifications 没有这些列：metadata',
      'notifications 没有这些列：note_id',
      'notifications 没有这些列：url',
      'notifications 没有这些列：is_read',
      'notifications 没有这些列：is_read',
      expect.stringContaining('看不透'),
      expect.stringContaining('看不透'),
      expect.stringContaining('看不透'),
    ]);

    // 现有的几种写法：显式字段、先 push 再整批插入（小组任务）、标为已读、按条件挑一种、展开本地对象
    const good = scanNotificationWrites('good.ts', `
      async function respond(note) {
        void supabase.from('notifications').insert({
          user_id: 'teacher-1', type: 'ai_feedback_response', title: 't', message: 'm', link_type: 'note', link_id: note.id,
        }).then(({ error }) => { if (error) console.error(error.message); });
      }
      function notifyGroupMembers(groups) {
        void (async () => {
          const { data: rows } = await supabase.from('group_members').select('group_id, user_id');
          const notices = [];
          for (const r of rows ?? []) {
            notices.push({ user_id: r.user_id, type: 'group_assignment', title: 't', message: 'm', link_type: 'group', link_id: r.group_id });
          }
          if (notices.length) await supabase.from('notifications').insert(notices);
        })();
      }
      async function marked(id, all) {
        await supabase.from('notifications').update({ read: true }).eq('id', id);
        const base = { user_id: 'u', type: 'system', title: 't', message: 'm' };
        await supabase.from('notifications').insert(all ? [{ ...base, link_type: 'view', link_id: id }] : { ...base });
      }
    `);
    expect(good.filter(w => w.problem)).toEqual([]);
    expect(good).toHaveLength(4);
  });
});
