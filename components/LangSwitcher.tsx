import React, { useState, useRef, useEffect } from 'react';

export type Lang3 = 'zh-CN' | 'zh-TW' | 'en';
export type Lang2 = 'zh' | 'en';

/* Google-Translate-style icon: globe + "A" */
const TranslateIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const LANG3_OPTIONS: { value: Lang3; label: string }[] = [
  { value: 'zh-CN', label: 'Simplified Chinese' },
  { value: 'zh-TW', label: 'Traditional Chinese' },
  { value: 'en',    label: 'English' },
];

const LANG2_OPTIONS: { value: Lang2; label: string }[] = [
  { value: 'zh', label: 'Simplified Chinese' },
  { value: 'en', label: 'English' },
];

function Dropdown<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={() => setOpen(v => !v)}
        title="Switch language"
        className="flex items-center justify-center w-10 h-full border-l border-gray-200 dark:border-gray-800 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors cursor-pointer"
      >
        <TranslateIcon />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white/95 dark:bg-gray-950/95 backdrop-blur-xl border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg py-1 z-[200]">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer ${
                value === opt.value
                  ? 'text-[#000080] font-medium bg-[#000080]/[0.04]'
                  : 'text-gray-600 hover:bg-black/[0.03]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const LangSwitcher3: React.FC<{ value: Lang3; onChange: (v: Lang3) => void }> = ({ value, onChange }) => (
  <Dropdown value={value} onChange={onChange} options={LANG3_OPTIONS} />
);

export const LangSwitcher2: React.FC<{ value: Lang2; onChange: (v: Lang2) => void }> = ({ value, onChange }) => (
  <Dropdown value={value} onChange={onChange} options={LANG2_OPTIONS} />
);

const CYCLE: Lang3[] = ['zh-CN', 'zh-TW', 'en'];
const CYCLE_LABEL: Record<Lang3, string> = { 'zh-CN': '简', 'zh-TW': '繁', en: 'EN' };
const CYCLE_NEXT_LABEL: Record<Lang3, string> = { 'zh-CN': '繁', 'zh-TW': 'EN', en: '简' };

export const LangCycleButton: React.FC<{ value: Lang3; onChange: (v: Lang3) => void }> = ({ value, onChange }) => {
  const next = CYCLE[(CYCLE.indexOf(value) + 1) % CYCLE.length];
  return (
    <button
      onClick={() => onChange(next)}
      title={`Switch to ${CYCLE_LABEL[next]}`}
      className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors text-[0.75rem] font-semibold"
    >
      {CYCLE_NEXT_LABEL[value]}
    </button>
  );
};
