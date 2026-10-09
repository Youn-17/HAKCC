import { useCallback, useEffect, useRef, useState } from 'react';
import { scaffolds as scaffoldsApi } from '../services/apiClient';
import type { Scaffold } from '../types';

/**
 * 写笔记时的「推荐支架」（2026-10-09，服务端由 Jev 挑，见 api/src/services/scaffoldRecommend.ts）。
 *
 * 学生停笔 4 秒、草稿有二十来字、和上次问的相比又写了一些，才去问一次；推荐出来的支架显示在支架栏最上面，
 * 点了就插入，关掉的那条这篇笔记里不再推。推荐只是提示，不替学生选，也不自动插入。
 */

const WAIT_MS = 4000;
const MIN_CHARS = 20;
/** 和上次问的相比，至少多写或改了这么多字才再问 */
const MIN_CHANGE = 15;

const visibleChars = (text: string) => text.replace(/\s/g, '').length;

/** 草稿的正文：支架的话头和括号不算（那是课堂给的话，不是学生写的） */
export function draftPlainText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll('[data-scaffold-tag], [data-scaffold-bracket], [data-scaffold-remove], script, style').forEach(el => el.remove());
  doc.querySelectorAll('p, div, li, br, h1, h2, h3, blockquote').forEach(el => el.append(' '));
  return (doc.body.textContent ?? '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
}

/** 草稿里已经用了的支架 */
export function scaffoldIdsIn(html: string): string[] {
  return [...new Set([...html.matchAll(/data-scaffold-id="([^"]+)"/g)].map(m => m[1]))];
}

/** 这次值不值得再问：太短不问；和上次问的几乎一样不问 */
export function worthAsking(text: string, lastAsked: string | null): boolean {
  if (visibleChars(text) < MIN_CHARS) return false;
  if (lastAsked == null) return true;
  if (text === lastAsked) return false;
  const grown = Math.abs(visibleChars(text) - visibleChars(lastAsked));
  // 只在两边都有的长度里比开头：末尾多一个句号不算改了开头
  const n = Math.min(30, text.length, lastAsked.length);
  const samePrefix = text.slice(0, n) === lastAsked.slice(0, n);
  return grown >= MIN_CHANGE || !samePrefix;
}

export interface ScaffoldRecommendationState {
  recommended: Scaffold | null;
  /** 草稿或标题变了：重新计时 */
  onDraftChange: () => void;
  /** 关掉这条：这篇笔记里不再推它 */
  dismiss: () => void;
  /** 用了这条（插入以后）：先收起来 */
  consume: () => void;
}

export function useScaffoldRecommendation(opts: {
  courseId: string | null | undefined;
  enabled: boolean;
  noteId?: string | null;
  spaceId?: string | null;
  scaffolds: Scaffold[];
  parent?: { title: string; text: string } | null;
  /** 现在的标题和正文 HTML（编辑区是非受控的，到点再读） */
  readDraft: () => { title: string; html: string };
  recommend?: typeof scaffoldsApi.recommend;
  waitMs?: number;
}): ScaffoldRecommendationState {
  const [recommended, setRecommended] = useState<Scaffold | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAsked = useRef<string | null>(null);
  const dismissed = useRef(new Set<string>());
  const session = useRef(0);
  const latest = useRef(opts);
  latest.current = opts;

  // 换了一篇笔记：全部重来
  useEffect(() => {
    session.current += 1;
    lastAsked.current = null;
    dismissed.current = new Set();
    setRecommended(null);
    if (timer.current) clearTimeout(timer.current);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [opts.noteId, opts.courseId]);

  const run = useCallback(async () => {
    const o = latest.current;
    if (!o.enabled || !o.courseId) return;
    const { title, html } = o.readDraft();
    const text = draftPlainText(html);
    if (!worthAsking(text, lastAsked.current)) return;
    lastAsked.current = text;
    const used = scaffoldIdsIn(html);
    const mine = session.current;
    try {
      const result = await (o.recommend ?? scaffoldsApi.recommend)(o.courseId, {
        title, text, parent: o.parent ?? null, used_ids: used, note_id: o.noteId ?? null, space_id: o.spaceId ?? null,
      });
      if (mine !== session.current) return;
      const id = result.scaffold?.id;
      const match = id && !dismissed.current.has(id) && !used.includes(id) ? latest.current.scaffolds.find(s => s.id === id) ?? null : null;
      setRecommended(match);
    } catch {
      // 推荐只是提示：问不到就不显示
    }
  }, []);

  const onDraftChange = useCallback(() => {
    if (!latest.current.enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void run(); }, latest.current.waitMs ?? WAIT_MS);
  }, [run]);

  const dismiss = useCallback(() => {
    setRecommended(current => {
      if (current) dismissed.current.add(current.id);
      return null;
    });
  }, []);

  const consume = useCallback(() => setRecommended(null), []);

  return { recommended, onDraftChange, dismiss, consume };
}
