/**
 * AI 反馈相关的中文标签，后端共用一份。措辞和前端 components/feedbackLabels.ts 一致：
 * 助手、研究导出里看到的词，和学生在界面上看到的是同一个。
 */

export const TRIGGER_TYPE_ZH: Record<string, string> = {
  undigested_ai: '未消化的 AI 内容',
  no_reasoning: '缺推理',
  no_evidence: '缺证据',
  no_connection: '缺联系',
  promising_seed: '有潜力的想法',
  unclear: '表意不清',
};

/** 学生点「不同意」时必选的归类 */
export const REJECT_TAG_LABEL: Record<string, string> = {
  misread: '误解了我的意思',
  already_considered: '我已经考虑过了',
  off_track: '和我的探究无关',
  disagree: '我不认同这个判断',
};

export function triggerTypeZh(type: string): string {
  return TRIGGER_TYPE_ZH[type] ?? type.replace(/_/g, ' ');
}

/** GenAI 支架：scaffolds.metadata.gai = true（09-29 起的「GenAI 互动支架」，含计算思维里以 GenAI 开头的那些） */
export function isGenAiScaffold(metadata: unknown): boolean {
  return !!metadata && typeof metadata === 'object' && (metadata as { gai?: unknown }).gai === true;
}
