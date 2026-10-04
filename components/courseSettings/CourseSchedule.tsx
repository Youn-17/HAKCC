import React, { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Info } from 'lucide-react';
import { Language } from '../../types';
import { courseSessions, type CourseSession, type CourseType, type ScheduleSlot } from '../../services/apiClient';
import {
  COURSE_TYPES, ScheduleSlotsEditor, estimateHours, inputClass, labelClass, weekdayLabel,
} from './scheduleShared';

interface Props {
  courseId: string;
  lang: Language;
}

const DEFAULT_SLOT: ScheduleSlot = { weekday: 1, start: '14:00', minutes: 90 };

/** 默认开课日填今天，教师改成实际开课那天即可 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const CourseSchedule: React.FC<Props> = ({ courseId, lang }) => {
  const zh = lang === 'zh';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [courseType, setCourseType] = useState<CourseType | null>(null);
  const [creditHours, setCreditHours] = useState<string>('');
  const [totalWeeks, setTotalWeeks] = useState<string>('16');
  const [startDate, setStartDate] = useState<string>(today());
  const [slots, setSlots] = useState<ScheduleSlot[]>([DEFAULT_SLOT]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    courseSessions.list(courseId)
      .then(res => {
        if (!alive) return;
        setSessions(res.sessions);
        const cfg = res.config;
        if (cfg) {
          setCourseType(cfg.courseType);
          setCreditHours(cfg.creditHours != null ? String(cfg.creditHours) : '');
          if (cfg.totalWeeks != null) setTotalWeeks(String(cfg.totalWeeks));
          if (cfg.startDate) setStartDate(cfg.startDate);
          if (cfg.schedule.length > 0) setSlots(cfg.schedule);
        }
      })
      .catch(err => alive && setError(err?.message ?? (zh ? '读取失败' : 'Failed to load')))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [courseId, zh]);

  const weeks = Number(totalWeeks);
  const estimated = estimateHours(slots, weeks);
  const confirmed = sessions.filter(s => s.status !== 'planned').length;

  const handleSave = async () => {
    setError(null);
    setSaved(null);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
      setError(zh ? '持续周数请填 1–52 之间的整数。' : 'Total weeks must be an integer between 1 and 52.');
      return;
    }
    if (!creditHours.trim() || !(Number(creditHours) > 0)) {
      setError(zh ? '请填写课时。' : 'Please fill in credit hours.');
      return;
    }
    if (!startDate) {
      setError(zh ? '请选择开课日期。' : 'Please pick a start date.');
      return;
    }
    setSaving(true);
    try {
      const res = await courseSessions.saveSchedule(courseId, {
        course_type: courseType,
        credit_hours: Number(creditHours),
        total_weeks: weeks,
        start_date: startDate,
        schedule: slots,
      });
      const listed = await courseSessions.list(courseId);
      setSessions(listed.sessions);
      setSaved(zh
        ? `已排定 ${res.totalSessions} 次课${res.kept > 0 ? `，保留了 ${res.kept} 条已确认记录` : ''}。`
        : `${res.totalSessions} sessions scheduled${res.kept > 0 ? `, ${res.kept} confirmed records kept` : ''}.`);
    } catch (err: any) {
      setError(err?.message ?? (zh ? '保存失败' : 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-stone-400">
        <Loader2 size={16} className="mr-2 animate-spin" />{zh ? '加载中…' : 'Loading…'}
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="rounded-xl border border-stone-200 bg-stone-100 p-2 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
          <CalendarClock size={17} />
        </div>
        <div>
          <h3 className="text-base font-semibold tracking-tight text-stone-950 dark:text-stone-100">
            {zh ? '教学安排' : 'Teaching Schedule'}
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {zh ? '排定整学期课次，课后逐次确认，作为研究数据留存' : 'Plan the term, confirm each session afterwards'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>{zh ? '课程类型' : 'Course Type'}</label>
          <div className="flex flex-wrap gap-2">
            {COURSE_TYPES.map(type => (
              <button
                key={type.value}
                type="button"
                onClick={() => setCourseType(courseType === type.value ? null : type.value)}
                className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-all duration-200 ${
                  courseType === type.value
                    ? 'border-[#000080] bg-[#000080]/5 text-[#000080] dark:border-[#93AAFD] dark:bg-[#93AAFD]/10 dark:text-[#93AAFD]'
                    : 'border-stone-200 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900'
                }`}
              >
                {zh ? type.zh : type.en}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>{zh ? '课时' : 'Credit Hours'} <span className="text-rose-500">*</span></label>
          <input
            type="number" min={1} max={500} step={0.5}
            value={creditHours}
            onChange={e => setCreditHours(e.target.value)}
            placeholder={estimated > 0 ? String(estimated) : ''}
            className={inputClass}
          />
          {estimated > 0 && (
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {zh ? `按当前安排约 ${estimated} 学时` : `≈ ${estimated} hours by current schedule`}
              {creditHours.trim() === '' && (
                <button type="button" onClick={() => setCreditHours(String(estimated))} className="ml-2 underline underline-offset-2">
                  {zh ? '用这个值' : 'Use this'}
                </button>
              )}
            </p>
          )}
        </div>

        <div>
          <label className={labelClass}>{zh ? '持续周数' : 'Total Weeks'} <span className="text-rose-500">*</span></label>
          <input
            type="number" min={1} max={52}
            value={totalWeeks}
            onChange={e => setTotalWeeks(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>{zh ? '开课日期' : 'Start Date'} <span className="text-rose-500">*</span></label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`${inputClass} sm:max-w-xs`} />
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {zh ? '从这一天所在的那一周开始，按下面的时段逐周排课' : 'Sessions repeat weekly from this week onward'}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>{zh ? '每周上课时段' : 'Weekly Time Slots'}</label>
          <ScheduleSlotsEditor slots={slots} onChange={setSlots} zh={zh} />
        </div>
      </div>

      {confirmed > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            {zh
              ? `已确认 ${confirmed} 次课的记录会保留，重新排课只影响尚未确认的课次。`
              : `${confirmed} confirmed sessions are preserved; re-planning only affects unconfirmed ones.`}
          </span>
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
      {saved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">{saved}</div>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-[#000080] px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-50"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {zh ? '保存并排课' : 'Save & Schedule'}
        </button>
        {sessions.length > 0 && (
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {zh
              ? `当前共 ${sessions.length} 次课，首次 ${sessions[0].plannedDate} ${weekdayLabel(new Date(`${sessions[0].plannedDate}T00:00:00Z`).getUTCDay() || 7, zh)}`
              : `${sessions.length} sessions, first on ${sessions[0].plannedDate}`}
          </span>
        )}
      </div>
    </div>
  );
};

export default CourseSchedule;
