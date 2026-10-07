/**
 * 笔记页 AI 面板和知识空间 AI 助手共用的附件规则（2026-10-07）。
 *
 * 只挂附件、没写问题不能发：存下来的提问必须是学生自己的话。以前笔记页替学生补一句
 * 「看看这张图，说说你看到了什么。」当成提问存进库、进研究导出（附的是文档也这么说）；
 * 知识空间那边直接发出去，被后端以「content is required」拒掉，附件还丢了。
 */

type Lang = 'zh' | 'en';

/** 挂了附件、还没写问题时，输入框里的提示 */
export function attachmentQuestionHint(attachments: ReadonlyArray<{ mime_type: string }>, lang: Lang): string {
  const zh = lang === 'zh';
  if (attachments.length > 1) {
    return zh ? '想问这些附件什么？写一句再发送' : 'What do you want to ask about these attachments? Type a question to send.';
  }
  if (attachments[0]?.mime_type.startsWith('image/')) {
    return zh ? '想问这张图什么？写一句再发送' : 'What do you want to ask about this image? Type a question to send.';
  }
  return zh ? '想问这份文件什么？写一句再发送' : 'What do you want to ask about this file? Type a question to send.';
}

/**
 * 发送出错，把这一轮带的附件放回输入框。这一轮的排前面，等回答时又挂上的跟在后面；
 * 同一个文件只留一份，最多 4 个（和上传按钮的上限一样）。
 */
export function restoreTurnAttachments<T extends { file_url: string }>(turn: readonly T[], current: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...turn, ...current]
    .filter(a => (seen.has(a.file_url) ? false : (seen.add(a.file_url), true)))
    .slice(0, 4);
}
