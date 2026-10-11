import { supabase } from '../config/supabase';
import { ApiError } from '../middleware/errorHandler';

/**
 * 每人 24 小时的 AI 次数上限，数的是 ai_interventions 里这个人的行（和 /ai/usage 显示的同一个数）。
 * 原来只有 /ai/chat、/ai/image 会拦，2026-10-11 起两个学生智能体也在提交问题时查（harness 的 onPromptSubmit）。
 * 查询本身出错就放行：配额是兜底，不该因为它让学生问不了。
 */
export const DAILY_AI_LIMIT = 100;

export async function countDailyAiUsage(userId: string): Promise<number | null> {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('ai_interventions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since24h);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function assertDailyAiQuota(userId: string, opts: { zh?: boolean } = {}): Promise<void> {
  const used = await countDailyAiUsage(userId);
  if (used != null && used >= DAILY_AI_LIMIT) {
    throw new ApiError(429, opts.zh
      ? `这 24 小时里和 AI 的对话已经满 ${DAILY_AI_LIMIT} 次了，晚些再来问吧。`
      : `Daily AI usage limit reached (${DAILY_AI_LIMIT} interactions per 24h). Try again later.`);
  }
}
