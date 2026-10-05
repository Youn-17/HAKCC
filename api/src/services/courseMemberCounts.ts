import { supabase } from '../config/supabase';
import { ApiError } from '../middleware/errorHandler';

type CourseOwner = { id: string; instructor_id: string };
type Membership = { course_id: string; user_id: string; role?: string; users?: { role?: string } | null };
export function countCourseMembers(courses: CourseOwner[], memberships: Membership[]) {
  const result = new Map<string, { teacherCount: number; studentCount: number }>();
  for (const course of courses) {
    const teachers = new Set([course.instructor_id].filter(Boolean));
    const students = new Set<string>();
    for (const member of memberships.filter(row => row.course_id === course.id)) {
      const role = member.role ?? member.users?.role;
      if (member.user_id === course.instructor_id || role === 'teacher' || role === 'admin') teachers.add(member.user_id);
      else if (role === 'student' || role === 'member') students.add(member.user_id);
    }
    for (const id of teachers) students.delete(id);
    result.set(course.id, { teacherCount: teachers.size, studentCount: students.size });
  }
  return result;
}
export async function getCourseMemberCounts(courses: CourseOwner[]) {
  if (!courses.length) return new Map<string, { teacherCount: number; studentCount: number }>();
  const { data, error } = await supabase.from('course_members')
    .select('course_id, user_id, role, users!user_id(role)').in('course_id', courses.map(course => course.id));
  if (error) throw new ApiError(500, error.message);
  return countCourseMembers(courses, (data ?? []) as Membership[]);
}
