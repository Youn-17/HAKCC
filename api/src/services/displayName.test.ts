import { describe, expect, it } from 'vitest';
import {
  cleanDisplayName,
  displayNameOrFallback,
  emailFallbackName,
  resolveDisplayProfile,
} from './displayName';

describe('display name helpers', () => {
  it('ignores placeholder names such as Unknown', () => {
    expect(cleanDisplayName('Unknown')).toBeUndefined();
    expect(cleanDisplayName('  未知用户  ')).toBeUndefined();
    expect(cleanDisplayName('Alex Chen')).toBe('Alex Chen');
  });

  it('uses the email local part only when the explicit name is not usable', () => {
    expect(emailFallbackName('teacher@example.com')).toBe('teacher');
    expect(displayNameOrFallback({ name: 'Unknown', email: 'he.zhenhai@example.com' })).toBe('he.zhenhai');
  });

  it('uses the instructor profile for an Unknown joined user only when the note author is the instructor', () => {
    expect(resolveDisplayProfile({
      authorId: 'teacher-1',
      joinedUser: { id: 'teacher-1', name: 'Unknown' },
      instructorProfile: { id: 'teacher-1', name: 'Alex Chen' },
    })?.name).toBe('Alex Chen');

    expect(resolveDisplayProfile({
      authorId: 'student-1',
      joinedUser: { id: 'student-1', name: 'Unknown' },
      instructorProfile: { id: 'teacher-1', name: 'Alex Chen' },
    })?.name).toBeUndefined();
  });
});
