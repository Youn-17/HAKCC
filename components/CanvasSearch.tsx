import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import RemixIcon from './RemixIcon';
import type { Note } from '../types';
import { noteSearchText } from './noteText';
import { highlightParts, searchNotes, searchTokens, type SearchableNote, type SearchHit } from './canvasSearchMatch';

/**
 * 搜索笔记的框（2026-10-09）。放在顶栏课程名后面（用户要求，原来浮在画布左上角）。
 * 按标题、作者名、正文找笔记，按「/」也能把光标放进来。
 * 输入时画布上没命中的卡片变淡；点一条结果，画布移到那条笔记、打开右侧详情（详情里有「建立于此」）。
 * 被收起藏着的笔记也搜得到，点它会先展开；别的视图里的笔记单独列在后面，点了切过去。
 */

export interface CanvasSearchItem {
  note: Note;
  /** 不在当前视图：它所在视图的 id 和名字 */
  viewId?: string;
  viewTitle?: string;
  /** 在当前视图，但藏在收起的分支里 */
  folded?: boolean;
}

interface Props {
  lang: 'zh' | 'en';
  items: CanvasSearchItem[];
  onPick: (item: CanvasSearchItem) => void;
  /** 当前视图里命中的笔记；不在搜索时给 null，画布据此把没命中的卡片调淡 */
  onMatchesChange: (ids: ReadonlySet<string> | null) => void;
  hidden?: boolean;
  /** header：放在顶栏里（现在的位置）；canvas：浮在画布左上角 */
  placement?: 'header' | 'canvas';
}

const MAX_HERE = 30;
const MAX_ELSEWHERE = 10;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

const Highlighted: React.FC<{ text: string; tokens: string[] }> = ({ text, tokens }) => (
  <>
    {highlightParts(text, tokens).map((part, i) => (part.hit
      ? <mark key={i} className="rounded-sm bg-amber-100 px-px text-inherit dark:bg-amber-500/30">{part.text}</mark>
      : <React.Fragment key={i}>{part.text}</React.Fragment>))}
  </>
);

const CanvasSearch: React.FC<Props> = ({ lang, items, onPick, onMatchesChange, hidden, placement = 'header' }) => {
  const inHeader = placement === 'header';
  const zh = lang === 'zh';
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  /** 正文取字按笔记对象记住：清单换新时，只有改过的笔记重新取 */
  const textCache = useRef(new WeakMap<Note, string>());

  const searchable = useMemo(() => {
    const byId = new Map<string, CanvasSearchItem>();
    const list: SearchableNote[] = [];
    for (const item of items) {
      const n = item.note;
      if (n.type === 'view' || byId.has(n.id)) continue;
      byId.set(n.id, item);
      list.push({
        id: n.id,
        title: n.title || n.fileName || '',
        author: n.author || '',
        text: (() => {
          const cached = textCache.current.get(n);
          if (cached !== undefined) return cached;
          const text = noteSearchText(n.content);
          textCache.current.set(n, text);
          return text;
        })(),
        createdAt: n.createdAt,
      });
    }
    return { byId, list };
  }, [items]);

  const tokens = useMemo(() => searchTokens(query), [query]);
  const { here, elsewhere } = useMemo(() => {
    if (tokens.length === 0) return { here: [] as SearchHit[], elsewhere: [] as SearchHit[] };
    const hits = searchNotes(searchable.list, query, 200);
    const inView: SearchHit[] = [];
    const other: SearchHit[] = [];
    for (const hit of hits) {
      (searchable.byId.get(hit.id)?.viewId ? other : inView).push(hit);
    }
    return { here: inView, elsewhere: other };
  }, [searchable, query, tokens.length]);

  const shown = useMemo(
    () => [...here.slice(0, MAX_HERE), ...elsewhere.slice(0, MAX_ELSEWHERE)],
    [here, elsewhere],
  );
  const open = focused && tokens.length > 0;

  useEffect(() => { setActive(0); }, [query]);

  // 画布调淡：只在真的在搜（框里有字、光标在框里）时
  const matchKey = open ? here.map(h => h.id).join('|') : null;
  useEffect(() => {
    onMatchesChange(matchKey === null ? null : new Set(matchKey ? matchKey.split('|') : []));
  }, [matchKey, onMatchesChange]);
  useEffect(() => () => onMatchesChange(null), [onMatchesChange]);

  // 「/」把光标放进搜索框；正在别处打字时不抢
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (hit: SearchHit | undefined) => {
    if (!hit) return;
    const item = searchable.byId.get(hit.id);
    if (!item) return;
    inputRef.current?.blur();
    onPick(item);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => (shown.length === 0 ? 0 : (i + 1) % shown.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => (shown.length === 0 ? 0 : (i - 1 + shown.length) % shown.length));
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else inputRef.current?.blur();
    }
  };

  const renderHit = (hit: SearchHit, index: number) => {
    const item = searchable.byId.get(hit.id);
    if (!item) return null;
    const n = item.note;
    const selected = index === active;
    const title = n.title || n.fileName || (zh ? '（无标题）' : '(untitled)');
    return (
      <li
        key={hit.id}
        id={`${listId}-${index}`}
        role="option"
        aria-selected={selected}
        onMouseDown={e => e.preventDefault()}
        onMouseEnter={() => setActive(index)}
        onClick={() => pick(hit)}
        className={`cursor-pointer rounded-lg px-3 py-2 transition-colors ${selected ? 'bg-[#000080]/[0.06] dark:bg-indigo-400/15' : 'hover:bg-zinc-50 dark:hover:bg-gray-800/60'}`}
      >
        <div className="line-clamp-2 text-[0.8125rem] font-medium leading-snug text-zinc-900 dark:text-gray-100">
          <Highlighted text={title} tokens={tokens} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.6875rem] text-zinc-500 dark:text-gray-400">
          <span><Highlighted text={n.author || ''} tokens={tokens} /></span>
          {shortDate(n.createdAt) && <span aria-hidden="true">·</span>}
          {shortDate(n.createdAt) && <span className="tabular-nums">{shortDate(n.createdAt)}</span>}
          {item.folded && (
            <span className="rounded border border-zinc-200 px-1 text-zinc-500 dark:border-gray-700">{zh ? '在收起的分支里' : 'in a folded branch'}</span>
          )}
          {item.viewTitle && (
            <span className="rounded border border-zinc-200 px-1 text-zinc-500 dark:border-gray-700">{zh ? `视图：${item.viewTitle}` : `View: ${item.viewTitle}`}</span>
          )}
        </div>
        {hit.snippet && (
          <div className="mt-0.5 line-clamp-1 text-[0.6875rem] text-zinc-500 dark:text-gray-400">
            <Highlighted text={hit.snippet} tokens={tokens} />
          </div>
        )}
      </li>
    );
  };

  return (
    <div
      data-canvas-overlay
      className={`${inHeader ? 'relative' : 'absolute left-3 top-3 z-30'} ${hidden ? 'hidden' : ''}`}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
    >
      <div
        className={`flex items-center gap-2 border pl-3 pr-1.5 transition-[width,border-color] duration-200 motion-reduce:transition-none ${inHeader
          ? 'rounded-lg bg-zinc-50/90 dark:bg-gray-900/80'
          : 'rounded-xl bg-white/95 shadow-[0_6px_18px_-12px_rgba(15,23,42,0.35)] backdrop-blur-sm dark:bg-gray-900/95'} ${focused
          ? `${inHeader ? 'w-[19rem] bg-white' : 'w-[22rem]'} border-[#000080]/30 dark:border-indigo-400/40`
          : `${inHeader ? 'w-[13rem]' : 'w-[16rem]'} border-zinc-200 dark:border-gray-700`}`}
      >
        <RemixIcon name="search-line" size={inHeader ? 14 : 15} className="shrink-0 text-zinc-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder={inHeader
            ? (zh ? '搜索标题、作者、正文' : 'Search title, author, text')
            : (zh ? '搜索笔记：标题、作者、内容' : 'Search notes: title, author, text')}
          aria-label={zh ? '搜索笔记' : 'Search notes'}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown.length > 0 ? `${listId}-${active}` : undefined}
          className={`${inHeader ? 'h-8 text-[0.75rem]' : 'h-9 text-[0.8125rem]'} min-w-0 flex-1 bg-transparent text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-gray-100`}
        />
        {query ? (
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            aria-label={zh ? '清空搜索' : 'Clear search'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-gray-800"
          >
            <RemixIcon name="close-line" size={14} />
          </button>
        ) : !focused && (
          <kbd className="mr-1 shrink-0 rounded border border-zinc-200 px-1.5 font-mono text-[0.6875rem] text-zinc-400 dark:border-gray-700" aria-hidden="true">/</kbd>
        )}
      </div>

      {open && (
        <div className={`${inHeader ? 'absolute left-0 top-full z-50' : ''} mt-1.5 w-[22rem] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_-16px_rgba(15,23,42,0.35)] dark:border-gray-700 dark:bg-gray-900`}>
          <div className="border-b border-zinc-100 px-3 py-1.5 text-[0.6875rem] text-zinc-500 dark:border-gray-800 dark:text-gray-400" aria-live="polite">
            {shown.length === 0
              ? (zh ? `没有找到「${query.trim()}」` : `Nothing matches "${query.trim()}"`)
              : zh
                ? `这个视图 ${here.length} 条${elsewhere.length > 0 ? ` · 其他视图 ${elsewhere.length} 条` : ''}`
                : `${here.length} in this view${elsewhere.length > 0 ? ` · ${elsewhere.length} in other views` : ''}`}
          </div>
          {shown.length > 0 && (
            <ul id={listId} role="listbox" aria-label={zh ? '搜索结果' : 'Search results'} className="max-h-[min(60vh,28rem)] space-y-0.5 overflow-y-auto overscroll-contain p-1">
              {here.slice(0, MAX_HERE).map((hit, i) => renderHit(hit, i))}
              {elsewhere.length > 0 && (
                <li role="presentation" className="px-3 pb-0.5 pt-2 text-[0.6875rem] font-medium text-zinc-400">
                  {zh ? '其他视图' : 'Other views'}
                </li>
              )}
              {elsewhere.slice(0, MAX_ELSEWHERE).map((hit, i) => renderHit(hit, Math.min(here.length, MAX_HERE) + i))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default CanvasSearch;
