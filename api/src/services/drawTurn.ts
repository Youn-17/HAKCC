import type { Response } from 'express';
import { supabase } from '../config/supabase';
import { generateNoteImage } from './noteImage';

/**
 * 助手对话里的一轮绘图：学生说了「画一张……」（drawIntent），不经对话模型，直接出图（DMX 优先，见 noteImage）。
 * 知识空间助手和「AI 对话」（学生首页、教师助手）都走这里；笔记 AI 助手有自己的出图接口，前端识别后直接调它。
 *
 * 推流格式和对话一样，旧前端也能显示：
 *   {drawing: {prompt}}  → 新前端据此放绘图动画（旧前端忽略）；
 *   {token: markdown}    → 图片以 markdown 推出去，对话界面照常渲染；
 *   {assistantMessage} {done} [DONE]。
 * 失败推 {error}，也存一条失败的助手消息：研究数据里这一轮不能凭空消失。
 */
export async function streamDrawTurn(res: Response, opts: {
  courseId: string;
  conversationId: string;
  prompt: string;
  userId: string;
  spaceId: string | null;
  /** ai_interventions.trigger_type，区分是哪个助手里画的 */
  triggerType: string;
}): Promise<void> {
  const zh = /[一-龥]/.test(opts.prompt);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: unknown) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* 连接已断 */ }
  };
  // 画一张要几秒到半分钟，中间不发东西的话 nginx 和浏览器会以为连接死了
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { /* 连接已断 */ }
  }, 10_000);

  try {
    send({ drawing: { prompt: opts.prompt } });
    const result = await generateNoteImage(opts.courseId, opts.prompt);

    if (!result.ok) {
      const text = `${zh ? '这张图没有画成：' : 'The image could not be generated: '}${result.error}`;
      await supabase.from('agent_messages').insert({
        conversation_id: opts.conversationId,
        role: 'assistant',
        content: text,
        ai_metadata: { direct_image: true, failed: true },
      });
      send({ error: text });
    } else {
      const alt = opts.prompt.slice(0, 60).replace(/[[\]]/g, '');
      const markdown = `![${alt}](${result.url})`;
      send({ token: markdown });
      const { data: saved } = await supabase.from('agent_messages').insert({
        conversation_id: opts.conversationId,
        role: 'assistant',
        content: markdown,
        tools_used: ['generate_image'],
        ai_metadata: { direct_image: true, provider_id: result.provider, model: result.model, image_url: result.url },
      }).select('id').single();
      send({ assistantMessage: { id: saved?.id ?? null, content: markdown, tools_used: ['generate_image'] } });
      await supabase.from('ai_interventions').insert({
        space_id: opts.spaceId,
        user_id: opts.userId,
        trigger_type: opts.triggerType,
        provider_id: result.provider,
        model_name: result.model,
        input_context_summary: opts.prompt.slice(0, 200),
        response_text: result.url.slice(0, 500),
        visibility_scope: 'private',
      });
    }

    await supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', opts.conversationId);
    send({ done: true, conversationId: opts.conversationId, toolsUsed: result.ok ? ['generate_image'] : [], iterations: 0 });
    try { res.write('data: [DONE]\n\n'); } catch { /* 连接已断 */ }
  } catch (err) {
    send({ error: err instanceof Error ? err.message : 'Drawing failed' });
    try { res.write('data: [DONE]\n\n'); } catch { /* 连接已断 */ }
  } finally {
    clearInterval(keepalive);
    res.end();
  }
}
