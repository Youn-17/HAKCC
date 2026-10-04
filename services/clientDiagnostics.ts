/**
 * 前端最近出错的一小段记录，只为「学生求助」附上处境用。
 *
 * 学生描述问题时说的是「保存不了」；教师和下一届需要知道的是
 * 哪个接口在什么时候返回了什么。这两者之间的落差就靠这里补。
 *
 * 只记 method / path / status / 错误信息，绝不记请求体、响应体、
 * 请求头或 token —— 求助记录会进研究语料库，不能夹带凭据。
 */

export interface ClientFailure {
  at: string;
  kind: 'api' | 'script' | 'promise';
  detail: string;
}

const MAX = 5;
const buffer: ClientFailure[] = [];

/** query string 里可能带 id，留着有用；但截断，别把整串塞进语料。 */
function trimPath(path: string): string {
  return path.length > 160 ? `${path.slice(0, 160)}…` : path;
}

export function recordFailure(kind: ClientFailure['kind'], detail: string): void {
  buffer.push({ at: new Date().toISOString(), kind, detail: detail.slice(0, 300) });
  if (buffer.length > MAX) buffer.shift();
}

export function recordApiFailure(method: string, path: string, status: number, message: string): void {
  recordFailure('api', `${method} ${trimPath(path)} → ${status} ${message}`);
}

export function recentFailures(): ClientFailure[] {
  return buffer.slice();
}

let installed = false;

/** 在应用启动时装一次。重复调用无害。 */
export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => {
    const src = e.filename ? ` @ ${e.filename.split('/').pop()}:${e.lineno}` : '';
    recordFailure('script', `${e.message}${src}`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    recordFailure('promise', reason instanceof Error ? reason.message : String(reason));
  });
}
