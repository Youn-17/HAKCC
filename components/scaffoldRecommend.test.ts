// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Scaffold } from '../types';
import ScaffoldPicker from './ScaffoldPicker';
import { draftPlainText, scaffoldIdsIn, useScaffoldRecommendation, worthAsking, type ScaffoldRecommendationState } from './scaffoldRecommend';

/**
 * 写笔记时的「推荐支架」（2026-10-09）：停笔几秒、写够了字才问；关掉的这篇笔记里不再推；只是提示，不自动插入。
 * 服务端怎么挑见 api/src/services/scaffoldRecommend.test.ts。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const scaffold = (id: string, title: string, l2 = '表达与改进观点'): Scaffold => ({
  id, title, titleEn: title, description: title, category: 'KB', steps: [], usageCount: 0, isMandatory: false, isRecommended: false,
  metadata: { l1: 'KB', l2_zh: l2, l2_en: l2 },
} as Scaffold);

const IDEA = scaffold('aaaaaaaa-0000-4000-8000-000000000001', '我的想法/观点是');
const DISAGREE = scaffold('aaaaaaaa-0000-4000-8000-000000000002', '我不同意你的观点，理由是');

describe('草稿怎么读', () => {
  it('正文去掉支架的话头和括号；记下已经用了哪些支架', () => {
    const html = `<div data-scaffold-id="${IDEA.id}"><span data-scaffold-tag>我的想法/观点是</span><span data-scaffold-bracket>[</span><span data-scaffold-input>AI 让人懒得想</span><span data-scaffold-bracket>]</span></div><p>因为直接给答案</p>`;
    expect(draftPlainText(html)).toBe('AI 让人懒得想 因为直接给答案');
    expect(scaffoldIdsIn(html)).toEqual([IDEA.id]);
    expect(draftPlainText('')).toBe('');
  });

  it('太短不问；和上次问的几乎一样不问；多写了一些或开头改了再问', () => {
    expect(worthAsking('我觉得', null)).toBe(false);
    const first = '我觉得 AI 让人懒得动脑，因为以前查资料还要自己筛选';
    expect(worthAsking(first, null)).toBe(true);
    expect(worthAsking(first, first)).toBe(false);
    expect(worthAsking(`${first}。`, first)).toBe(false);
    expect(worthAsking(`${first}，现在直接给答案，自己想的过程就省掉了。`, first)).toBe(true);
    expect(worthAsking(`其实我不同意，${first}`, first)).toBe(true);
  });
});

describe('useScaffoldRecommendation', () => {
  let host: HTMLDivElement;
  let root: Root;
  let state: ScaffoldRecommendationState;
  let html = '';
  const recommend = vi.fn();

  function Probe(props: { noteId: string; enabled?: boolean }) {
    state = useScaffoldRecommendation({
      courseId: 'course-1', enabled: props.enabled ?? true, noteId: props.noteId, spaceId: 'space-1',
      scaffolds: [IDEA, DISAGREE], parent: { title: '原笔记', text: '原文' },
      readDraft: () => ({ title: '标题', html }), recommend, waitMs: 4000,
    });
    return null;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    recommend.mockReset();
    html = '<p>我觉得 AI 让人懒得动脑，因为以前查资料还要自己筛选，现在直接给答案。</p>';
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => { root.render(React.createElement(Probe, { noteId: 'note-1' })); });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    vi.useRealTimers();
  });

  const typeAndWait = async (ms = 4000) => {
    await act(async () => { state.onDraftChange(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  };

  it('停笔 4 秒才问，带上草稿、原笔记和已用的支架；推荐的那条显示出来', async () => {
    recommend.mockResolvedValue({ scaffold: { id: IDEA.id, title: IDEA.title, titleEn: null, group: '表达与改进观点' }, fit: 0.8, decided_by: 'jev' });
    await act(async () => { state.onDraftChange(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(recommend).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(recommend).toHaveBeenCalledWith('course-1', expect.objectContaining({
      title: '标题', parent: { title: '原笔记', text: '原文' }, used_ids: [], note_id: 'note-1', space_id: 'space-1',
    }));
    expect(state.recommended?.id).toBe(IDEA.id);
  });

  it('关掉的那条不再推；草稿没怎么变不再问', async () => {
    recommend.mockResolvedValue({ scaffold: { id: IDEA.id, title: IDEA.title, titleEn: null, group: 'g' }, fit: 0.8, decided_by: 'jev' });
    await typeAndWait();
    await act(async () => { state.dismiss(); });
    expect(state.recommended).toBeNull();
    await typeAndWait();
    expect(recommend).toHaveBeenCalledTimes(1);
    html += '<p>而且用 AI 的时候，大家第一反应就是问它，自己想的那一步被省掉了。</p>';
    await typeAndWait();
    expect(recommend).toHaveBeenCalledTimes(2);
    expect(state.recommended).toBeNull();
  });

  it('推荐的已经用在草稿里、或者不在这门课的支架里：不显示', async () => {
    html = `<div data-scaffold-id="${IDEA.id}"><span data-scaffold-tag>我的想法/观点是</span><span data-scaffold-input>AI 让人懒得动脑，因为以前查资料还要自己筛选，现在直接给答案。</span></div>`;
    recommend.mockResolvedValueOnce({ scaffold: { id: IDEA.id, title: IDEA.title, titleEn: null, group: 'g' }, fit: 0.8, decided_by: 'jev' });
    await typeAndWait();
    expect(state.recommended).toBeNull();
  });

  it('关着（只读、综合升华、没有支架）不问', async () => {
    await act(async () => { root.render(React.createElement(Probe, { noteId: 'note-1', enabled: false })); });
    await typeAndWait();
    expect(recommend).not.toHaveBeenCalled();
  });
});

describe('支架栏里的推荐', () => {
  it('最上面一块：话头、所在的组、关掉的按钮；点了才插入', () => {
    const html = renderToStaticMarkup(React.createElement(ScaffoldPicker, {
      scaffolds: [IDEA, DISAGREE], lang: 'zh', onPick: () => {}, recommended: DISAGREE,
      onPickRecommended: () => {}, onDismissRecommended: () => {}, compact: true,
    }));
    expect(html).toContain('推荐支架');
    expect(html).toContain('我不同意你的观点，理由是');
    expect(html).toContain('属于「表达与改进观点」');
    expect(html).toContain('aria-label="不用这条"');
    expect(html.indexOf('推荐支架')).toBeLessThan(html.indexOf('搜索支架'));
  });

  it('没有推荐时不占地方', () => {
    const html = renderToStaticMarkup(React.createElement(ScaffoldPicker, { scaffolds: [IDEA], lang: 'zh', onPick: () => {}, compact: true }));
    expect(html).not.toContain('推荐支架');
  });
});
