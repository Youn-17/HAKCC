import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { TEXT_WORKER_SOURCE } from './textWorkerSource';

/**
 * 常驻的 Python 文本分析进程（分词、关键词、词云排版），第一次用到时启动，之后一直开着：
 * Python 导入 jieba、wordcloud 加分词词典要两秒，每次现起一个进程太慢。
 * 一次只处理一个请求，排队；进程退出、卡住就重启。Python 环境没装好时返回 unavailable，调用方照常出其余的分析。
 *
 * 用哪个 Python：HAKCC_PYTHON，否则 /opt/hakcc-py/bin/python（服务器上的独立环境），再否则系统 python3。
 */

export interface KeywordTerm {
  word: string;
  /** 0–1，最高的为 1 */
  weight: number;
  count: number;
  /** 出现在几篇笔记里 */
  notes: number;
  note_ids: string[];
}

export interface CloudItem {
  word: string;
  weight: number;
  size: number;
  /** 墨迹框左上角 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 从 y 到基线的距离：SVG 的 text 基线画在 y + ascent */
  ascent: number;
}

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

const REQUEST_TIMEOUT_MS = 20_000;
const START_TIMEOUT_MS = 20_000;

export class TextWorkerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextWorkerUnavailable';
  }
}

export function pythonCommand(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HAKCC_PYTHON?.trim()) return env.HAKCC_PYTHON.trim();
  if (existsSync('/opt/hakcc-py/bin/python')) return '/opt/hakcc-py/bin/python';
  return 'python3';
}

class TextWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = '';
  /** 一次只发一个：wordcloud 排版吃 CPU，服务器只有两个核 */
  private queue: Promise<unknown> = Promise.resolve();

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(pythonCommand(), ['-u', '-c', TEXT_WORKER_SOURCE], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        this.ready = null;
        reject(new TextWorkerUnavailable(String((err as Error)?.message ?? err)));
        return;
      }
      this.child = child;
      let stderr = '';
      const startTimer = setTimeout(() => {
        this.stop(new TextWorkerUnavailable(`python text worker did not start in ${START_TIMEOUT_MS} ms: ${stderr.slice(-300)}`));
        reject(new TextWorkerUnavailable('python text worker start timeout'));
      }, START_TIMEOUT_MS);
      child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
      child.on('error', err => {
        clearTimeout(startTimer);
        this.stop(new TextWorkerUnavailable(err.message));
        reject(new TextWorkerUnavailable(err.message));
      });
      child.on('exit', code => {
        clearTimeout(startTimer);
        const message = `python text worker exited (${code}): ${stderr.slice(-300)}`;
        this.stop(new TextWorkerUnavailable(message));
        reject(new TextWorkerUnavailable(message));
      });
      child.stdout.on('data', chunk => {
        this.buffer += String(chunk);
        let newline: number;
        while ((newline = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, newline).trim();
          this.buffer = this.buffer.slice(newline + 1);
          if (!line) continue;
          let msg: { id: number | null; ok: boolean; result?: unknown; error?: string };
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.id === null) {
            clearTimeout(startTimer);
            resolve();
            continue;
          }
          const waiting = this.pending.get(msg.id);
          if (!waiting) continue;
          this.pending.delete(msg.id);
          clearTimeout(waiting.timer);
          if (msg.ok) waiting.resolve(msg.result);
          else waiting.reject(new Error(msg.error ?? 'python error'));
        }
      });
    });
    return this.ready;
  }

  private stop(reason: Error): void {
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(reason);
    }
    this.pending.clear();
    if (this.child && this.child.exitCode === null) this.child.kill();
    this.child = null;
    this.ready = null;
    this.buffer = '';
  }

  call<T>(op: string, payload: unknown): Promise<T> {
    const run = async (): Promise<T> => {
      await this.start();
      const child = this.child;
      if (!child) throw new TextWorkerUnavailable('python text worker is not running');
      const id = this.nextId++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          // 卡住的进程留着只会让后面的请求一起等：杀掉，下次重启
          this.stop(new Error('python text worker timed out'));
          reject(new Error(`python ${op} timed out`));
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        child.stdin.write(`${JSON.stringify({ id, op, payload })}\n`);
      });
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  shutdown(): void {
    this.stop(new Error('shutdown'));
  }
}

let worker: TextWorker | null = null;

function shared(): TextWorker {
  if (!worker) worker = new TextWorker();
  return worker;
}

/** names：这个空间成员的姓名，进词典当人名并排除（笔记里回应同学常写名字） */
export function extractKeywords(docs: Array<{ id: string; text: string }>, opts: { topK?: number; names?: string[]; extraWords?: string[]; extraStop?: string[] } = {}) {
  return shared().call<{ terms: KeywordTerm[]; docs: number; tokens: number }>('keywords', {
    docs, top_k: opts.topK ?? 60, names: opts.names ?? [], extra_words: opts.extraWords ?? [], extra_stop: opts.extraStop ?? [],
  });
}

export function keywordChanges(docs: Array<{id: string; text: string; period: 'before' | 'after'}>, opts: {names?: string[]; extraWords?: string[]; extraStop?: string[]} = {}) {
  return shared().call<{
    periods: {before: {docs: number; tokens: number}; after: {docs: number; tokens: number}};
    terms: Array<{word: string; before: {count: number; notes: number; note_ids: string[]}; after: {count: number; notes: number; note_ids: string[]}; delta: number}>;
  }>('changes', {docs, names:opts.names ?? [], extra_words:opts.extraWords ?? [], extra_stop:opts.extraStop ?? []});
}

export function layoutCloud(words: Array<{ word: string; weight: number }>, opts: { width?: number; height?: number; seed?: number } = {}) {
  return shared().call<{ items: CloudItem[]; width: number; height: number }>('cloud', {
    words, width: opts.width ?? 900, height: opts.height ?? 420, seed: opts.seed ?? 7,
  });
}

export function pingTextWorker() {
  return shared().call<{ jieba: string; wordcloud: string; font: boolean; python: string }>('ping', {});
}

/** 测试用：换掉单例 */
export function resetTextWorkerForTests(): void {
  worker?.shutdown();
  worker = null;
}
