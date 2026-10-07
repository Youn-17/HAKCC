import { supabase } from '../config/supabase';
import { isGenAiScaffold, REJECT_TAG_LABEL, triggerTypeZh } from './feedbackLabels';

/**
 * 知识空间 AI 助手看得到的「AI 反馈」和「AI 内容插入」记录（2026-10-06 用户：总结时要能读到 AI 反馈——
 * 几条被采纳、插入 AI 内容时选的是不是 GenAI 支架；以前助手只能说「属于平台后台埋点，工具未返回」）。
 *
 * 每次提问都算一遍写进系统提示词，不做成工具：学生说「总结一下」时，模型未必想得到去调一个工具。
 *
 * 谁看得到什么，和反馈接口（GET /notes/:id/ai-feedback）一致：
 * - 课程教职：这个范围里全部的反馈和插入，并按人列出；
 * - 其他人：自己收到的反馈、自己的插入；全班的只给画布上本来就看得到的——
 *   采纳后发布成笔记的反馈条数，以及 AI 内容插入的次数和所选支架（插进去的内容和支架话头就在公开的笔记里）。
 *   别人收到几条、忽略了几条、不同意几条，只有本人和教职看得到。
 */

export interface FeedbackStatRow {
  id: string;
  note_id: string | null;
  user_id: string | null;
  trigger_type: string;
  status: string;
  rejection_tag: string | null;
  published_note_id: string | null;
  /**
   * 采纳后的去向（trigger_context.publication_review.state，10-05 起）：学生先改原笔记，
   * 贡献时判断改的有没有回应这条反馈——addressed 就不再另发笔记，否则发一条连回原笔记的（published）；
   * pending / processing / uncertain 是还没定。更早的行没有这一项。
   */
  review_state: string | null;
}

export interface InsertionStatRow {
  id: string;
  note_id: string | null;
  user_id: string | null;
  scaffold_id: string | null;
  reason_tag: string | null;
  feedback_id: string | null;
  source_message_id: string | null;
}

export interface AiInteractionData {
  feedbacks: FeedbackStatRow[];
  insertions: InsertionStatRow[];
  scaffolds: Map<string, { title: string; gai: boolean }>;
  /** 只给教职时查 */
  names: Map<string, string>;
}

const ROW_LIMIT = 2000;
const PEOPLE_MAX = 20;
const SCAFFOLDS_MAX = 6;

export async function fetchAiInteractionData(
  spaceId: string,
  opts: { noteIds?: readonly string[] | null; withNames?: boolean } = {},
): Promise<AiInteractionData> {
  const narrow = opts.noteIds && opts.noteIds.length > 0 ? [...opts.noteIds] : null;
  let feedbackQuery = supabase
    .from('note_ai_feedbacks')
    .select('id, note_id, user_id, trigger_type, status, rejection_tag, published_note_id, trigger_context')
    .eq('space_id', spaceId);
  let insertionQuery = supabase
    .from('note_ai_insertions')
    .select('id, note_id, user_id, scaffold_id, reason_tag, feedback_id, source_message_id')
    .eq('space_id', spaceId);
  if (narrow) {
    feedbackQuery = feedbackQuery.in('note_id', narrow);
    insertionQuery = insertionQuery.in('note_id', narrow);
  }
  const [feedbackRes, insertionRes] = await Promise.all([feedbackQuery.limit(ROW_LIMIT), insertionQuery.limit(ROW_LIMIT)]);
  if (feedbackRes.error) throw new Error(`note_ai_feedbacks: ${feedbackRes.error.message}`);
  if (insertionRes.error) throw new Error(`note_ai_insertions: ${insertionRes.error.message}`);
  const feedbacks: FeedbackStatRow[] = ((feedbackRes.data ?? []) as Array<Omit<FeedbackStatRow, 'review_state'> & { trigger_context?: unknown }>)
    .map(({ trigger_context, ...row }) => ({
      ...row,
      review_state: ((trigger_context as { publication_review?: { state?: unknown } } | null)?.publication_review?.state as string | undefined) ?? null,
    }));
  const insertions = (insertionRes.data ?? []) as InsertionStatRow[];

  const scaffoldIds = [...new Set(insertions.map(i => i.scaffold_id).filter((id): id is string => !!id))];
  const userIds = [...new Set([...feedbacks, ...insertions].map(r => r.user_id).filter((id): id is string => !!id))];
  const [scaffoldRes, profileRes] = await Promise.all([
    scaffoldIds.length > 0
      ? supabase.from('scaffolds').select('id, title, metadata').in('id', scaffoldIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string; metadata: unknown }>, error: null }),
    opts.withNames && userIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }>, error: null }),
  ]);
  return {
    feedbacks,
    insertions,
    scaffolds: new Map(((scaffoldRes.data ?? []) as Array<{ id: string; title: string; metadata: unknown }>)
      .map(s => [s.id, { title: s.title, gai: isGenAiScaffold(s.metadata) }])),
    names: new Map(((profileRes.data ?? []) as Array<{ id: string; full_name: string | null }>)
      .map(p => [p.id, (p.full_name ?? '').trim()])),
  };
}

const countBy = <T>(rows: readonly T[], key: (row: T) => string): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

const listCounts = (pairs: Array<[string, number]>) => pairs.map(([label, n]) => `${label} ${n}`).join(', ');

function describeFeedback(rows: readonly FeedbackStatRow[]): string {
  if (rows.length === 0) return 'none';
  const status = (s: string) => rows.filter(r => r.status === s).length;
  const adopted = rows.filter(r => r.status === 'accepted');
  const posted = adopted.filter(r => r.published_note_id || r.review_state === 'published').length;
  const answered = adopted.filter(r => !r.published_note_id && r.review_state === 'addressed').length;
  const waiting = adopted.length - posted - answered;
  const adoptedDetail = [
    `${posted} posted on the canvas as their own notes`,
    answered > 0 ? `${answered} answered by the student's own revision of the original note, so no separate note` : '',
    waiting > 0 ? `${waiting} still waiting for the student's revision` : '',
  ].filter(Boolean).join(', ');
  const rejected = rows.filter(r => r.status === 'rejected');
  const parts = [
    `${rows.length} card(s)`,
    `adopted ${adopted.length}${adopted.length > 0 ? ` (${adoptedDetail})` : ''}`,
    `put into the note text ${status('inserted')}`,
    `follow-up questions ${status('followed_up')}`,
    `disagreed ${rejected.length}${rejected.length > 0 ? ` (${listCounts(countBy(rejected, r => REJECT_TAG_LABEL[r.rejection_tag ?? ''] ?? (r.rejection_tag || 'no reason given')))})` : ''}`,
    `dismissed ${status('ignored')}`,
    `not handled yet ${status('new')}`,
  ];
  return `${parts.join('; ')}. By type: ${listCounts(countBy(rows, r => triggerTypeZh(r.trigger_type)))}.`;
}

/** withSource：分开数从反馈卡和从对话插入的。反馈卡是私人的，给学生看全班数字时不分 */
function describeInsertions(rows: readonly InsertionStatRow[], data: AiInteractionData, withSource = true): string {
  if (rows.length === 0) return 'none';
  const scaffold = (r: InsertionStatRow) => (r.scaffold_id ? data.scaffolds.get(r.scaffold_id) : undefined);
  const genAi = rows.filter(r => scaffold(r)?.gai).length;
  const otherScaffold = rows.filter(r => r.scaffold_id && !scaffold(r)?.gai).length;
  const reasonOnly = rows.filter(r => !r.scaffold_id && r.reason_tag).length;
  const nothing = rows.length - genAi - otherScaffold - reasonOnly;
  const head = genAi === rows.length
    ? `${rows.length} time(s), every one with a GenAI scaffold`
    : `${rows.length} time(s): GenAI scaffold ${genAi}, other scaffold ${otherScaffold}, a reason tag instead of a scaffold ${reasonOnly}, nothing chosen ${nothing}`;
  const used = countBy(rows.filter(r => r.scaffold_id), r => `「${scaffold(r)?.title ?? 'a scaffold no longer listed'}」`);
  const fromCards = rows.filter(r => r.feedback_id).length;
  const fromChat = rows.filter(r => !r.feedback_id && r.source_message_id).length;
  return [
    `${head}.`,
    used.length > 0 ? ` Scaffolds chosen: ${listCounts(used.slice(0, SCAFFOLDS_MAX))}${used.length > SCAFFOLDS_MAX ? ', …' : ''}.` : '',
    withSource ? ` Inserted from AI feedback cards ${fromCards}, from AI conversations ${fromChat}.` : '',
  ].join('');
}

export function formatAiInteractionSection(
  data: AiInteractionData,
  opts: { viewerId: string; isStaff: boolean; selectedCount?: number },
): string {
  const where = opts.selectedCount ? `on the ${opts.selectedCount} selected note(s)` : 'in this workspace';
  const head = `AI feedback and AI content ${where}, from the platform's own records (these are the real figures; use them when asked to summarise the discussion or how AI was used, and never say they are unavailable or must come from the back end):`;

  if (opts.isStaff) {
    const lines = [
      head,
      `- AI feedback cards sent to students: ${describeFeedback(data.feedbacks)}`,
      `- AI content inserted into notes: ${describeInsertions(data.insertions, data)}`,
    ];
    const people = [...new Set([...data.feedbacks, ...data.insertions].map(r => r.user_id).filter((id): id is string => !!id))];
    if (people.length > 0) {
      const rows = people.map(id => {
        const cards = data.feedbacks.filter(f => f.user_id === id);
        const inserted = data.insertions.filter(i => i.user_id === id);
        const genAi = inserted.filter(i => i.scaffold_id && data.scaffolds.get(i.scaffold_id)?.gai).length;
        return {
          weight: cards.length + inserted.length,
          text: `${data.names.get(id) || 'a member without a name'}: ${cards.length} card(s) (adopted ${cards.filter(c => c.status === 'accepted').length}, put into the note ${cards.filter(c => c.status === 'inserted').length}, disagreed ${cards.filter(c => c.status === 'rejected').length}), ${inserted.length} insertion(s) (GenAI scaffold ${genAi})`,
        };
      }).sort((a, b) => b.weight - a.weight);
      lines.push(`- By person: ${rows.slice(0, PEOPLE_MAX).map(r => r.text).join('; ')}${rows.length > PEOPLE_MAX ? `; … and ${rows.length - PEOPLE_MAX} more` : ''}.`);
    }
    return lines.join('\n');
  }

  const ownCards = data.feedbacks.filter(f => f.user_id === opts.viewerId);
  const ownInsertions = data.insertions.filter(i => i.user_id === opts.viewerId);
  const posted = data.feedbacks.filter(f => f.status === 'accepted' && (f.published_note_id || f.review_state === 'published')).length;
  return [
    head,
    `- Your own AI feedback cards: ${describeFeedback(ownCards)}`,
    `- Your own AI content insertions: ${describeInsertions(ownInsertions, data)}`,
    `- Visible to everyone on the canvas: ${posted} adopted AI feedback card(s) posted as notes; AI content inserted into notes ${describeInsertions(data.insertions, data, false)}`,
    'How many cards other people received, dismissed or disagreed with is private to them and to course staff. If asked, say so; do not guess.',
  ].join('\n');
}
