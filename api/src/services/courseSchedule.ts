/**
 * 课程教学安排：把「开课日 + 周数 + 每周时段」展开成一份完整的课次表。
 *
 * 预生成整学期而不是上了才记：「计划 16 次、实际 14 次」这个数只有在没上的那两次
 * 也存在时才算得出来；教师隔几天登录看到的也才是一份待确认清单，而不是空白。
 */

export interface ScheduleSlot {
  /** 1=周一 … 7=周日。用 ISO 的编号，避免和 JS 的 0=周日 混淆。 */
  weekday: number;
  /** "HH:MM" */
  start: string;
  minutes: number;
}

export interface PlannedSession {
  sessionNo: number;
  weekNo: number;
  plannedDate: string;   // YYYY-MM-DD
  plannedStart: string;  // HH:MM
  plannedMinutes: number;
  plannedAt: string;     // ISO，按课程时区换算后的绝对时刻
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normalizeSchedule(raw: unknown): ScheduleSlot[] {
  if (!Array.isArray(raw)) return [];
  const slots: ScheduleSlot[] = [];
  for (const item of raw) {
    const weekday = Number((item as any)?.weekday);
    const start = String((item as any)?.start ?? '');
    const minutes = Number((item as any)?.minutes);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;
    if (!TIME_RE.test(start)) continue;
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) continue;
    slots.push({ weekday, start, minutes: Math.round(minutes) });
  }
  // 一周内按星期和时间排好，课次编号才和实际上课顺序一致
  slots.sort((a, b) => (a.weekday - b.weekday) || a.start.localeCompare(b.start));
  // 同一个星期同一时间只留一个
  return slots.filter((s, i) => i === 0 || s.weekday !== slots[i - 1].weekday || s.start !== slots[i - 1].start);
}

/**
 * 把某个时区的「日期 + 墙上时间」换算成绝对时刻。
 *
 * 不引时区库：先把这串数字当成 UTC 解释，再用目标时区把它格式化回来，
 * 两者之差就是该时刻的时区偏移。这样能自动处理夏令时 —— 偏移是按那一天算的，
 * 不是写死的常数。
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  if (Number.isNaN(naive.getTime())) throw new Error(`无效的日期时间：${dateStr} ${timeStr}`);

  let parts: Record<string, string>;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    parts = Object.fromEntries(fmt.formatToParts(naive).map(p => [p.type, p.value]));
  } catch {
    // 时区名不认识就按 UTC 处理，总比整条链路失败好
    return naive;
  }

  // Intl 在 hour12:false 下午夜可能给出 "24"
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second),
  );
  return new Date(naive.getTime() - (asUtc - naive.getTime()));
}

/** 从 startDate 起，第一次落在 weekday（1-7）的日期。 */
function firstOccurrence(startDate: string, weekday: number): Date {
  const base = new Date(`${startDate}T00:00:00Z`);
  // getUTCDay: 0=周日；转成 ISO 的 1..7
  const baseIso = base.getUTCDay() === 0 ? 7 : base.getUTCDay();
  const delta = (weekday - baseIso + 7) % 7;
  base.setUTCDate(base.getUTCDate() + delta);
  return base;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface GenerateParams {
  startDate: string;
  totalWeeks: number;
  schedule: ScheduleSlot[];
  timezone: string;
}

/** 上限：一学期不会有几千节课，超出多半是填错了参数。 */
const MAX_SESSIONS = 400;

export function generateSessions(params: GenerateParams): PlannedSession[] {
  const { startDate, totalWeeks, timezone } = params;
  const schedule = normalizeSchedule(params.schedule);
  if (!startDate || !Number.isInteger(totalWeeks) || totalWeeks < 1 || schedule.length === 0) return [];

  const rows: Omit<PlannedSession, 'sessionNo'>[] = [];
  for (const slot of schedule) {
    const first = firstOccurrence(startDate, slot.weekday);
    for (let week = 0; week < totalWeeks; week++) {
      const day = new Date(first.getTime());
      day.setUTCDate(day.getUTCDate() + week * 7);
      const plannedDate = toDateStr(day);
      rows.push({
        weekNo: week + 1,
        plannedDate,
        plannedStart: slot.start,
        plannedMinutes: slot.minutes,
        plannedAt: zonedTimeToUtc(plannedDate, slot.start, timezone).toISOString(),
      });
      if (rows.length >= MAX_SESSIONS) break;
    }
    if (rows.length >= MAX_SESSIONS) break;
  }

  // 按真实先后排序再编号：一周多个时段时，课次号必须跟着实际上课顺序走
  rows.sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
  return rows.map((row, i) => ({ ...row, sessionNo: i + 1 }));
}

/** 总学时 = 所有课次的分钟数 / 60，四舍五入到 0.5。 */
export function estimateCreditHours(sessions: PlannedSession[]): number {
  const minutes = sessions.reduce((sum, s) => sum + s.plannedMinutes, 0);
  return Math.round((minutes / 60) * 2) / 2;
}
