export interface DisplayProfile {
  id?: string;
  name?: string;
  email?: string;
  avatar?: string;
}

const PLACEHOLDER_NAMES = new Set([
  'unknown',
  'unnamed',
  'anonymous',
  'null',
  'undefined',
  '未知',
  '未知用户',
  '未命名',
]);

export function cleanDisplayName(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name) return undefined;
  if (PLACEHOLDER_NAMES.has(name.toLowerCase())) return undefined;
  return name;
}

export function emailFallbackName(email?: string): string | undefined {
  if (typeof email !== 'string') return undefined;
  const localPart = email.split('@')[0]?.trim();
  return cleanDisplayName(localPart);
}

export function profileWithDisplayName(profile?: DisplayProfile): DisplayProfile | undefined {
  if (!profile) return undefined;
  const name = cleanDisplayName(profile.name) ?? emailFallbackName(profile.email);
  if (!name && !profile.email && !profile.avatar) return undefined;
  return {
    ...profile,
    name,
  };
}

export function resolveDisplayProfile(params: {
  authorId?: string;
  authorProfile?: DisplayProfile;
  joinedUser?: DisplayProfile;
  instructorProfile?: DisplayProfile;
}): DisplayProfile | undefined {
  const authorProfile = profileWithDisplayName(params.authorProfile);
  const joinedUser = profileWithDisplayName(params.joinedUser);
  const instructorProfile = profileWithDisplayName(params.instructorProfile);
  const instructorMatchesAuthor = Boolean(
    params.authorId &&
    instructorProfile?.id &&
    params.authorId === instructorProfile.id,
  );

  if (authorProfile?.name) return authorProfile;
  if (joinedUser?.name) return joinedUser;
  if (instructorMatchesAuthor && instructorProfile?.name) return instructorProfile;
  return authorProfile ?? joinedUser ?? (instructorMatchesAuthor ? instructorProfile : undefined);
}

export function displayNameOrFallback(profile?: DisplayProfile, fallback = 'Unknown'): string {
  return cleanDisplayName(profile?.name) ?? emailFallbackName(profile?.email) ?? fallback;
}
