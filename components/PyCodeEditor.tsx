import React, { useCallback, useMemo, useRef } from 'react';

/** Plain-textarea Python editor with line numbers and Tab-to-indent. */
const PyCodeEditor: React.FC<{ value: string; onChange: (v: string) => void; disabled?: boolean; minHeight?: number }> = ({ value, onChange, disabled, minHeight = 320 }) => {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => value.split('\n').length, [value]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + '    ' + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4; });
    }
  }, [value, onChange]);

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-stone-200 bg-[#fafaf9] font-mono text-[0.8125rem] leading-[1.6] dark:border-stone-700 dark:bg-[#0c0a09]" style={{ minHeight }}>
      <div ref={gutterRef} className="select-none overflow-hidden border-r border-stone-200 bg-stone-100/70 px-2 py-3 text-right text-stone-400 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-600">
        {Array.from({ length: lines }).map((_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <textarea
        ref={taRef}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={e => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
        spellCheck={false}
        className="h-full flex-1 resize-none bg-transparent px-3 py-3 text-stone-800 outline-none dark:text-stone-100"
        style={{ tabSize: 4 }}
      />
    </div>
  );
};

export default PyCodeEditor;
