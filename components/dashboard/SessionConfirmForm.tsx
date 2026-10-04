/**
 * 一次课的确认表单：上了 / 调课 / 没上。
 *
 * 教学日志页和登录后的补记提示共用同一份 —— 两处各写一份的话，
 * 「调课要不要填新时间」这类规则迟早在一处漏掉。
 */
import React, { useState } from 'react';
import { Check, CalendarClock, X, Loader2 } from 'lucide-react';
import { courseSessions, type CourseSession, type SessionStatus } from '../../services/apiClient';
import { inputClass } from '../courseSettings/scheduleShared';

interface Props {
  session: CourseSession;
  zh: boolean;
  onDone: (session: CourseSession) => void;
  onCancel?: () => void;
}

type Choice = Exclude<SessionStatus, 'planned'>;

const SessionConfirmForm: React.FC<Props> = ({ session, zh, onDone, onCancel }) => {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [actualDate, setActualDate] = useState(session.plannedDate);
  const [actualStart, setActualStart] = useState(session.plannedStart);
  const [actualMinutes, setActualMinutes] = useState(String(session.plannedMinutes));
  const [movedDate, setMovedDate] = useState('');
  const [movedStart, setMovedStart] = useState(session.plannedStart);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!choice) return;
    if (choice === 'rescheduled' && !movedDate) {
      setError(zh ? '请选择调整到哪一天。' : 'Please pick the new date.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { session: updated } = await courseSessions.confirm(session.id, {
        status: choice,
        ...(choice === 'held' ? {
          actual_date: actualDate,
          actual_start: actualStart,
          actual_minutes: Number(actualMinutes) || session.plannedMinutes,
        } : {}),
        ...(choice === 'rescheduled' ? { moved_to_date: movedDate, moved_to_start: movedStart } : {}),
        ...(choice === 'cancelled' && reason.trim() ? { cancel_reason: reason.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone(updated);
    } catch (err: any) {
      setError(err?.message ?? (zh ? '保存失败' : 'Failed to save'));
      setSaving(false);
    }
  };

  const choiceButton = (value: Choice, icon: React.ReactNode, label: string, tone: string) => (
    <button
      type="button"
      onClick={() => { setChoice(value); setError(null); }}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.98] ${
        choice === value ? tone : 'border-stone-200 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900'
      }`}
    >
      {icon}{label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {choiceButton('held', <Check size={15} />, zh ? '上课了' : 'Held',
          'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300')}
        {choiceButton('rescheduled', <CalendarClock size={15} />, zh ? '调课' : 'Rescheduled',
          'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300')}
        {choiceButton('cancelled', <X size={15} />, zh ? '没上' : 'Cancelled',
          'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200')}
      </div>

      {choice === 'held' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input type="date" value={actualDate} onChange={e => setActualDate(e.target.value)} className={inputClass} />
          <input type="time" value={actualStart} onChange={e => setActualStart(e.target.value)} className={inputClass} />
          <div className="flex items-center gap-1.5">
            <input type="number" min={5} max={600} step={5} value={actualMinutes} onChange={e => setActualMinutes(e.target.value)} className={inputClass} />
            <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{zh ? '分钟' : 'min'}</span>
          </div>
        </div>
      )}

      {choice === 'rescheduled' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input type="date" value={movedDate} onChange={e => setMovedDate(e.target.value)} className={inputClass} />
          <input type="time" value={movedStart} onChange={e => setMovedStart(e.target.value)} className={inputClass} />
        </div>
      )}

      {choice === 'cancelled' && (
        <input
          type="text"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={zh ? '原因（可选，如：法定假日、临时会议）' : 'Reason (optional)'}
          className={inputClass}
        />
      )}

      {choice && (
        <>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={zh ? '备注（可选）' : 'Note (optional)'}
            className={inputClass}
          />
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[#000080] px-3.5 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {zh ? '确认记录' : 'Confirm'}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-stone-200 px-3.5 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
              >
                {zh ? '稍后再说' : 'Later'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default SessionConfirmForm;
