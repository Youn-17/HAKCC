import { supabase } from '../config/supabase';
import { ApiError } from '../middleware/errorHandler';
import { ensureCourseInstructor, ensureSpaceStaff } from './accessControl';
import type { AuthUser } from '../middleware/auth';

/**
 * Resolve the :spaceId route param → the space IDs a research query should read,
 * **and authorise the caller for them**.
 *
 * The param is either a space id, or a course id (in which case every space in
 * that course is in scope).
 *
 * This lived as three near-identical private copies in research.ts,
 * researchAdvanced.ts and researchCharts.ts, none of which checked access — so
 * a supplied id was simply trusted and any teacher account could read another
 * course's events, social network and discourse data by passing its id. Keeping
 * one authorising implementation is what stops that from drifting back.
 */
export async function resolveSpaceIds(paramId: string, user: AuthUser): Promise<string[]> {
  const { data: space } = await supabase
    .from('spaces')
    .select('id')
    .eq('id', paramId)
    .maybeSingle();

  if (space) {
    // One space still holds every member's events and discourse, so it is
    // course-staff only too — being able to open the space is not enough.
    await ensureSpaceStaff(space.id, user);
    return [space.id];
  }

  const { data: spaces } = await supabase
    .from('spaces')
    .select('id')
    .eq('course_id', paramId);

  if (spaces && spaces.length > 0) {
    // Course-wide research data spans every group, so it is instructor-only.
    await ensureCourseInstructor(paramId, user);
    return spaces.map((s) => s.id);
  }

  throw new ApiError(404, 'No spaces found for the given ID');
}
