// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ANSWER_LENGTH, getAnswerLength, resetAnswerLengthForTests, setAnswerLength } from './answerLengthPref';

describe('回答长度的选择', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAnswerLengthForTests();
  });

  it('没选过是适中', () => {
    expect(getAnswerLength()).toBe(DEFAULT_ANSWER_LENGTH);
    expect(DEFAULT_ANSWER_LENGTH).toBe('medium');
  });

  it('选了记在本机，下次打开还在', () => {
    setAnswerLength('short');
    resetAnswerLengthForTests();
    expect(getAnswerLength()).toBe('short');
  });

  it('存的值不认识：按适中', () => {
    localStorage.setItem('hakcc-answer-length', 'huge');
    expect(getAnswerLength()).toBe('medium');
  });

  it('存储用不了也不出错', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    setAnswerLength('long');
    expect(getAnswerLength()).toBe('long');
    spy.mockRestore();
  });
});
