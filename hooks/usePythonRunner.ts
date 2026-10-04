import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pyodide-in-a-worker Python runner. The hard timeout terminates the whole
 * worker (the only reliable way to kill a stuck interpreter) and boots a
 * fresh one, so infinite loops can never freeze the page.
 */
export function usePythonRunner() {
  const workerRef = useRef<Worker | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const pendingRef = useRef<Map<number, (r: { ok: boolean; output: string; error?: string }) => void>>(new Map());
  const idRef = useRef(0);

  const spawn = useCallback(() => {
    if (workerRef.current) workerRef.current.terminate();
    setEngineReady(false);
    const w = new Worker('/pyodide-worker.js');
    w.onmessage = (e) => {
      if (e.data?.ready) { setEngineReady(true); return; }
      const cb = pendingRef.current.get(e.data.id);
      if (cb) {
        pendingRef.current.delete(e.data.id);
        cb(e.data);
      }
    };
    workerRef.current = w;
  }, []);

  useEffect(() => {
    spawn();
    return () => workerRef.current?.terminate();
  }, [spawn]);

  const run = useCallback((code: string, timeoutMs = 30_000): Promise<{ ok: boolean; output: string; error?: string; timedOut?: boolean }> => {
    return new Promise((resolve) => {
      const w = workerRef.current;
      if (!w) { resolve({ ok: false, output: '', error: 'Runner not ready' }); return; }
      const id = ++idRef.current;
      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        spawn();
        resolve({ ok: false, output: '', error: '运行超时（30 秒）——可能是死循环？已重启运行环境。', timedOut: true });
      }, timeoutMs);
      pendingRef.current.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      w.postMessage({ id, code });
    });
  }, [spawn]);

  return { run, engineReady };
}
