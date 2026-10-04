/**
 * 笔记详情面板里的 AI 区块：这条笔记**实际收到过**的反馈。
 *
 * 只读 note_ai_feedbacks —— 和编辑器里「AI 自动反馈」同一张表、同一批记录。
 * 这里曾经还挂着一块「介入触发」：由全空间规则检测生成、套着反馈卡样子、带
 * 采纳/忽略两个按钮，却从不写进反馈表。结果是详情页有一张卡、编辑器里却没有，
 * 学生分不清哪个才是「AI 给我的反馈」。那条链路已整体删除。
 *
 * 面板只看不操作：采纳 / 不同意 / 追问三个动作都在编辑器里，一处做，免得两处漂。
 */
import React, { useEffect, useState } from 'react';
import RemixIcon from './RemixIcon';
import { Language } from '../types';
import { noteAiFeedback as feedbackApi, type NoteAIFeedback } from '../services/apiClient';
import { MORANDI, chipStyle, ink } from './morandiPalette';
import { feedbackStatusLabel, triggerTypeLabel } from './feedbackLabels';

const STATUS_TONE: Record<string, string> = {
  accepted: MORANDI.sage,
  inserted: MORANDI.sage,
  followed_up: MORANDI.dustyBlue,
  rejected: MORANDI.rose,
  ignored: MORANDI.stone,
  new: MORANDI.ochre,
};

interface Props {
  noteId: string;
  lang: Language;
  onOpenNote: () => void;
}

const NoteAiPanel: React.FC<Props> = ({ noteId, lang, onOpenNote }) => {
  const zh = lang === 'zh';
  const l = zh ? 'zh' : 'en';
  const [feedbacks, setFeedbacks] = useState<NoteAIFeedback[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFeedbacks(null);
    feedbackApi.list(noteId, { limit: 5 })
      .then(({ feedbacks: rows }) => { if (!cancelled) setFeedbacks(rows); })
      .catch(() => { if (!cancelled) setFeedbacks([]); });
    return () => { cancelled = true; };
  }, [noteId]);

  const pending = feedbacks?.filter(f => f.status === 'new').length ?? 0;

  return (
    <div>
      <div className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-gray-400">
        {zh ? 'AI 反馈' : 'AI feedback'}
      </div>

      {feedbacks === null && (
        <div className="rounded-lg bg-gray-50 px-2.5 py-2 text-[0.6875rem] text-gray-400">
          {zh ? '正在读取⋯⋯' : 'Loading…'}
        </div>
      )}

      {feedbacks !== null && feedbacks.length === 0 && (
        <div className="rounded-lg bg-gray-50 px-2.5 py-2 text-[0.6875rem] leading-5 text-gray-500">
          {zh
            ? '这条笔记还没有收到 AI 反馈。在编辑器里继续修改内容，停下时系统会检查。'
            : 'No AI feedback on this note yet. Keep revising in the editor; it checks when you pause.'}
        </div>
      )}

      {feedbacks?.map(fb => (
        <div key={fb.id} className="mb-1.5 rounded-lg border border-gray-100 bg-white px-2.5 py-2">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold"
              style={chipStyle(STATUS_TONE[fb.status] ?? MORANDI.stone)}
            >
              {feedbackStatusLabel(fb.status, l)}
            </span>
            <span className="text-[0.625rem] text-gray-400">{triggerTypeLabel(fb.triggerType, l)}</span>
          </div>
          <p className="line-clamp-3 text-[0.6875rem] leading-5 text-gray-700">{fb.feedbackText}</p>
          {fb.publishedNoteId && (
            <p className="mt-1 flex items-center gap-1 text-[0.625rem]" style={{ color: ink(MORANDI.sage, 0.45) }}>
              <RemixIcon name="check-line" size={11} />
              {zh ? '已生成可继续对话的笔记' : 'A dialogue note was created'}
            </p>
          )}
        </div>
      ))}

      {(feedbacks?.length ?? 0) > 0 && (
        <button
          onClick={onOpenNote}
          className="mt-1 text-[0.6875rem] font-medium text-[#000080] transition-colors hover:underline"
        >
          {pending > 0
            ? (zh ? `打开笔记处理 ${pending} 条反馈 →` : `Open the note to act on ${pending} →`)
            : (zh ? '打开笔记查看 →' : 'Open the note →')}
        </button>
      )}
    </div>
  );
};

export default NoteAiPanel;
