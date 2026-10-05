import { supabase } from '../config/supabase';
import { ApiError } from '../middleware/errorHandler';
import type { AuthUser } from '../middleware/auth';
import { ensureSpaceAccess, isCourseStaff } from './accessControl';
import { anonymizeId } from './anonymizer';
import { buildKnowledgeHistory, readHistoryRows, readRevisionRows } from './knowledgeHistory';

/** Course aggregation goes through the same authorization as opening each space. */
export async function loadKnowledgeTimeline(spaceId: string, user: Pick<AuthUser, 'id' | 'role'>, scope: 'space' | 'course') {
  const base = await ensureSpaceAccess(spaceId, user);
  const spacesResult = await readHistoryRows(() => supabase.from('spaces').select('id, title, group_id')
    .eq('course_id', base.course_id).order('created_at').order('id'));
  const visible: typeof spacesResult.rows = [];
  const candidates = scope === 'space' ? spacesResult.rows.filter(s => s.id === spaceId) : spacesResult.rows;
  for (let offset = 0; offset < candidates.length; offset += 12) {
    const accessible = await Promise.all(candidates.slice(offset, offset + 12).map(async candidate => {
      try { await ensureSpaceAccess(candidate.id, user); return candidate; }
      catch (error) { if (!(error instanceof ApiError) || ![403, 404].includes(error.statusCode)) throw error; return null; }
    }));
    for (const candidate of accessible) if (candidate) visible.push(candidate);
  }

  if (!visible.some(s => s.id === spaceId)) visible.push({ id: spaceId, title: '', group_id: base.group_id });
  const ids = visible.map(s => s.id);
  const [notes, relations, revisions, feedbacks, threads, groups, members] = await Promise.all([
    readHistoryRows(() => supabase.from('notes').select('id, title, content, author_id, type, space_id, created_at, is_ai_generated')
      .in('space_id', ids).is('deleted_at', null).order('created_at', { ascending: false }).order('id')),
    readHistoryRows(() => supabase.from('relations').select('id, source_note_id, target_note_id, relation_type, creator_id, created_at, ai_suggested')
      .in('space_id', ids).order('created_at', { ascending: false }).order('id')),
    readRevisionRows(timeField => supabase.from('note_revisions').select(`id, note_id, title, content, editor_id, revision_number, change_summary, ${timeField === 'edited_at' ? 'edited_at' : 'edited_at:created_at'}, notes!inner(space_id, deleted_at)`)
      .in('notes.space_id', ids).is('notes.deleted_at', null).order(timeField, { ascending: false }).order('id')),
    readHistoryRows(() => supabase.from('note_ai_feedbacks').select('id, note_id, user_id, trigger_type, status, created_at')
      .in('space_id', ids).eq('user_id', user.id).order('created_at', { ascending: false }).order('id')),
    readHistoryRows(() => supabase.from('note_conversation_threads').select('id, note_id, created_by, created_at')
      .in('space_id', ids).eq('target_type', 'ai').eq('created_by', user.id).is('deleted_at', null).order('created_at', { ascending: false }).order('id')),
    readHistoryRows(() => supabase.from('groups').select('id, name, group_members(user_id)').eq('course_id', base.course_id).order('id')),
    readHistoryRows(() => supabase.from('course_members').select('user_id, role').eq('course_id', base.course_id).order('user_id')),
  ]);
  const actorIds = new Set<string>([user.id]);
  for (const n of notes.rows) if (n.author_id) actorIds.add(n.author_id);
  for (const r of relations.rows) if (r.creator_id) actorIds.add(r.creator_id);
  for (const r of revisions.rows) if (r.editor_id) actorIds.add(r.editor_id);
  for (const m of members.rows) actorIds.add(m.user_id);
  if (base.instructor_id) actorIds.add(base.instructor_id);
  const profiles = await readHistoryRows(() => supabase.from('profiles').select('id, full_name').in('id', [...actorIds]).order('id'));
  const names = new Map<string, string>(profiles.rows.map(p => [p.id, p.full_name]));
  const history = buildKnowledgeHistory({ notes: notes.rows, relations: relations.rows, revisions: revisions.rows, feedbacks: feedbacks.rows, threads: threads.rows, names, userId: user.id });
  const spaces = new Map(visible.map(s => [s.id, s]));
  const noteSpaces = new Map(notes.rows.map(n => [n.id, n.space_id]));
  const located = (noteId: string | null) => {
    const sid = noteId ? noteSpaces.get(noteId) : undefined;
    const space = spaces.get(sid);
    return { spaceId: sid ?? null, spaceTitle: space?.title ?? '', groupId: space?.group_id ?? null };
  };
  const roles = new Map(members.rows.map(m => [m.user_id, m.role]));
  return {
    ...history,
    items: history.items.map(item => ({ ...item, ...located(item.noteId) })),
    structure: { ...history.structure, notes: history.structure.notes.map(n => ({ ...n, ...located(n.id) })) },
    generatedAt: new Date().toISOString(),
    context: {
      courseId: base.course_id, scope, currentSpaceId: spaceId, canExport: isCourseStaff(base.standing), membershipBasis: 'current' as const,
      spaces: visible.map(s => ({ id: s.id, title: s.title, groupId: s.group_id ?? null })),
      groups: groups.rows.map(g => ({ id: g.id, name: g.name, memberIds: (g.group_members ?? []).map((m: { user_id: string }) => m.user_id) })),
      participants: [...actorIds].map(id => ({ id, name: names.get(id) ?? '', code: `P-${anonymizeId(id, base.course_id)}`,
        role: id === base.instructor_id || ['teacher', 'admin'].includes(roles.get(id)) ? 'teacher' : 'student' })),
    },
    coverage: {
      truncated: [notes, relations, revisions, feedbacks, threads, groups, members, profiles, spacesResult].some(r => r.truncated),
      limitPerSource: 2000, privateAiScope: 'self' as const,
      revisionTimestampField: revisions.timestampField,
      revisionHistoryComplete: !notes.truncated && !revisions.truncated && history.items.every(i => i.snapshotComplete !== false),
    },
  };
}
