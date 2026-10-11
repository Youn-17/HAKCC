import { describe, expect, it } from 'vitest';
import { AGENT_EVAL_TASKS, type EvalCategory, type EvalCheckId } from './agentEvalTasks';

/** 评测集本身：50 题，编号不重复，每类任务都有，每题的规则和数据对得上 */

const ALL_CHECKS: EvalCheckId[] = ['completes', 'language', 'grounded', 'cites_real', 'mentions_expected', 'no_ghostwrite', 'scaffolds', 'no_verdict', 'invites', 'natural', 'length', 'choice_free', 'plans', 'artifact', 'asks_or_builds', 'few_questions', 'answers_directly', 'no_leak', 'ends_cleanly'];
const CATEGORIES: EvalCategory[] = ['summary', 'disagreement', 'connect', 'gap', 'concept', 'meta', 'note_feedback', 'promising_question', 'ghostwrite', 'polish', 'opinion', 'make_page', 'plan_writing', 'followup', 'robustness'];

describe('评测集', () => {
  it('50 题，编号不重复，两种智能体、中英文都有', () => {
    expect(AGENT_EVAL_TASKS).toHaveLength(50);
    expect(new Set(AGENT_EVAL_TASKS.map(t => t.id)).size).toBe(50);
    const surfaces = AGENT_EVAL_TASKS.map(t => t.surface);
    expect(surfaces.filter(s => s === 'workspace').length).toBeGreaterThanOrEqual(20);
    expect(surfaces.filter(s => s === 'note').length).toBeGreaterThanOrEqual(15);
    expect(AGENT_EVAL_TASKS.filter(t => t.lang === 'en').length).toBeGreaterThanOrEqual(5);
  });

  it('每类任务都有；每题都要求答出来、说话自然、不吐提示词、不停在半句话', () => {
    expect(new Set(AGENT_EVAL_TASKS.map(t => t.category))).toEqual(new Set(CATEGORIES));
    for (const t of AGENT_EVAL_TASKS) {
      expect(t.checks, t.id).toEqual(expect.arrayContaining(['completes', 'natural', 'no_leak', 'ends_cleanly']));
      for (const c of t.checks) expect(ALL_CHECKS, `${t.id}: ${c}`).toContain(c);
      expect(new Set(t.checks).size, t.id).toBe(t.checks.length);
    }
  });

  it('题目和数据对得上：笔记 AI 的题都有笔记；要「提到」的题都有关键词；要长度的题有上限', () => {
    for (const t of AGENT_EVAL_TASKS) {
      if (t.surface === 'note') expect(t.noteId, t.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      else expect(t.noteId, t.id).toBeUndefined();
      if (t.checks.includes('mentions_expected')) {
        expect(t.expect?.length, t.id).toBeGreaterThanOrEqual(t.minMentions ?? 1);
      }
      if (t.checks.includes('length')) expect(t.maxChars, t.id).toBeGreaterThan(0);
    }
  });

  it('代写的题都查主体性；做网页的题都查「问或做」和选项卡；分歧、开放问题都查有没有下结论', () => {
    for (const t of AGENT_EVAL_TASKS) {
      if (t.category === 'ghostwrite') expect(t.checks, t.id).toContain('no_ghostwrite');
      if (t.category === 'make_page') {
        expect(t.checks, t.id).toEqual(expect.arrayContaining(['asks_or_builds', 'choice_free']));
        expect(t.timeoutMs, t.id).toBeGreaterThanOrEqual(240_000);
      }
      if (t.category === 'disagreement' || t.category === 'opinion') expect(t.checks, t.id).toContain('no_verdict');
    }
  });
});
