import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MORANDI, noticeStyle } from './morandiPalette';
import { X, Loader2, AlertCircle, CornerDownRight, Sparkles, MessageCircle, StickyNote, Crosshair } from 'lucide-react';
import { notes as notesApi, type TimelineItem } from '../services/apiClient';
import { RELATION_COLORS, RELATION_LABELS } from './relationColors';

/**
 * 知识空间的时间线。
 *
 * 不是活动日志。它回答的是「这个空间里的知识是怎么一步步长出来的」，
 * 所以只收四种真正推进知识的事件：观点发布、Build-on、AI 反馈、AI 对话开启。
 * 打开过、登录过这类埋点不进来——那是研究导出的事，不是学生该看的。
 *
 * 顶上一条**节奏条**：按天的活动量。学生看一眼就知道这周热不热、
 * 哪几天沉寂了；老师看一眼就知道课上课下的落差。这是列表给不了的。
 *
 * 「只看我的」不是筛掉别人，而是把别人的淡化——你的动作要放在
 * 全组的节奏里看才有意义：你活跃的那天大家在干嘛？
 */

interface Props {
  spaceId: string;
  currentUserId?: string;
  lang: 'zh' | 'en';
  onLocateNote?: (noteId: string) => void;
  onClose: () => void;
}

type Kind = TimelineItem['kind'];
const KINDS: Kind[] = ['note', 'build_on', 'ai_feedback', 'ai_chat'];

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const SpaceTimeline: React.FC<Props> = ({ spaceId, currentUserId, lang, onLocateNote, onClose }) => {
  const zh = lang === 'zh';
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(KINDS));
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    notesApi.timeline(spaceId)
      .then(({ items: loaded }) => { if (!cancelled) setItems(loaded); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load timeline'); });
    return () => { cancelled = true; };
  }, [spaceId]);

  const t = zh ? {
    title: '时间线',
    sub: '本空间的知识建构历程：观点如何逐步生成与推进。',
    mine: '只看我的',
    kinds: { note: '观点', build_on: 'Build-on', ai_feedback: 'AI 反馈', ai_chat: 'AI 对话' } as Record<Kind, string>,
    empty: '尚无建构活动。',
    emptyFiltered: '当前筛选条件下没有活动。',
    today: '今天',
    yesterday: '昨天',
    locate: '在画布中定位',
    builtOn: '建构于',
    ofPeer: '的',
    aiNote: 'AI 生成',
    feedbackStatus: { pending: '待处理', accepted: '已采纳', dismissed: '已忽略', ignored: '已忽略' } as Record<string, string>,
    startedChat: '发起了一次 AI 对话',
    onNote: '关于',
    dayTotal: '条',
    rhythm: '每日建构活动量，点击某一天可跳转至当天。',
    quietSince: (n: number) => `已有 ${n} 天未出现新观点`,
    close: '关闭',
    anonymous: '同学',
    you: '你',
  } : {
    title: 'Timeline',
    sub: 'How knowledge in this space was built, step by step.',
    mine: 'Mine only',
    kinds: { note: 'Ideas', build_on: 'Build-ons', ai_feedback: 'AI feedback', ai_chat: 'AI chats' } as Record<Kind, string>,
    empty: 'No activity yet.',
    emptyFiltered: 'Nothing matches this filter.',
    today: 'Today',
    yesterday: 'Yesterday',
    locate: 'Find on canvas',
    builtOn: 'built on',
    ofPeer: "'s",
    aiNote: 'AI-generated',
    feedbackStatus: { pending: 'pending', accepted: 'accepted', dismissed: 'dismissed', ignored: 'ignored' } as Record<string, string>,
    startedChat: 'started an AI conversation',
    onNote: 'about',
    dayTotal: 'events',
    rhythm: 'Activity per day. Click a day to jump to it.',
    quietSince: (n: number) => `No new ideas for ${n} days`,
    close: 'Close',
    anonymous: 'a peer',
    you: 'you',
  };

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter(it => {
      if (!kinds.has(it.kind)) return false;
      if (mineOnly && currentUserId) {
        const involvesMe = it.actorId === currentUserId || it.targetActorId === currentUserId;
        if (!involvesMe) return false;
      }
      return true;
    });
  }, [items, kinds, mineOnly, currentUserId]);

  /** 按天分组，最近的在最上面。节奏条用的是**未筛选**的全量，筛选只影响列表。 */
  const days = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const it of filtered) {
      const k = dayKey(it.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, list]) => ({ key, list: list.slice().sort((a, b) => b.at.localeCompare(a.at)) }));
  }, [filtered]);

  const rhythm = useMemo(() => {
    if (!items || items.length === 0) return [] as Array<{ key: string; total: number; mine: number }>;
    const counts = new Map<string, { total: number; mine: number }>();
    for (const it of items) {
      const k = dayKey(it.at);
      const c = counts.get(k) ?? { total: 0, mine: 0 };
      c.total += 1;
      if (currentUserId && (it.actorId === currentUserId || it.targetActorId === currentUserId)) c.mine += 1;
      counts.set(k, c);
    }
    // 补齐中间没有活动的日子——沉寂本身就是信息，跳过它节奏条会撒谎
    const keys = [...counts.keys()].sort();
    const out: Array<{ key: string; total: number; mine: number }> = [];
    const cursor = new Date(keys[0]);
    const last = new Date(keys[keys.length - 1]);
    while (cursor <= last) {
      const k = dayKey(cursor.toISOString());
      out.push({ key: k, ...(counts.get(k) ?? { total: 0, mine: 0 }) });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out.slice(-60);
  }, [items, currentUserId]);

  const quietDays = useMemo(() => {
    if (!items) return 0;
    const lastNote = [...items].reverse().find(it => it.kind === 'note');
    if (!lastNote) return 0;
    return Math.floor((Date.now() - new Date(lastNote.at).getTime()) / 86_400_000);
  }, [items]);

  const dayLabel = (key: string) => {
    const todayKey = dayKey(new Date().toISOString());
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (key === todayKey) return t.today;
    if (key === dayKey(y.toISOString())) return t.yesterday;
    const d = new Date(key);
    return zh
      ? `${d.getMonth() + 1}月${d.getDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}`
      : d.toLocaleDateString('en', { month: 'short', day: 'numeric', weekday: 'short' });
  };

  const timeOf = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const who = (id: string | null, name: string | null) =>
    id && id === currentUserId ? t.you : (name || t.anonymous);

  const jumpToDay = (key: string) => {
    setActiveDay(key);
    listRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)
      ?.scrollIntoView({ block: 'start' });
  };

  const toggleKind = (k: Kind) => setKinds(prev => {
    const next = new Set(prev);
    if (next.has(k)) { if (next.size > 1) next.delete(k); } else next.add(k);
    return next;
  });

  const maxTotal = Math.max(1, ...rhythm.map(r => r.total));

  const iconOf = (kind: Kind) => {
    if (kind === 'note') return <StickyNote size={13} />;
    if (kind === 'build_on') return <CornerDownRight size={13} />;
    if (kind === 'ai_feedback') return <Sparkles size={13} />;
    return <MessageCircle size={13} />;
  };

  const renderItem = (it: TimelineItem) => {
    const mine = Boolean(currentUserId && (it.actorId === currentUserId || it.targetActorId === currentUserId));
    const canLocate = Boolean(it.noteId && onLocateNote);
    const accent = it.kind === 'build_on'
      ? (RELATION_COLORS[it.relationType ?? ''] ?? '#94a3b8')
      : it.kind === 'ai_feedback' || it.kind === 'ai_chat' ? '#000080' : '#71717a';

    return (
      <li key={it.id} className="group flex gap-3">
        <div className="flex w-11 shrink-0 flex-col items-end pt-0.5">
          <span className="text-[0.6875rem] tabular-nums text-zinc-400">{timeOf(it.at)}</span>
        </div>
        <div className="relative flex flex-col items-center">
          <span
            className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 bg-white text-zinc-600 dark:bg-gray-900"
            style={{ borderColor: accent, color: accent }}
          >
            {iconOf(it.kind)}
          </span>
          <span className="w-px flex-1 bg-zinc-200 dark:bg-gray-800" />
        </div>
        <div className="min-w-0 flex-1 pb-4">
          <div className="text-[0.8125rem] leading-6 text-zinc-800 dark:text-gray-200">
            <span className={`font-semibold ${mine ? 'text-[#000080] dark:text-[#93AAFD]' : ''}`}>
              {who(it.actorId, it.actorName)}
            </span>
            {it.kind === 'note' && (
              <>
                {' '}{zh ? '发布了观点' : 'posted an idea'}
                {it.aiGenerated && (
                  <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[0.625rem] font-semibold text-zinc-500 dark:bg-gray-800">
                    {t.aiNote}
                  </span>
                )}
              </>
            )}
            {it.kind === 'build_on' && (
              <>
                {' '}{t.builtOn}{' '}
                <span className="font-medium">{who(it.targetActorId ?? null, it.targetActorName ?? null)}</span>
                {zh ? '' : t.ofPeer}{' '}
                <span className="rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white" style={{ backgroundColor: accent }}>
                  {(it.relationType && RELATION_LABELS[lang]?.[it.relationType]) ?? it.relationType ?? 'Build-on'}
                </span>
              </>
            )}
            {it.kind === 'ai_feedback' && (
              <>
                {' '}{zh ? '收到 AI 反馈' : 'received AI feedback'}
                {it.status && (
                  <span className="ml-1.5 text-[0.6875rem] text-zinc-500">· {t.feedbackStatus[it.status] ?? it.status}</span>
                )}
              </>
            )}
            {it.kind === 'ai_chat' && <>{' '}{t.startedChat}</>}
          </div>

          {(it.noteTitle || it.targetNoteTitle) && (
            <button
              type="button"
              disabled={!canLocate}
              onClick={() => it.noteId && onLocateNote?.(it.noteId)}
              className="mt-1 flex max-w-full items-start gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/70 px-2.5 py-1.5 text-left text-[0.75rem] leading-5 text-zinc-700 transition-colors hover:border-[#000080]/30 hover:bg-white disabled:cursor-default disabled:hover:border-zinc-200 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
              title={canLocate ? t.locate : undefined}
            >
              {canLocate && <Crosshair size={12} className="mt-1 shrink-0 text-zinc-400 group-hover:text-[#000080]" />}
              <span className="min-w-0">
                <span className="line-clamp-1 font-medium">{it.noteTitle || '（无标题）'}</span>
                {it.kind === 'build_on' && it.targetNoteTitle && (
                  <span className="line-clamp-1 text-zinc-500 dark:text-gray-400">
                    ↳ {it.targetNoteTitle}
                  </span>
                )}
              </span>
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="text-[1.0625rem] font-bold tracking-tight text-zinc-900 dark:text-gray-100">{t.title}</h2>
            <p className="mt-0.5 text-[0.75rem] leading-5 text-zinc-500 dark:text-gray-400">{t.sub}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {items === null && !error && (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-zinc-500">
            <Loader2 size={16} className="animate-spin" />{zh ? '正在整理时间线…' : 'Building the timeline…'}
          </div>
        )}
        {error && (
          <div className="mx-6 my-6 flex items-start gap-2 rounded-xl border p-3 text-sm" style={noticeStyle(MORANDI.rose)}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />{error}
          </div>
        )}

        {items && items.length === 0 && (
          <p className="py-24 text-center text-sm text-zinc-500">{t.empty}</p>
        )}

        {items && items.length > 0 && (
          <>
            {/* 节奏条 */}
            <div className="border-b border-zinc-100 px-6 pb-3 pt-4 dark:border-gray-800">
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-[0.6875rem] text-zinc-500 dark:text-gray-400">{t.rhythm}</p>
                {quietDays >= 3 && (
                  <p className="text-[0.6875rem] font-medium text-[#C27C7C]">{t.quietSince(quietDays)}</p>
                )}
              </div>
              <div className="flex h-14 items-end gap-[3px]" role="img" aria-label={t.rhythm}>
                {rhythm.map(r => {
                  const h = r.total === 0 ? 2 : Math.max(4, Math.round((r.total / maxTotal) * 52));
                  const hm = r.mine === 0 ? 0 : Math.max(3, Math.round((r.mine / maxTotal) * 52));
                  const isActive = activeDay === r.key;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => r.total > 0 && jumpToDay(r.key)}
                      title={`${dayLabel(r.key)} · ${r.total} ${t.dayTotal}${r.mine ? ` · ${t.you} ${r.mine}` : ''}`}
                      className="group/bar relative flex-1 rounded-t-sm transition-colors disabled:cursor-default"
                      disabled={r.total === 0}
                      style={{ height: h, backgroundColor: isActive ? '#000080' : r.total === 0 ? '#e4e4e7' : '#c7d2fe' }}
                    >
                      {hm > 0 && (
                        <span
                          className="absolute inset-x-0 bottom-0 rounded-t-sm bg-[#000080]"
                          style={{ height: hm }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 筛选 */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-6 py-2.5 dark:border-gray-800">
              {KINDS.map(k => {
                const on = kinds.has(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleKind(k)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors ${
                      on
                        ? 'border-[#000080]/30 bg-[#000080]/[0.07] text-[#000080] dark:border-[#4169E1]/30 dark:bg-[#4169E1]/[0.12] dark:text-[#93AAFD]'
                        : 'border-zinc-200 text-zinc-400 hover:border-zinc-300 dark:border-gray-700'
                    }`}
                  >
                    {iconOf(k)}{t.kinds[k]}
                  </button>
                );
              })}
              {currentUserId && (
                <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[0.75rem] text-zinc-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={mineOnly}
                    onChange={e => setMineOnly(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#000080]"
                  />
                  {t.mine}
                </label>
              )}
            </div>

            {/* 列表 */}
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {days.length === 0 ? (
                <p className="py-16 text-center text-sm text-zinc-500">{t.emptyFiltered}</p>
              ) : days.map(day => (
                <section key={day.key} data-day={day.key} className="mb-2">
                  <h3 className="sticky top-0 z-10 -mx-6 mb-3 bg-white/95 px-6 py-1.5 text-[0.75rem] font-bold text-zinc-500 backdrop-blur dark:bg-gray-900/95 dark:text-gray-400">
                    {dayLabel(day.key)}
                    <span className="ml-2 font-normal text-zinc-400">{day.list.length} {t.dayTotal}</span>
                  </h3>
                  <ul>{day.list.map(renderItem)}</ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SpaceTimeline;
