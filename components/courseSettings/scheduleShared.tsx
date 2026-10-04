/**
 * 教学安排的共用零件。
 *
 * 创建课程、课程设置、教学日志三处都要填/读同一份安排，做成一份共用件，
 * 免得三处的星期编号或时长默认值各写各的、对不上。
 */
import React from 'react';
import type { CourseType, ScheduleSlot } from '../../services/apiClient';

export const COURSE_TYPES: { value: CourseType; zh: string; en: string }[] = [
  { value: 'general', zh: '通识课', en: 'General' },
  { value: 'major', zh: '专业课', en: 'Major' },
  { value: 'required', zh: '必修课', en: 'Required' },
  { value: 'elective', zh: '选修课', en: 'Elective' },
];

/** 1=周一 … 7=周日，和后端 courseSchedule.ts 的 ISO 编号一致 */
export const WEEKDAYS: { value: number; zh: string; en: string }[] = [
  { value: 1, zh: '周一', en: 'Mon' },
  { value: 2, zh: '周二', en: 'Tue' },
  { value: 3, zh: '周三', en: 'Wed' },
  { value: 4, zh: '周四', en: 'Thu' },
  { value: 5, zh: '周五', en: 'Fri' },
  { value: 6, zh: '周六', en: 'Sat' },
  { value: 7, zh: '周日', en: 'Sun' },
];

export function weekdayLabel(weekday: number, zh: boolean): string {
  return WEEKDAYS.find(d => d.value === weekday)?.[zh ? 'zh' : 'en'] ?? '';
}

export function courseTypeLabel(type: string | null | undefined, zh: boolean): string {
  if (!type) return '';
  return COURSE_TYPES.find(c => c.value === type)?.[zh ? 'zh' : 'en'] ?? '';
}

/** 按当前安排估算总学时，和后端 estimateCreditHours 同一套算法 */
export function estimateHours(slots: ScheduleSlot[], weeks: number): number {
  const minutes = slots.reduce((sum, s) => sum + (s.minutes || 0), 0) * (weeks || 0);
  return Math.round((minutes / 60) * 2) / 2;
}

/** 不含宽度：时段行里要按列给固定宽度，带上 w-full 会和 w-24 打架并撑破容器 */
export const inputBase =
  'rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 outline-none transition-[box-shadow,border-color] focus:border-stone-300 focus:ring-2 focus:ring-stone-200 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:ring-stone-700';

export const inputClass = `w-full ${inputBase}`;

export const labelClass = 'mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300';

interface SlotsEditorProps {
  slots: ScheduleSlot[];
  onChange: (slots: ScheduleSlot[]) => void;
  zh: boolean;
}

/** 每周上课时段：只填星期 + 开始时间 + 时长，不涉及具体月份日期。 */
export const ScheduleSlotsEditor: React.FC<SlotsEditorProps> = ({ slots, onChange, zh }) => {
  const update = (index: number, patch: Partial<ScheduleSlot>) =>
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));

  return (
    <div className="space-y-2">
      {slots.map((slot, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[6rem_8rem_minmax(0,1fr)_auto]">
          <select
            value={slot.weekday}
            onChange={e => update(index, { weekday: Number(e.target.value) })}
            className={`${inputBase} w-full`}
          >
            {WEEKDAYS.map(d => (
              <option key={d.value} value={d.value}>{zh ? d.zh : d.en}</option>
            ))}
          </select>
          <input
            type="time"
            value={slot.start}
            onChange={e => update(index, { start: e.target.value })}
            className={`${inputBase} w-full`}
          />
          <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
            <input
              type="number"
              min={5}
              max={600}
              step={5}
              value={slot.minutes}
              onChange={e => update(index, { minutes: Number(e.target.value) })}
              className={`${inputBase} w-full min-w-0`}
            />
            <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{zh ? '分钟' : 'min'}</span>
          </div>
          <button
            type="button"
            onClick={() => onChange(slots.filter((_, i) => i !== index))}
            disabled={slots.length <= 1}
            className="shrink-0 rounded-lg border border-stone-200 px-2.5 py-2 text-xs text-stone-500 transition-colors hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800"
          >
            {zh ? '删除' : 'Remove'}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...slots, { weekday: slots[slots.length - 1]?.weekday ?? 1, start: '14:00', minutes: 90 }])}
        className="rounded-lg border border-dashed border-stone-300 px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
      >
        {zh ? '+ 增加一个时段' : '+ Add time slot'}
      </button>
    </div>
  );
};
