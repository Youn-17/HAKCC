import { it, expect, vi } from 'vitest';
vi.mock('../config/supabase', () => ({ supabase: {} }));
import { countCourseMembers } from './courseMemberCounts';
it('counts owner and invited teachers once, separately from course participants', () => {
 const counts=countCourseMembers([{id:'c',instructor_id:'owner'}],[
  {course_id:'c',user_id:'owner',role:'teacher'},
  {course_id:'c',user_id:'teacher',role:'teacher'},
  {course_id:'c',user_id:'teacher',role:'teacher'},
  {course_id:'c',user_id:'participant',role:'student',users:{role:'teacher'}},
  {course_id:'c',user_id:'student',role:'student'},
 ]);
 expect(counts.get('c')).toEqual({teacherCount:2,studentCount:2});
 expect(countCourseMembers([{id:'new',instructor_id:'owner'}],[]).get('new')).toEqual({teacherCount:1,studentCount:0});
});
