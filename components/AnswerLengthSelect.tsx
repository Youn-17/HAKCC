import React from 'react';
import RemixIcon from './RemixIcon';
import { ANSWER_LENGTH_LABEL, ANSWER_LENGTH_OPTIONS, useAnswerLength, type AnswerLength } from './answerLengthPref';

/**
 * 输入框下面那一排里的「回答长度」：简短 / 适中 / 详细。
 * 笔记页 AI 和知识空间 AI 共用一份选择（answerLengthPref）。
 */
const AnswerLengthSelect: React.FC<{ lang: 'zh' | 'en'; disabled?: boolean }> = ({ lang, disabled }) => {
  const [value, setValue] = useAnswerLength();
  const label = ANSWER_LENGTH_LABEL[value];
  const name = lang === 'zh' ? '回答长度' : 'Answer length';
  return (
    <label
      className="assistant-answer-length relative inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white pl-2 pr-1 text-xs text-zinc-600 transition-colors hover:border-zinc-300 focus-within:border-[#000080] focus-within:ring-2 focus-within:ring-[#000080]/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
      title={`${name}: ${lang === 'zh' ? label.hintZh : label.hintEn}`}
    >
      <RemixIcon name="text-wrap" size={14} className="text-zinc-400 dark:text-gray-500" />
      <select
        aria-label={name}
        value={value}
        disabled={disabled}
        onChange={e => setValue(e.target.value as AnswerLength)}
        className="h-full cursor-pointer appearance-none bg-transparent pr-4 text-xs font-medium text-zinc-700 outline-none disabled:cursor-not-allowed dark:text-gray-200"
      >
        {ANSWER_LENGTH_OPTIONS.map(option => (
          <option key={option} value={option}>
            {lang === 'zh' ? ANSWER_LENGTH_LABEL[option].zh : ANSWER_LENGTH_LABEL[option].en}
          </option>
        ))}
      </select>
      <RemixIcon name="arrow-down-s-line" size={14} className="pointer-events-none absolute right-1 text-zinc-400" />
    </label>
  );
};

export default AnswerLengthSelect;
