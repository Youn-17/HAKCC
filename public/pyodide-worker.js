/* Pyodide execution worker for the Vibe Coding Dojo.
 * Runs student Python code off the main thread; the host page enforces a
 * hard timeout by terminating this worker and spawning a fresh one. */

/* global loadPyodide, importScripts */

let pyodideReadyPromise = null;

function ensurePyodide() {
  if (!pyodideReadyPromise) {
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
    pyodideReadyPromise = loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
    });
  }
  return pyodideReadyPromise;
}

self.onmessage = async (event) => {
  const { id, code } = event.data;
  try {
    const pyodide = await ensurePyodide();

    // Capture stdout/stderr per run
    let output = '';
    pyodide.setStdout({ batched: (s) => { output += s + '\n'; } });
    pyodide.setStderr({ batched: (s) => { output += s + '\n'; } });

    // Fresh globals per run so state never leaks between executions
    await pyodide.runPythonAsync(
      'import sys\nfor _m in list(sys.modules.keys()):\n    pass\n',
    );
    const namespace = pyodide.globals.get('dict')();

    try {
      await pyodide.runPythonAsync(code, { globals: namespace });
      self.postMessage({ id, ok: true, output: output.slice(0, 20000) });
    } catch (err) {
      const message = err && err.message ? String(err.message) : String(err);
      // Trim pyodide's internal frames from the traceback for readability
      const cleaned = message
        .split('\n')
        .filter((line) => !line.includes('/lib/python') && !line.includes('pyodide'))
        .join('\n')
        .trim();
      self.postMessage({ id, ok: false, output: output.slice(0, 20000), error: (cleaned || message).slice(0, 4000) });
    } finally {
      namespace.destroy();
    }
  } catch (err) {
    self.postMessage({ id, ok: false, output: '', error: 'Python 运行环境加载失败：' + (err && err.message ? err.message : String(err)) });
  }
};

self.postMessage({ ready: true });
