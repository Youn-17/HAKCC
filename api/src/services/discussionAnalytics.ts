import { studentAuthoredText } from './feedbackUptake';
import type { AnalyticsInput } from './spaceAnalytics';

export interface DiscussionFilter { authorId?: string | null; from?: string | null; until?: string | null }

/** Date bounds are instants: inclusive start, exclusive end. */
export function filterDiscussionPeriod<T extends AnalyticsInput>(input: T, filter: DiscussionFilter): T {
  const inside = (date: string) => (!filter.from || Date.parse(date) >= Date.parse(filter.from)) && (!filter.until || Date.parse(date) < Date.parse(filter.until));
  const notes = input.notes.filter(n => inside(n.createdAt));
  const ids = new Set(notes.map(n => n.id));
  return { ...input, notes, relations: input.relations.filter(r => ids.has(r.source) && ids.has(r.target) && inside(r.createdAt)), feedbacks: input.feedbacks.filter(f => ids.has(f.noteId) && inside(f.createdAt)) };
}

export function buildDiscussion(input: AnalyticsInput, filter: DiscussionFilter = {}) {
  const scoped = filterDiscussionPeriod(input, filter);
  const students = scoped.members.filter(m => !m.isStaff);
  const studentIds = new Set(students.map(m => m.id));
  const usable = scoped.notes.filter(n => !n.aiGenerated && n.type !== 'view' && n.authorId && studentIds.has(n.authorId));
  const ids = new Set(usable.map(n => n.id));
  const edges = scoped.relations.filter(r => ids.has(r.source) && ids.has(r.target) && r.source !== r.target && !(r.aiSuggested && !r.aiAccepted))
    .map(r => ({ from: r.target, to: r.source, type: r.type, createdAt: r.createdAt }));
  // Build-on is stored response -> parent. Display parent -> response; cycles are allowed and visited once.
  let connected = ids;
  if (filter.authorId) {
    connected = new Set(usable.filter(n => n.authorId === filter.authorId).map(n => n.id));
    const adjacent = new Map<string, string[]>();
    for (const e of edges) {
      adjacent.set(e.from, [...(adjacent.get(e.from) ?? []), e.to]);
      adjacent.set(e.to, [...(adjacent.get(e.to) ?? []), e.from]);
    }
    const queue = [...connected];
    for (let i = 0; i < queue.length; i++) for (const id of adjacent.get(queue[i]) ?? []) if (!connected.has(id)) { connected.add(id); queue.push(id); }
  }
  const notes = usable.filter(n => connected.has(n.id)).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map(n => ({ id: n.id, title: n.title, authorId: n.authorId!, createdAt: n.createdAt, type: n.type,
      excerpt: studentAuthoredText(n.content).replace(/\s+/g,' ').trim().slice(0,600), selected: !!filter.authorId && n.authorId === filter.authorId }));
  const authorOf = new Map(usable.map(n => [n.id, n.authorId]));
  const received = new Set(edges.filter(e => authorOf.get(e.from) !== authorOf.get(e.to)).map(e => e.from));
  const questions = new Set(edges.filter(e => ['question','challenge'].includes(e.type) && !received.has(e.to)).map(e => e.from));
  const pending = notes.flatMap(n => {
    const reasons: Array<{noteId: string; reason: 'unanswered' | 'question'}> = [];
    if (!received.has(n.id)) reasons.push({noteId:n.id,reason:'unanswered'});
    if (questions.has(n.id)) reasons.push({noteId:n.id,reason:'question'});
    return reasons;
  });
  return { pending, members: students.map(m => ({id:m.id,name:m.name})), notes, edges: edges.filter(e => connected.has(e.from) && connected.has(e.to)) };
}
