/**
 * 登录后提示教师补记未确认的课次。
 *
 * 每个登录会话最多弹一次，关掉后由侧栏「教学日志」的角标接手 ——
 * 每次切页都弹会变成噪音，教师最终只会条件反射地关掉它。
 */
import React, { useEffect, useState } from 'react';
import { X, CalendarClock } from 'lucide-react';
import { Language } from '../../types';
import { courseSessions, type CourseSession } from '../../services/apiClient';
import { weekdayLabel } from '../courseSettings/scheduleShared';
import SessionConfirmForm from './SessionConfirmForm';

interface Props {
  lang: Language;
  /** 待补记数量变化时通知外层，用于侧栏角标 */
  onCountChange?: (count: number) => void;
}

const SHOWN_KEY = 'hakcc-session-prompt-shown';

function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

const PendingSessionsPrompt: React.FC<Props> = ({ lang, onCountChange }) => {
  const zh = lang === 'zh';
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    courseSessions.pending()
      .then(res => {
        if (!alive) return;
        setSessions(res.sessions);
        onCountChange?.(res.sessions.length);
        if (res.sessions.length > 0) {
          try {
            if (sessionStorage.getItem(SHOWN_KEY)) return;
            sessionStorage.setItem(SHOWN_KEY, '1');
          } catch {
            // 隐私模式下 sessionStorage 会抛错，那就当作没记过，正常弹一次
          }
          setOpen(true);
          setActive(res.sessions[0].id);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
    // 只在挂载时取一次：这是登录后的一次性提示，不该随语言切换重弹
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDone = (updated: CourseSession) => {
    const rest = sessions.filter(s => s.id !== updated.id);
    setSessions(rest);
    onCountChange?.(rest.length);
    if (rest.length === 0) setOpen(false);
    else setActive(rest[0].id);
  };

  if (!open || sessions.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-2xl border border-stone-200 bg-white p-6 shadow-xl duration-200 animate-in zoom-in-95 dark:border-stone-800 dark:bg-stone-950">
        <button
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-300"
          aria-label={zh ? '关闭' : 'Close'}
        >
          <X size={20} />
        </button>

        <div className="mb-4 flex items-center gap-2.5 pr-8">
          <div className="rounded-xl border border-stone-200 bg-stone-100 p-2 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
            <CalendarClock size={17} />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-stone-950 dark:text-stone-100">
              {zh ? `有 ${sessions.length} 次课还没记录` : `${sessions.length} sessions to record`}
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {zh ? '确认一下是否上课，这些会进入课程的教学日志与研究数据' : 'Confirm whether these sessions were held'}
            </p>
          </div>
        </div>

        <div className="-mr-2 flex-1 space-y-2.5 overflow-y-auto pr-2">
          {sessions.map(session => (
            <div key={session.id} className="rounded-xl border border-stone-200 p-3.5 dark:border-stone-800">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                <span className="font-medium text-stone-900 dark:text-stone-100">{session.courseTitle}</span>
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {zh ? `第 ${session.sessionNo} 次课` : `Session ${session.sessionNo}`} · {session.plannedDate} {weekdayLabel(isoWeekday(session.plannedDate), zh)} {session.plannedStart}
                </span>
              </div>
              <div className="mt-2.5">
                {active === session.id ? (
                  <SessionConfirmForm session={session} zh={zh} onDone={handleDone} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setActive(session.id)}
                    className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900"
                  >
                    {zh ? '记录这次课' : 'Record'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 shrink-0 self-start text-xs text-stone-500 underline underline-offset-2 transition-colors hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
        >
          {zh ? '稍后在「教学日志」里补记' : 'Record later in Teaching Log'}
        </button>
      </div>
    </div>
  );
};

export default PendingSessionsPrompt;
