import { useSyncExternalStore } from 'react';

/**
 * AI 回答写多长：简短 / 适中 / 详细。
 *
 * 档位只是比例（约 250 / 550 / 1000 字），实际字数由后端按问题难度再调，见 api/src/services/answerLength.ts。
 * 选择记在本机，笔记页 AI 和知识空间 AI 共用一份：在一处改了，另一处也跟着变。
 */

export type AnswerLength = 'short' | 'medium' | 'long';
export const ANSWER_LENGTH_OPTIONS: readonly AnswerLength[] = ['short', 'medium', 'long'];
export const DEFAULT_ANSWER_LENGTH: AnswerLength = 'medium';

const STORAGE_KEY = 'hakcc-answer-length';

export const ANSWER_LENGTH_LABEL: Record<AnswerLength, { zh: string; en: string; hintZh: string; hintEn: string }> = {
  short: { zh: '简短', en: 'Brief', hintZh: '约 250 字，按问题难易增减', hintEn: 'About 250 characters, more or less by difficulty' },
  medium: { zh: '适中', en: 'Medium', hintZh: '约 550 字，按问题难易增减', hintEn: 'About 550 characters, more or less by difficulty' },
  long: { zh: '详细', en: 'Detailed', hintZh: '约 1000 字，按问题难易增减', hintEn: 'About 1000 characters, more or less by difficulty' },
};

function read(): AnswerLength {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'short' || raw === 'long' || raw === 'medium' ? raw : DEFAULT_ANSWER_LENGTH;
  } catch {
    return DEFAULT_ANSWER_LENGTH;
  }
}

let current: AnswerLength | null = null;
const listeners = new Set<() => void>();

export function getAnswerLength(): AnswerLength {
  if (current === null) current = typeof window === 'undefined' ? DEFAULT_ANSWER_LENGTH : read();
  return current;
}

export function setAnswerLength(next: AnswerLength): void {
  current = next;
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* 存不了就只在这次打开的页面里记住 */ }
  listeners.forEach(fn => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useAnswerLength(): [AnswerLength, (next: AnswerLength) => void] {
  const value = useSyncExternalStore(subscribe, getAnswerLength, () => DEFAULT_ANSWER_LENGTH);
  return [value, setAnswerLength];
}

/** 测试用 */
export function resetAnswerLengthForTests(): void {
  current = null;
}
