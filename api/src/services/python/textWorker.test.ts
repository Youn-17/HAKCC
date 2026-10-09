import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractKeywords, layoutCloud, pingTextWorker, pythonCommand, resetTextWorkerForTests } from './textWorker';
import { TEXT_WORKER_SOURCE } from './textWorkerSource';

/**
 * 常驻 Python 进程的收发：用一个假的「python」（Node 写的，按同样的行协议回答）测排队、按 id 对上回答、
 * 进程退出后重启。真的分词和排版在服务器上跑，见 docs/plans/2026-10-09-space-analytics.md 的实测。
 */

let dir: string;

function fakePython(behaviour: 'ok' | 'crash-first' | 'error'): string {
  const script = join(dir, `fake-python-${behaviour}`);
  const counter = join(dir, 'starts');
  writeFileSync(script, `#!/usr/bin/env node
const fs = require('fs');
const starts = fs.existsSync(${JSON.stringify(counter)}) ? Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) + 1 : 1;
fs.writeFileSync(${JSON.stringify(counter)}, String(starts));
process.stdout.write(JSON.stringify({ id: null, ok: true, result: { ready: true } }) + '\\n');
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', line => {
  const req = JSON.parse(line);
  if (${JSON.stringify(behaviour)} === 'crash-first' && starts === 1) process.exit(3);
  if (${JSON.stringify(behaviour)} === 'error') { process.stdout.write(JSON.stringify({ id: req.id, ok: false, error: 'ValueError: bad' }) + '\\n'); return; }
  const result = req.op === 'ping' ? { jieba: 'x', wordcloud: 'y', font: true, python: '3.12', starts }
    : req.op === 'keywords' ? { terms: req.payload.docs.map(d => ({ word: d.text, weight: 1, count: 1, notes: 1, note_ids: [d.id] })), docs: req.payload.docs.length, tokens: 1 }
    : { items: req.payload.words.map(w => ({ word: w.word, weight: w.weight, size: 20, x: 0, y: 0, w: 10, h: 10, ascent: 9 })), width: req.payload.width, height: req.payload.height };
  // 回答顺序和请求顺序无关：按 id 对
  setTimeout(() => process.stdout.write(JSON.stringify({ id: req.id, ok: true, result }) + '\\n'), req.op === 'keywords' ? 30 : 0);
});
`);
  chmodSync(script, 0o755);
  return script;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'textworker-'));
  resetTextWorkerForTests();
});

afterEach(() => {
  resetTextWorkerForTests();
  delete process.env.HAKCC_PYTHON;
});

describe('textWorker', () => {
  it('启动一次，之后的请求排队发给同一个进程，回答按 id 对上', async () => {
    process.env.HAKCC_PYTHON = fakePython('ok');
    const [keywords, cloud, ping] = await Promise.all([
      extractKeywords([{ id: 'n1', text: '知识建构' }]),
      layoutCloud([{ word: '知识建构', weight: 1 }], { width: 800, height: 300 }),
      pingTextWorker(),
    ]);
    expect(keywords.terms[0]).toMatchObject({ word: '知识建构', note_ids: ['n1'] });
    expect(cloud).toMatchObject({ width: 800, height: 300, items: [{ word: '知识建构' }] });
    expect(ping).toMatchObject({ starts: 1 });
  });

  it('进程半路退出：这次请求报错，下次自动重启', async () => {
    process.env.HAKCC_PYTHON = fakePython('crash-first');
    await expect(pingTextWorker()).rejects.toThrow(/exited/);
    await expect(pingTextWorker()).resolves.toMatchObject({ starts: 2 });
  });

  it('Python 那边报错：把错误原样交给调用方，进程照常用', async () => {
    process.env.HAKCC_PYTHON = fakePython('error');
    await expect(extractKeywords([{ id: 'n1', text: 'x' }])).rejects.toThrow('ValueError: bad');
  });

  it('Python 不存在：报不可用', async () => {
    process.env.HAKCC_PYTHON = join(dir, 'no-such-python');
    await expect(pingTextWorker()).rejects.toThrow();
  });

  it('选 Python：环境变量优先，没有就用服务器上的独立环境或系统 python3', () => {
    expect(pythonCommand({ HAKCC_PYTHON: '/x/python' })).toBe('/x/python');
    expect(['python3', '/opt/hakcc-py/bin/python']).toContain(pythonCommand({}));
  });

  it('源码里有分词、关键词、排版三个操作，课程词典里有「知识建构」', () => {
    expect(TEXT_WORKER_SOURCE).toContain('OPS = {"ping": ping, "keywords": keywords, "cloud": cloud, "changes": changes}');
    expect(TEXT_WORKER_SOURCE).toContain('"知识建构"');
    expect(TEXT_WORKER_SOURCE).not.toContain('`');
  });
});
