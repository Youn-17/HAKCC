import React, { useCallback, useEffect, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import { support, type SupportInboxItem } from '../../services/apiClient';
import type { HelpLang } from './helpWidgetModel';

/**
 * 小球里的「学生求助」（2026-10-05 用户：教师端也要显示这个球，一是能看到学生的求助）。
 *
 * 只列等回复的，在这里直接回；学生在自己的「使用帮助」里看到。全部记录、统计、提问时的处境
 * 还在首页的「学生求助」页，底下一个按钮过去。平台管理员另外有一栏「教师转来的」。
 */

export interface HelpInboxProps {
  lang: HelpLang;
  /** 页签开着才拉，收起时不刷 */
  active: boolean;
  /** 回复了一条：小球上的数要跟着变 */
  onChanged: () => void;
  /** 去首页的「学生求助」页 */
  onOpenDesk: () => void;
}

const COPY = {
  zh: {
    waiting: (n: number) => `等你回复 · ${n}`,
    fromTeachers: (n: number) => `教师转来的 · ${n}`,
    empty: '没有等你回复的求助。',
    loadFailed: '求助没能加载。',
    retry: '再试一次',
    someone: '学生',
    note: '补充：',
    aiAnswer: 'AI 当时的回答',
    shot: (i: number) => `截图 ${i}`,
    placeholder: '写给学生的回复，⌘/Ctrl + 回车发送',
    replyTo: (name: string) => `回复${name}`,
    reply: '回复',
    sending: '正在发送',
    failed: '没发出去，请再试一次',
    replied: (name: string) => `已回复${name}。对方在自己的「使用帮助」里会看到。`,
    openDesk: '打开「学生求助」页：全部记录和统计',
    justNow: '刚刚',
    minutes: (n: number) => `${n} 分钟前`,
    hours: (n: number) => `${n} 小时前`,
    days: (n: number) => `${n} 天前`,
  },
  en: {
    waiting: (n: number) => `Waiting for you · ${n}`,
    fromTeachers: (n: number) => `From teachers · ${n}`,
    empty: 'Nothing is waiting for your reply.',
    loadFailed: 'Help requests could not be loaded.',
    retry: 'Try again',
    someone: 'A student',
    note: 'Added: ',
    aiAnswer: "The AI's answer at the time",
    shot: (i: number) => `Screenshot ${i}`,
    placeholder: 'Reply to the student, ⌘/Ctrl + Enter to send',
    replyTo: (name: string) => `Reply to ${name}`,
    reply: 'Reply',
    sending: 'Sending',
    failed: 'That did not go through. Please try again.',
    replied: (name: string) => `Replied to ${name}. They will see it in their own Help window.`,
    openDesk: 'Open Student help: all requests and counts',
    justNow: 'just now',
    minutes: (n: number) => `${n} min ago`,
    hours: (n: number) => `${n} h ago`,
    days: (n: number) => `${n} d ago`,
  },
};

type Copy = typeof COPY.zh;

function ago(iso: string | null, t: Copy): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return t.minutes(minutes);
  if (minutes < 48 * 60) return t.hours(Math.round(minutes / 60));
  return t.days(Math.round(minutes / 1440));
}

const HelpInbox: React.FC<HelpInboxProps> = ({ lang, active, onChanged, onOpenDesk }) => {
  const t = COPY[lang];
  const [data, setData] = useState<{ student: SupportInboxItem[]; teacher: SupportInboxItem[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [replied, setReplied] = useState<string | null>(null);
  const repliedTimer = useRef(0);

  const load = useCallback(() => {
    setFailed(false);
    support.inbox()
      .then(r => setData({ student: r.student, teacher: r.teacher }))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => { if (active) load(); }, [active, load]);
  useEffect(() => () => window.clearTimeout(repliedTimer.current), []);

  const reply = async (item: SupportInboxItem) => {
    const text = (drafts[item.id] ?? '').trim();
    if (!text || sendingId) return;
    setSendingId(item.id);
    setFailedId(null);
    try {
      await support.answer(item.id, text);
      setData(prev => prev && {
        student: prev.student.filter(q => q.id !== item.id),
        teacher: prev.teacher.filter(q => q.id !== item.id),
      });
      setDrafts(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setReplied(item.userName ?? t.someone);
      window.clearTimeout(repliedTimer.current);
      repliedTimer.current = window.setTimeout(() => setReplied(null), 5000);
      onChanged();
    } catch {
      setFailedId(item.id);
    } finally {
      setSendingId(null);
    }
  };

  const card = (item: SupportInboxItem) => {
    const name = item.userName ?? t.someone;
    const draft = drafts[item.id] ?? '';
    const sending = sendingId === item.id;
    return (
      <article
        key={item.id}
        className="rounded-xl border border-zinc-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-900"
      >
        <p className="flex flex-wrap items-center gap-x-1.5 text-[0.75rem] text-zinc-500 dark:text-gray-400">
          <span className="font-semibold text-zinc-700 dark:text-gray-200">{name}</span>
          {item.courseTitle && <><span aria-hidden="true">·</span><span className="truncate">{item.courseTitle}</span></>}
          <span aria-hidden="true">·</span>
          <span>{ago(item.escalatedAt ?? item.createdAt, t)}</span>
        </p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-900 dark:text-gray-100">{item.question}</p>
        {item.escalationNote && (
          <p className="mt-1.5 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-[0.8125rem] leading-relaxed text-zinc-600 dark:bg-gray-950 dark:text-gray-300">
            {t.note}{item.escalationNote}
          </p>
        )}
        {item.attachments.length > 0 && (
          <div className="mt-2 flex gap-2">
            {item.attachments.map((a, i) => (
              <a
                key={a.file_url}
                href={a.file_url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg border border-zinc-200 transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] dark:border-gray-700"
              >
                <img src={a.file_url} alt={t.shot(i + 1)} className="size-14 object-cover" />
              </a>
            ))}
          </div>
        )}
        {item.aiAnswer && (
          <details className="mt-2 group">
            <summary className="cursor-pointer select-none text-[0.75rem] text-zinc-500 transition-colors hover:text-zinc-800 dark:text-gray-400 dark:hover:text-gray-200">
              {t.aiAnswer}
            </summary>
            <p className="mt-1 whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-zinc-600 dark:text-gray-300">{item.aiAnswer}</p>
          </details>
        )}
        <div className="mt-2.5">
          <textarea
            aria-label={t.replyTo(name)}
            rows={2}
            value={draft}
            onChange={e => setDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void reply(item); }
            }}
            placeholder={t.placeholder}
            className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-base leading-relaxed text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/10 sm:text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          />
          <div className="mt-1.5 flex items-center justify-end gap-2">
            {failedId === item.id && <span role="alert" className="text-[0.75rem] text-rose-600 dark:text-rose-400">{t.failed}</span>}
            <button
              type="button"
              onClick={() => void reply(item)}
              disabled={!draft.trim() || sending}
              className="h-10 rounded-lg bg-[#000080] px-4 text-[0.8125rem] font-semibold text-white transition-[background-color,opacity,scale] duration-200 hover:bg-[#0b0b8c] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] sm:h-9 dark:bg-[#4169E1]"
            >
              {sending ? t.sending : t.reply}
            </button>
          </div>
        </div>
      </article>
    );
  };

  const total = (data?.student.length ?? 0) + (data?.teacher.length ?? 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50 p-3 dark:bg-gray-950">
        {replied && (
          <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[0.8125rem] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            {t.replied(replied)}
          </p>
        )}
        {data === null && !failed && (
          <div aria-hidden="true" className="space-y-3">
            <div className="h-28 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-gray-800" />
            <div className="h-28 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-gray-800" />
          </div>
        )}
        {failed && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-zinc-500 dark:text-gray-400">{t.loadFailed}</p>
            <button type="button" onClick={load} className="h-9 rounded-lg px-3 text-[0.8125rem] font-medium text-[#000080] transition-colors hover:bg-[#000080]/5 dark:text-[#93AAFD]">
              {t.retry}
            </button>
          </div>
        )}
        {data && total === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <RemixIcon name="inbox-line" size={28} className="text-zinc-300 dark:text-gray-600" />
            <p className="text-sm text-zinc-500 dark:text-gray-400">{t.empty}</p>
          </div>
        )}
        {data && data.student.length > 0 && (
          <section aria-label={t.waiting(data.student.length)} className="space-y-2">
            <h3 className="px-1 text-[0.75rem] font-semibold text-zinc-500 dark:text-gray-400">{t.waiting(data.student.length)}</h3>
            {data.student.map(card)}
          </section>
        )}
        {data && data.teacher.length > 0 && (
          <section aria-label={t.fromTeachers(data.teacher.length)} className="space-y-2">
            <h3 className="px-1 text-[0.75rem] font-semibold text-zinc-500 dark:text-gray-400">{t.fromTeachers(data.teacher.length)}</h3>
            {data.teacher.map(card)}
          </section>
        )}
      </div>
      <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-gray-800">
        <button
          type="button"
          onClick={onOpenDesk}
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-[0.8125rem] font-medium text-[#000080] transition-colors hover:bg-[#000080]/5 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] dark:text-[#93AAFD] dark:hover:bg-white/5"
        >
          <RemixIcon name="lifebuoy-line" size={16} />
          {t.openDesk}
        </button>
      </div>
    </div>
  );
};

export default HelpInbox;
