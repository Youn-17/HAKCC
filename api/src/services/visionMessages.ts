import type { AgentContentPart, AgentLoopMessage } from './agentLoop';
import { DMX_VISION_MODELS, NATIVE_MODELS } from './modelCatalog';

/**
 * 把学生上传的图片接进发给模型的消息里。
 *
 * 在此之前附件只存库、从来没进过模型——视觉模型都配好了，但没有任何一条路
 * 能让 AI 看到学生的手写稿或白板照。这一层负责两件事：
 *   1. 把图片附件变成 OpenAI 的 image_url content part，挂到最后一条学生消息上
 *   2. 带了图就得换一个看得懂图的模型，否则纯文本模型会直接忽略掉图片块
 */

export type ImageAttachment = {
  file_url?: string | null;
  mime_type?: string | null;
  file_name?: string | null;
};

const MAX_IMAGES_PER_TURN = 4;

export function isImageAttachment(attachment: ImageAttachment): boolean {
  const mime = attachment.mime_type ?? '';
  if (mime.startsWith('image/')) return true;
  // 有些老附件没存 mime，退回看扩展名
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(attachment.file_name ?? attachment.file_url ?? '');
}

export function imageAttachmentsToParts(attachments: ImageAttachment[]): AgentContentPart[] {
  return attachments
    .filter(isImageAttachment)
    .map(a => a.file_url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .slice(0, MAX_IMAGES_PER_TURN)
    .map(url => ({ type: 'image_url' as const, image_url: { url, detail: 'high' as const } }));
}

/**
 * 把图片块挂到最后一条学生消息上。没有图片、或没有学生消息时原样返回。
 * 只改最后一条：历史里的图片没必要每轮都重发，既费 token 又拖慢。
 */
export function attachImagesToLastUserMessage(
  messages: AgentLoopMessage[],
  attachments: ImageAttachment[],
): AgentLoopMessage[] {
  const parts = imageAttachmentsToParts(attachments);
  if (!parts.length) return messages;

  const lastUserIndex = messages.map(m => m.role).lastIndexOf('user');
  if (lastUserIndex < 0) return messages;

  const target = messages[lastUserIndex];
  const text = typeof target.content === 'string' ? target.content : '';
  const next = [...messages];
  next[lastUserIndex] = {
    ...target,
    content: [
      ...(text.trim() ? [{ type: 'text' as const, text }] : []),
      ...parts,
    ],
  };
  return next;
}

const visionIdsFor = (providerId: string): string[] => {
  if (providerId === 'dmx' || providerId === 'dmxapi') return DMX_VISION_MODELS.map(m => m.id);
  return (NATIVE_MODELS[providerId] ?? []).filter(m => m.vision).map(m => m.id);
};

export function isVisionModel(providerId: string, model: string): boolean {
  if (visionIdsFor(providerId).includes(model)) return true;
  // 型号名里带 -v / vl / vision 的基本都是视觉档，目录没收录到的也放过
  return /(^|[-_])v\d*$|vl|vision/i.test(model);
}

/**
 * 带图时该用哪个模型。当前模型本来就看得懂图就不动它；
 * 否则在同一个厂商里挑一个视觉档（enabled 里有的优先），挑不到返回 null，
 * 由调用方决定是报错还是照原样发。
 */
export function pickVisionModel(
  providerId: string,
  currentModel: string,
  enabledModels: string[] = [],
): string | null {
  if (isVisionModel(providerId, currentModel)) return currentModel;
  const candidates = visionIdsFor(providerId);
  const enabled = candidates.find(id => enabledModels.includes(id));
  return enabled ?? candidates[0] ?? null;
}
