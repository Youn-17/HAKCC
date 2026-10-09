import { supabase } from '../config/supabase';
import { decryptProviderApiKey } from './aiProviderConfig';
import { generateImage } from './modelRouter';
import { generateMinimaxImage } from './minimaxMedia';
import { persistGeneratedImage } from './generatedMedia';
import { COURSE_AI_ROW_COLUMNS, featureChoice, isDmx, type CourseAiRow } from './aiFeatureModels';

/**
 * 课程范围内的生图。智能体工具 generate_image 和「直接画一张」那条快路
 * 都走这里——两处各写一份的话迟早会漂（厂商顺序、转存、失败文案）。
 */

export type NoteImageResult =
  | { ok: true; url: string; model: string; provider: string; timings: Record<string, number> }
  | { ok: false; error: string };

/**
 * 先打哪一家：课程 AI 设置里给「生成图片」指定的；没指定就先 DMX（平台负责人 2026-09-29 定的：
 * DMX 的 key 专门用来画图），服务器上设了 AI_IMAGE_PREFER=minimax 才默认先 MiniMax。另一家留作失败时的兜底。
 * 2026-10-09 实测 DMX 豆包 Seedream 4.5 约 20s（qwen-image-plus 已下架），MiniMax image-01 约 24–35s。规则本身在 aiFeatureModels.featureChoice。
 */

export async function generateNoteImage(
  courseId: string | null,
  prompt: string,
  options: { size?: string; model?: string; aspectRatio?: string } = {},
): Promise<NoteImageResult> {
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, error: 'prompt is required' };

  // 分段计时。之前只知道「整条 38 秒」，而单独打生图接口只要 8 秒，
  // 中间那二十几秒靠猜是找不出来的。
  const timings: Record<string, number> = {};
  const mark = <T,>(key: string, run: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    return run().finally(() => { timings[key] = Date.now() - started; });
  };
  const t0 = Date.now();

  // 整门课的配置行一起读：「生成图片」的模型选择存在其中某一行的设置里
  const { data } = await mark('config', async () => await supabase
    .from('teacher_ai_configs')
    .select(COURSE_AI_ROW_COLUMNS)
    .eq('course_id', courseId));
  const configs = (data ?? []) as CourseAiRow[];

  const minimaxCfg = configs.find(c => c.provider_id === 'minimax' && c.api_key_encrypted);
  const dmxCfg = configs.find(c => isDmx(c.provider_id) && c.api_key_encrypted);
  if (!minimaxCfg && !dmxCfg) {
    return { ok: false, error: '本课程未配置 MiniMax 或 DMX，无法生成图像。' };
  }
  const choice = featureChoice('note_image', configs);

  type Generated = { url?: string; b64?: string; model: string; provider: string };
  const failures: string[] = [];

  // 每条路返回结果而不是写外部变量：写外部变量的话 TS 的控制流分析
  // 看不到闭包里的赋值，会把后面的类型收窄成 never。
  const tryDmx = async (): Promise<Generated | null> => {
    if (!dmxCfg) return null;
    try {
      const result = await generateImage({
        apiKey: decryptProviderApiKey(dmxCfg.api_key_encrypted as string),
        chatEndpoint: (dmxCfg.endpoint_url as string) || 'https://www.dmxapi.cn/v1/chat/completions',
        prompt: trimmed,
        size: options.size,
        preferredModel: choice && isDmx(choice.providerId) ? choice.model : undefined,
      });
      if (result.ok) {
        return { url: result.url, b64: result.b64, model: result.model ?? 'dmx-image', provider: 'dmx' };
      }
      failures.push(`DMX: ${result.error ?? 'failed'}`);
    } catch (err) {
      failures.push(`DMX: ${err instanceof Error ? err.message : 'failed'}`);
    }
    return null;
  };

  const tryMinimax = async (): Promise<Generated | null> => {
    if (!minimaxCfg) return null;
    const result = await generateMinimaxImage({
      apiKey: decryptProviderApiKey(minimaxCfg.api_key_encrypted as string),
      prompt: trimmed,
      model: options.model ?? (choice?.providerId === 'minimax' ? choice.model : undefined),
      aspectRatio: options.aspectRatio,
    });
    if (result.ok) {
      return { url: result.url, b64: result.b64, model: result.model, provider: 'minimax' };
    }
    failures.push(`MiniMax: ${result.error}`);
    return null;
  };

  const order = choice && isDmx(choice.providerId) ? [tryDmx, tryMinimax] : [tryMinimax, tryDmx];
  let finished: Generated | null = null;
  for (const [i, attempt] of order.entries()) {
    if (finished) break;
    finished = await mark(`generate_${i}`, attempt);
  }

  if (!finished) {
    return { ok: false, error: `生成图像失败。${failures.join('；')}` };
  }

  // 厂商回的是几小时就失效的临时签名 URL，直接嵌进笔记等于给研究语料
  // 埋一批定时裂图，所以一律先转存到我们自己的存储。
  const stored = await mark('persist', () => persistGeneratedImage({
    courseId,
    model: finished!.model,
    url: finished!.url,
    b64: finished!.b64,
  }));
  if (!stored.ok) {
    return { ok: false, error: `图片生成成功但转存失败：${stored.error}` };
  }

  timings.total = Date.now() - t0;
  console.log('[noteImage]', JSON.stringify({ model: finished.model, ...timings }));
  return { ok: true, url: stored.url, model: finished.model, provider: finished.provider, timings };
}
