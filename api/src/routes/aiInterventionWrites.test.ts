import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 读写 ai_interventions 的地方只用线上库里真有的列，写完要看返回的 error。
 *
 * 线上 public.ai_interventions 是下面十七列（2026-10-11 查生产库 information_schema）。模型那一列叫
 * model_full_name；repo 里 001 迁移建的是 model_name，091 迁移把它改名对齐了线上。写入多带一个不存在的键，PostgREST 整条拒收
 * （PGRST204，HTTP 400）；supabase-js 不抛异常，错误只在返回值里，而这些写入都没看返回值：
 * 笔记页 AI、知识空间智能体、个人助手、/ai/chat、出图、联网搜索的记录上线以来一条都没写进去，
 * 只有看了 error 的 AI 反馈那条（noteAiFeedback.ts）有数据。两个读接口选了 model_name，一调就 500。
 *
 * 做法同 notificationWrites.test.ts：用 TypeScript 语法树找出 .from('ai_interventions') 上的
 * insert/update/upsert，取写进去的对象的键，写的是变量就顺着往回找；select 的列名字符串逐项比。
 * 写入的结果要么解构出 error（const { error } = await …），要么 .then(({ error }) => …)。
 * 直接 await 掉、void 掉都算不通过（void 掉的连请求都不会发：查询要被 then 才执行）。
 * 看不透的写法也算不通过，请改成显式字段。线上加了列，先在这里的名单里加上。
 */
const TABLE = 'ai_interventions';
const LIVE_COLUMNS = new Set([
  'id', 'space_id', 'note_id', 'user_id', 'trigger_type', 'trigger_context', 'prompt_template_version',
  'provider_id', 'model_full_name', 'input_context_summary', 'response_text', 'visibility_scope',
  'accepted_flag', 'followed_by_action', 'created_at', 'suppressed', 'group_id',
]);
const SRC = resolve(__dirname, '..');
const WRITE_METHODS = new Set(['insert', 'update', 'upsert']);
const UNCHECKED = '没看返回的 error：supabase-js 不抛，写不进去也没人知道。用 const { error } = await … 或 .then(({ error }) => …)';

interface TableUse {
  where: string;
  kind: 'write' | 'read';
  problem?: string;
}

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

/** 沿着链式调用往里找 .from('ai_interventions')。 */
function targetsTable(expr: ts.Expression): boolean {
  let e: ts.Expression = expr;
  for (;;) {
    if (ts.isCallExpression(e)) {
      if (ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'from') {
        const table = e.arguments[0];
        return !!table && ts.isStringLiteralLike(table) && table.text === TABLE;
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

/** 写进去的列名。null 表示写法看不透。 */
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
      // const row = {…} / row = …
      if (ts.isVariableDeclaration(n) && isNamed(n.name, name) && n.initializer) parts.push(columnsOf(n.initializer, seen));
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (isNamed(n.left, name)) parts.push(columnsOf(n.right, seen));
        // row.group_id = … / row['group_id'] = …
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

/** select('a, b:c, d::text, e->f, rel(x)') 里这张表自己的列名；不是字符串字面量就看不透，返回 null。 */
function selectedColumns(arg: ts.Expression | undefined): string[] | null {
  if (!arg) return [];
  if (!ts.isStringLiteralLike(arg)) return null;
  const items: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of arg.text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  items.push(cur);
  return items
    .map(item => item.trim())
    // * 和嵌入的关联表（notes(title)）不是这张表的列
    .filter(item => item && item !== '*' && !item.includes('('))
    .map((item) => {
      const noCast = item.split('::')[0];
      const column = noCast.slice(noCast.lastIndexOf(':') + 1);
      return column.split('->')[0].trim();
    });
}

function bindsError(name: ts.BindingName | undefined): boolean {
  return !!name && ts.isObjectBindingPattern(name) && name.elements.some((el) => {
    const key = el.propertyName ?? el.name;
    return (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === 'error';
  });
}

/** 写入的结果有没有人看 error：const { error } = await …，或者链上 .then(({ error }) => …)。 */
function errorChecked(write: ts.CallExpression): boolean {
  let node: ts.Node = write;
  for (;;) {
    const parent: ts.Node = node.parent;
    // 接着链式调用：.select('id').single()、.then(…)
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node
      && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
      if (parent.name.text === 'then') {
        const fn = parent.parent.arguments[0];
        return !!fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && bindsError(fn.parameters[0]?.name);
      }
      node = parent.parent;
    } else if (ts.isParenthesizedExpression(parent) || ts.isAwaitExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) {
      node = parent;
    } else {
      break;
    }
  }
  const holder = node.parent;
  return ts.isVariableDeclaration(holder) && holder.initializer === node && bindsError(holder.name);
}

/** 扫一个文件，列出读写 ai_interventions 的每一处，以及问题。 */
function scanTableUses(fileName: string, text: string): TableUse[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const uses: TableUse[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && targetsTable(node.expression.expression)) {
      const method = node.expression.name.text;
      const where = `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      const isWrite = WRITE_METHODS.has(method);
      if (isWrite || method === 'select') {
        const columns = isWrite ? columnsOf(node.arguments[0]) : selectedColumns(node.arguments[0]);
        const kind = isWrite ? 'write' : 'read';
        if (columns === null) {
          uses.push({ where, kind, problem: '看不透用了哪些列（展开参数、调别的函数拼行、列名不是字符串之类），请写成显式字段' });
        } else {
          const unknown = [...new Set(columns.filter(c => !LIVE_COLUMNS.has(c)))];
          uses.push({ where, kind, problem: unknown.length ? `${TABLE} 没有这些列：${unknown.join(', ')}` : undefined });
        }
        if (isWrite && !errorChecked(node)) uses.push({ where, kind, problem: UNCHECKED });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return uses;
}

function scanAll(): TableUse[] {
  return sourceFiles().flatMap(path =>
    scanTableUses(relative(SRC, path).split('\\').join('/'), readFileSync(path, 'utf-8')));
}

describe('读写 ai_interventions 的地方', () => {
  it('每一处都只用线上库里有的列，写入都看了返回的 error', () => {
    const problems = scanAll().filter(u => u.problem).map(u => `${u.where}  ${u.problem}`);
    expect(problems).toEqual([]);
  });

  it('扫描确实找到了已知的读写路径（防止扫描器悄悄失效）', () => {
    const uses = scanAll();
    // 一处写入可能同时有两个问题，按位置去重
    const writesIn = (file: string) => new Set(uses.filter(u => u.kind === 'write' && u.where.startsWith(`${file}:`)).map(u => u.where)).size;
    // 笔记页 AI：出图、一次性回答、流式、智能体
    expect(writesIn('routes/noteConversations.ts')).toBe(4);
    expect(writesIn('routes/workspaceAgent.ts')).toBe(1);
    // 联网搜索、出图、/ai/chat、/ai/chat/stream
    expect(writesIn('routes/ai.ts')).toBe(4);
    for (const file of ['routes/personalAgent.ts', 'services/drawTurn.ts', 'routes/noteAiFeedback.ts', 'services/experimentCondition.ts']) {
      expect(writesIn(file)).toBeGreaterThanOrEqual(1);
    }
    const readFiles = new Set(uses.filter(u => u.kind === 'read').map(u => u.where.split(':')[0]));
    for (const file of ['routes/ai.ts', 'routes/personalAgent.ts', 'services/researchExport.ts']) {
      expect(readFiles).toContain(file);
    }
  });

  it('扫描器能认出用错列、没看 error 和看不透的写法', () => {
    const bad = scanTableUses('bad.ts', `
      async function agentTurn(thread, req, model) {
        await supabase.from('ai_interventions').insert({
          space_id: thread.space_id, note_id: thread.note_id, user_id: req.user.id,
          trigger_type: 'note_conversation_agent_loop', model_name: model, visibility_scope: 'private',
        });
      }
      async function streamed(req, model) {
        void supabase.from('ai_interventions').insert({ user_id: req.user.id, trigger_type: 'user_chat', model_full_name: model });
      }
      async function ignored(req) {
        supabase.from('ai_interventions').insert({ user_id: req.user.id, trigger_type: 'web_search' }).then(() => {});
      }
      async function history(userId) {
        return supabase.from('ai_interventions').select('id, trigger_type, model_name, created_at').eq('user_id', userId);
      }
      async function fromParam(row) {
        const { error } = await supabase.from('ai_interventions').insert(row);
      }
      async function columnsFromVariable(columns) {
        return supabase.from('ai_interventions').select(columns);
      }
    `);
    expect(bad.filter(u => u.problem).map(u => u.problem)).toEqual([
      'ai_interventions 没有这些列：model_name',
      UNCHECKED,
      UNCHECKED,
      UNCHECKED,
      'ai_interventions 没有这些列：model_name',
      expect.stringContaining('看不透'),
      expect.stringContaining('看不透'),
    ]);

    // 现有的几种写法：解构出 error（改名也行）、写完再取回 id、then 里看 error、展开本地对象；
    // select 里的别名、类型转换、JSON 路径、嵌入关联表、计数
    const good = scanTableUses('good.ts', `
      async function logged(note, model) {
        const { error } = await supabase.from('ai_interventions').insert({
          space_id: note.spaceId, note_id: note.id, trigger_type: 'auto_feedback_unclear', model_full_name: model,
        });
        if (error) console.error(error.message);
      }
      async function shadow(params) {
        const row = { space_id: params.spaceId, trigger_type: params.triggerType, suppressed: true };
        const { error: shadowErr } = await supabase.from('ai_interventions').insert({ ...row, group_id: params.groupId }).select('id').single();
      }
      function later(userId) {
        void supabase.from('ai_interventions').insert({ user_id: userId, trigger_type: 'user_chat' })
          .then(({ error }) => { if (error) console.error(error.message); });
      }
      async function reads(userId) {
        await supabase.from('ai_interventions')
          .select('id, model_name:model_full_name, trigger_context->detection_method, created_at::date, notes(title)')
          .eq('user_id', userId);
        await supabase.from('ai_interventions').select('id', { count: 'exact', head: true });
        await supabase.from('ai_interventions').select('*');
      }
    `);
    expect(good.filter(u => u.problem)).toEqual([]);
    // insert(…).select('id') 外层的 select 先被扫到
    expect(good.map(u => u.kind)).toEqual(['write', 'read', 'write', 'write', 'read', 'read', 'read']);
  });
});
