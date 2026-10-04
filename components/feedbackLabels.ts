/**
 * AI 反馈的中文/英文标签，编辑器和笔记详情面板共用。
 * 此前详情面板直接显示 `no_evidence`、`new` 这类内部标识，学生看不懂。
 */
export const TRIGGER_TYPE_LABEL: Record<string, { zh: string; en: string }> = {
  undigested_ai: { zh: '未消化的 AI 内容', en: 'Undigested AI' },
  no_reasoning: { zh: '缺推理', en: 'No reasoning' },
  no_evidence: { zh: '缺证据', en: 'No evidence' },
  no_connection: { zh: '缺联系', en: 'No connection' },
  promising_seed: { zh: '有潜力的想法', en: 'Promising idea' },
  unclear: { zh: '表意不清', en: 'Unclear' },
};

export const FEEDBACK_STATUS_LABEL: Record<string, { zh: string; en: string }> = {
  new: { zh: '待处理', en: 'Pending' },
  accepted: { zh: '已采纳', en: 'Accepted' },
  rejected: { zh: '已表示不同意', en: 'Disagreed' },
  followed_up: { zh: '已追问', en: 'Followed up' },
  inserted: { zh: '已插入笔记', en: 'Inserted' },
  ignored: { zh: '未处理', en: 'Not used' },
};

export function triggerTypeLabel(type: string, lang: 'zh' | 'en'): string {
  return TRIGGER_TYPE_LABEL[type]?.[lang] ?? type.replace(/_/g, ' ');
}
export function feedbackStatusLabel(status: string, lang: 'zh' | 'en'): string {
  return FEEDBACK_STATUS_LABEL[status]?.[lang] ?? status;
}
