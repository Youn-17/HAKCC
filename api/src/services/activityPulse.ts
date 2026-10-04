/**
 * 概览页那三张图的真实数据。
 *
 * 在此之前，「学习活动趋势」「AI 反馈接受率」「学生参与度」三张图
 * 用的都是组件里写死的默认值 —— 每个人、每门课看到的都是同一组数字。
 * 在一个用来做研究的平台上，编出来的分析图比没有图更糟。
 *
 * 这里全部改成从 notes / events / note_ai_feedbacks 现算。
 * 没有数据就诚实地返回空，让界面去说「还没有数据」。
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** AI 反馈的三种去向。`new` 是「还没表态」，绝不能算成拒绝。 */
const ACCEPTED_STATUSES = new Set(['followed_up', 'inserted', 'accepted']);
const REJECTED_STATUSES = new Set(['ignored', 'dismissed', 'rejected']);

export interface WeekBucket {
  label: string;
  /** 周一 00:00 的时间戳，前端排序和对齐用 */
  startsAt: string;
  notes: number;
  aiInteractions: number;
}

export interface TriggerAcceptance {
  triggerType: string;
  accepted: number;
  rejected: number;
  pending: number;
  /** 只在有人表过态时才有意义；全部 pending 时为 null。 */
  rate: number | null;
}

export interface ActivityPulse {
  weeks: WeekBucket[];
  acceptance: {
    accepted: number;
    rejected: number;
    pending: number;
    rate: number | null;
    byTrigger: TriggerAcceptance[];
  };
  /** 4 周 × 7 天的活动计数，行 0 是最早的一周。 */
  heatmap: number[][];
  heatmapMax: number;
  hasData: boolean;
}

/** 把时间戳归到所属周的周一 00:00（按给定时区偏移）。 */
export function weekStart(ms: number, tzOffsetHours = 8): number {
  const shifted = ms + tzOffsetHours * 3600_000;
  const d = new Date(shifted);
  const dow = (d.getUTCDay() + 6) % 7; // 周一 = 0
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnight - dow * DAY_MS - tzOffsetHours * 3600_000;
}

export interface PulseInput {
  noteTimes: string[];
  aiTimes: string[];
  eventTimes: string[];
  feedbacks: Array<{ trigger_type: string | null; status: string | null }>;
  now?: number;
  weeks?: number;
  tzOffsetHours?: number;
}

/**
 * 纯计算，不碰数据库 —— 时间分桶和三态统计的坑都在这里，
 * 单测能直接把它们钉住。
 */
export function computePulse(input: PulseInput): ActivityPulse {
  const tz = input.tzOffsetHours ?? 8;
  const now = input.now ?? Date.now();
  const weekCount = input.weeks ?? 8;

  const currentWeek = weekStart(now, tz);
  const firstWeek = currentWeek - (weekCount - 1) * WEEK_MS;

  const weeks: WeekBucket[] = Array.from({ length: weekCount }, (_, i) => ({
    label: `W${i + 1}`,
    startsAt: new Date(firstWeek + i * WEEK_MS).toISOString(),
    notes: 0,
    aiInteractions: 0,
  }));

  const bucketOf = (iso: string): number | null => {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    const idx = Math.floor((weekStart(ms, tz) - firstWeek) / WEEK_MS);
    return idx >= 0 && idx < weekCount ? idx : null;
  };

  for (const iso of input.noteTimes) {
    const i = bucketOf(iso);
    if (i !== null) weeks[i].notes += 1;
  }
  for (const iso of input.aiTimes) {
    const i = bucketOf(iso);
    if (i !== null) weeks[i].aiInteractions += 1;
  }

  // ── 接受率 ──
  // 三态：接受 / 拒绝 / 还没表态。把「还没表态」算进分母会让接受率
  // 随时间自然下滑，那是统计口径造出来的假象，不是学生态度的变化。
  const byTrigger = new Map<string, TriggerAcceptance>();
  let accepted = 0, rejected = 0, pending = 0;

  for (const f of input.feedbacks) {
    const key = f.trigger_type ?? 'unknown';
    const row = byTrigger.get(key)
      ?? { triggerType: key, accepted: 0, rejected: 0, pending: 0, rate: null };

    const status = (f.status ?? '').toLowerCase();
    if (ACCEPTED_STATUSES.has(status)) { row.accepted += 1; accepted += 1; }
    else if (REJECTED_STATUSES.has(status)) { row.rejected += 1; rejected += 1; }
    else { row.pending += 1; pending += 1; }

    byTrigger.set(key, row);
  }

  const rateOf = (a: number, r: number) => (a + r > 0 ? Math.round((a / (a + r)) * 100) : null);
  for (const row of byTrigger.values()) row.rate = rateOf(row.accepted, row.rejected);

  // ── 热力图：最近 4 周 × 周一到周日 ──
  const heatWeeks = 4;
  const heatFirst = currentWeek - (heatWeeks - 1) * WEEK_MS;
  const heatmap: number[][] = Array.from({ length: heatWeeks }, () => new Array(7).fill(0));

  for (const iso of input.eventTimes) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    const w = Math.floor((weekStart(ms, tz) - heatFirst) / WEEK_MS);
    if (w < 0 || w >= heatWeeks) continue;
    const d = new Date(ms + tz * 3600_000);
    heatmap[w][(d.getUTCDay() + 6) % 7] += 1;
  }

  const heatmapMax = Math.max(0, ...heatmap.flat());

  return {
    weeks,
    acceptance: {
      accepted, rejected, pending,
      rate: rateOf(accepted, rejected),
      byTrigger: [...byTrigger.values()].sort((a, b) =>
        (b.accepted + b.rejected + b.pending) - (a.accepted + a.rejected + a.pending)),
    },
    heatmap,
    heatmapMax,
    hasData:
      input.noteTimes.length > 0 || input.aiTimes.length > 0 ||
      input.eventTimes.length > 0 || input.feedbacks.length > 0,
  };
}
