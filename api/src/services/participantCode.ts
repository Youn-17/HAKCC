/**
 * Readable participant codes for research exports.
 *
 *   S + course abbreviation + 2-digit number   → STPKB01  (student)
 *   T + course abbreviation + 2-digit number   → TTPKB01  (teacher)
 *
 * The abbreviation comes from the course's English name ("Theory and Practice
 * of Knowledge Building" → TPKB). The number is assigned ONCE, in random
 * order, and persisted on course_members — so it reveals nothing about
 * enrolment order or alphabetical position, yet stays stable across exports.
 */

import { supabase } from '../config/supabase';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with',
  'from', 'at', 'by', 'into', 'about', 'as', 'via',
]);

/** "Theory and Practice of Knowledge Building" → "TPKB" */
export function deriveAbbreviation(englishName: string): string {
  const words = englishName
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  const content = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const source = content.length > 0 ? content : words;

  if (source.length === 0) return 'COURSE';
  if (source.length === 1) return source[0].slice(0, 4).toUpperCase();
  return source.slice(0, 6).map((w) => w[0].toUpperCase()).join('');
}

export interface ParticipantIdentity {
  userId: string;
  code: string;
  name: string;
  email: string;
  role: string;
  isTeacher: boolean;
}

/** Fisher-Yates, so code order carries no information about the roster order. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface CourseCodeInfo {
  englishName: string | null;
  abbr: string | null;
  /** user_id → identity; empty when the course has no English name yet. */
  identities: Map<string, ParticipantIdentity>;
}

/**
 * Resolve every member's code, assigning numbers to anyone who lacks one.
 * Returns an empty identity map when the course has no English name — the UI
 * prompts for it before any export can run.
 */
export async function resolveParticipantCodes(courseId: string): Promise<CourseCodeInfo> {
  const { data: course } = await supabase
    .from('courses')
    .select('english_name, code_abbr, instructor_id')
    .eq('id', courseId)
    .single();

  const englishName = (course?.english_name as string | null) ?? null;
  let abbr = (course?.code_abbr as string | null) ?? null;

  if (!englishName) return { englishName: null, abbr, identities: new Map() };
  if (!abbr) {
    abbr = deriveAbbreviation(englishName);
    await supabase.from('courses').update({ code_abbr: abbr }).eq('id', courseId);
  }

  const { data: members } = await supabase
    .from('course_members')
    .select('user_id, participant_number')
    .eq('course_id', courseId);

  const memberRows = members ?? [];
  const userIds = memberRows.map((m) => m.user_id as string);
  // The course instructor may not sit in course_members; they still need a code.
  const instructorId = course?.instructor_id as string | undefined;
  if (instructorId && !userIds.includes(instructorId)) userIds.push(instructorId);
  if (userIds.length === 0) return { englishName, abbr, identities: new Map() };

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .in('id', userIds);
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  const isTeacherOf = (uid: string) =>
    uid === instructorId || ['teacher', 'admin'].includes((profileById.get(uid)?.role as string) ?? 'student');

  // Numbers run in separate sequences per prefix, so students are S…01..N.
  const assigned = new Map<string, number>();
  const usedByPrefix = new Map<string, Set<number>>();
  for (const row of memberRows) {
    const num = row.participant_number as number | null;
    if (num === null || num === undefined) continue;
    const uid = row.user_id as string;
    assigned.set(uid, num);
    const prefix = isTeacherOf(uid) ? 'T' : 'S';
    if (!usedByPrefix.has(prefix)) usedByPrefix.set(prefix, new Set());
    usedByPrefix.get(prefix)!.add(num);
  }

  const unassigned = userIds.filter((uid) => !assigned.has(uid));
  const pending: { user_id: string; participant_number: number }[] = [];
  for (const uid of shuffle(unassigned)) {
    const prefix = isTeacherOf(uid) ? 'T' : 'S';
    const used = usedByPrefix.get(prefix) ?? new Set<number>();
    let next = 1;
    while (used.has(next)) next++;
    used.add(next);
    usedByPrefix.set(prefix, used);
    assigned.set(uid, next);
    // The instructor might not be a course_members row; only persist those that are.
    if (memberRows.some((m) => m.user_id === uid)) {
      pending.push({ user_id: uid, participant_number: next });
    }
  }

  for (const row of pending) {
    await supabase
      .from('course_members')
      .update({ participant_number: row.participant_number })
      .eq('course_id', courseId)
      .eq('user_id', row.user_id);
  }

  const identities = new Map<string, ParticipantIdentity>();
  for (const uid of userIds) {
    const profile = profileById.get(uid);
    const teacher = isTeacherOf(uid);
    const number = assigned.get(uid) ?? 0;
    identities.set(uid, {
      userId: uid,
      code: `${teacher ? 'T' : 'S'}${abbr}${String(number).padStart(2, '0')}`,
      name: (profile?.full_name as string) || (profile?.email as string) || '',
      email: (profile?.email as string) ?? '',
      role: teacher ? 'teacher' : 'student',
      isTeacher: teacher,
    });
  }

  return { englishName, abbr, identities };
}
