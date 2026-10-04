import { Router, Request, Response } from 'express';
import { supabase, supabaseAuth } from '../config/supabase';
import { verifyJWT, requireRole, invalidateAuthCache } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { logEvent } from '../services/eventService';
import { validateUpload } from '../services/attachmentValidation';

const router = Router();

/**
 * 个人资料对外的字段集合。
 *
 * 真实姓名（full_name）只有教师和管理员能改。学生不能：课堂记录和研究数据都靠它认人，
 * 学生改名会让历史署名和研究编号对不上，而且学生名单本来就由教师掌握。
 * 教师的名字是自己注册时填的，填错了没有人能替他改，所以留一个自助入口。
 */
const PROFILE_SELECT = 'id, full_name, email, role, status, avatar_url, school, age, bio';

function toProfileResponse(p: Record<string, any>) {
  return {
    id: p.id,
    name: p.full_name,
    email: p.email,
    role: p.role,
    status: p.status,
    avatar: p.avatar_url,
    school: p.school ?? null,
    age: p.age ?? null,
    bio: p.bio ?? null,
  };
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name, role = 'student' } = req.body;

  if (!email || !password || !name) {
    throw new ApiError(400, 'email, password and name are required');
  }

  // Reset and change-password both enforce this; registration letting a
  // shorter one through meant an account could be created weaker than its
  // owner could ever set it afterwards.
  if (typeof password !== 'string' || password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters');
  }

  if (!['student', 'teacher'].includes(role)) {
    throw new ApiError(400, 'role must be student or teacher');
  }

  const { data: authData, error: authError } = await supabaseAuth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role },
  });

  if (authError || !authData.user) {
    throw new ApiError(400, authError?.message ?? 'Registration failed');
  }

  const status = role === 'teacher' ? 'pending' : 'active';
  // Use upsert to handle case where profile already exists
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: authData.user.id,
    full_name: name,
    email,
    role,
    status,
  }, { onConflict: 'id' });

  if (profileError) {
    await supabaseAuth.auth.admin.deleteUser(authData.user.id);
    throw new ApiError(500, 'Failed to create user profile');
  }

  // Log registration event
  logEvent({
    actor_id: authData.user.id,
    actor_role: role,
    event_type: 'user_register',
    object_type: 'user',
    object_id: authData.user.id,
    space_id: '',
    metadata_json: { role, status },
  });

  res.status(201).json({
    message: role === 'teacher'
      ? 'Registration successful. Awaiting admin approval.'
      : 'Registration successful.',
    userId: authData.user.id,
    status,
    user: {
      id: authData.user.id,
      name,
      email,
      role,
      status,
    },
  });
});

// POST /api/auth/login
/**
 * 把 Supabase 的登录结果换成平台会话：读 profile（没有就补建）、查状态、记登录事件。
 * /login 与 /session 共用；后者是浏览器直连 Supabase 登录后来换取的。
 */
async function buildLoginResult(authUser: { id: string; email?: string | null }, session: { access_token: string; refresh_token: string }, source: 'password' | 'direct' = 'password') {
  let { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, status, avatar_url')
    .eq('id', authUser.id)
    .single();

  // Auto-create profile if missing (user created via Supabase Dashboard)
  if (profileError || !profile) {
    const fallbackName = authUser.email?.split('@')[0] ?? 'User';
    const { data: created, error: createErr } = await supabase
      .from('profiles')
      .insert({
        id: authUser.id,
        full_name: fallbackName,
        email: authUser.email,
        role: 'student',
        status: 'active',
      })
      .select('id, full_name, email, role, status, avatar_url')
      .single();
    if (createErr || !created) {
      throw new ApiError(500, 'Failed to load user profile');
    }
    profile = created;
  }

  if (profile.status === 'pending') {
    throw new ApiError(403, 'Your account is pending admin approval');
  }
  if (profile.status === 'inactive') {
    throw new ApiError(403, 'Your account has been deactivated');
  }

  logEvent({
    actor_id: profile.id,
    actor_role: profile.role,
    event_type: 'user_login',
    object_type: 'session',
    object_id: session.access_token.slice(-8),
    space_id: '',
    // 登录方式进记录：password = 经后端中转，direct = 浏览器直连 Supabase。不记 IP 和设备。
    metadata_json: { source },
  });

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    user: {
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      role: profile.role,
      status: profile.status,
      avatar: profile.avatar_url,
    },
  };
}

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, 'email and password are required');
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    throw new ApiError(401, 'Invalid email or password');
  }

  res.json(await buildLoginResult(data.user, data.session));
});

/**
 * POST /api/auth/session — 浏览器已直接向 Supabase 登录，拿 token 来换平台会话。
 *
 * Supabase 对密码登录按来源 IP 限流（每 5 分钟 30 次）。经 /login 中转时，
 * 全校学生在 Supabase 眼里都是这台服务器的 IP，一个班同时登录就会撞上限。
 * 让浏览器直连登录，限流就落到每个学生自己的 IP 上；服务端只负责验 token、
 * 查 profile 状态、记事件——和 /login 完全一样的后半段。
 */
router.post('/session', async (req: Request, res: Response) => {
  const { access_token, refresh_token } = req.body ?? {};
  if (typeof access_token !== 'string' || typeof refresh_token !== 'string' || !access_token || !refresh_token) {
    throw new ApiError(400, 'access_token and refresh_token are required');
  }

  const { data: { user }, error } = await supabaseAuth.auth.getUser(access_token);
  if (error || !user) {
    throw new ApiError(401, 'Invalid or expired token');
  }

  res.json(await buildLoginResult(user, { access_token, refresh_token }, 'direct'));
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new ApiError(400, 'refreshToken required');

  const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) throw new ApiError(401, 'Failed to refresh session');

  res.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  });
});

// GET /api/auth/me
router.get('/me', verifyJWT, async (req: Request, res: Response) => {
  // Return full user object including status, avatar and profile details
  const { data: profile } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', req.user!.id)
    .single();

  res.json({ user: profile ? toProfileResponse(profile) : req.user });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, 'email is required');

  // The redirect target must never come from the request. Origin is fully
  // attacker-controlled (cors() sets response headers, it never rejects), so
  // trusting it made the service mail victims a genuine reset link pointing at
  // the attacker's host — a one-click account takeover.
  const allowedOrigins = (process.env.FRONTEND_URL ?? 'https://ideaweave.tech')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const requested = (req.headers.origin ?? '').trim().replace(/\/$/, '');
  const origin = allowedOrigins.includes(requested) ? requested : allowedOrigins[0];

  await supabaseAuth.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` });

  res.json({ message: 'If the email exists, a reset link has been sent.' });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  const { accessToken, refreshToken, newPassword } = req.body;
  if (!accessToken || !refreshToken || !newPassword) {
    throw new ApiError(400, 'accessToken, refreshToken, and newPassword are required');
  }
  if (newPassword.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');

  const { data: sessionData, error: sessionError } = await supabaseAuth.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (sessionError || !sessionData.user) throw new ApiError(401, 'Invalid or expired reset link');

  const { error: updateError } = await supabaseAuth.auth.admin.updateUserById(
    sessionData.user.id,
    { password: newPassword }
  );
  if (updateError) throw new ApiError(500, updateError.message);

  res.json({ message: 'Password updated successfully.' });
});

// POST /api/auth/change-password — logged-in users change their own password
router.post('/change-password', verifyJWT, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, 'currentPassword and newPassword are required');
  }
  if (newPassword.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');

  const { error: verifyError } = await supabaseAuth.auth.signInWithPassword({
    email: req.user!.email,
    password: currentPassword,
  });
  if (verifyError) throw new ApiError(401, 'Current password is incorrect');

  const { error: updateError } = await supabaseAuth.auth.admin.updateUserById(
    req.user!.id,
    { password: newPassword }
  );
  if (updateError) throw new ApiError(500, updateError.message);

  res.json({ message: 'Password updated successfully.' });
});

// POST /api/auth/oauth-sync — sync OAuth user profile after social login
router.post('/oauth-sync', async (req: Request, res: Response) => {
  const { accessToken, refreshToken } = req.body;
  if (!accessToken || !refreshToken) throw new ApiError(400, 'accessToken and refreshToken required');

  const { data: { user: authUser }, error } = await supabaseAuth.auth.getUser(accessToken);
  if (error || !authUser) throw new ApiError(401, 'Invalid access token');

  let { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, status, avatar_url')
    .eq('id', authUser.id)
    .single();

  if (!profile) {
    const meta = authUser.user_metadata || {};
    const name = meta.full_name || meta.name || authUser.email?.split('@')[0] || 'User';
    const avatar = meta.avatar_url || meta.picture || null;

    const { data: created, error: createErr } = await supabase
      .from('profiles')
      .insert({
        id: authUser.id,
        full_name: name,
        email: authUser.email,
        role: 'student',
        status: 'active',
        avatar_url: avatar,
      })
      .select('id, full_name, email, role, status, avatar_url')
      .single();

    if (createErr || !created) throw new ApiError(500, 'Failed to create profile');
    profile = created;

    logEvent({
      actor_id: authUser.id,
      actor_role: 'student',
      event_type: 'user_register',
      object_type: 'user',
      object_id: authUser.id,
      space_id: '',
      metadata_json: { provider: 'google', status: 'active' },
    });
  }

  if (profile.status === 'pending') throw new ApiError(403, 'Account pending admin approval');
  if (profile.status === 'inactive') throw new ApiError(403, 'Account has been deactivated');

  logEvent({
    actor_id: profile.id,
    actor_role: profile.role,
    event_type: 'user_login',
    object_type: 'session',
    object_id: accessToken.slice(-8),
    space_id: '',
    metadata_json: { provider: 'google' },
  });

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      role: profile.role,
      status: profile.status,
      avatar: profile.avatar_url,
    },
  });
});

// PATCH /api/auth/me — 更新自己的资料（学院、年龄、简介、头像）。姓名不可改。
router.patch('/me', verifyJWT, async (req: Request, res: Response) => {
  const { name, school, age, bio, avatar } = req.body as {
    name?: unknown; school?: unknown; age?: unknown; bio?: unknown; avatar?: unknown;
  };

  const updates: Record<string, unknown> = {};

  if (name !== undefined) {
    // 学生改不了：历史笔记的署名、研究导出的编号都认这个名字。
    if (req.user!.role !== 'teacher' && req.user!.role !== 'admin') {
      throw new ApiError(403, '姓名由教师维护，如需更正请联系教师。');
    }
    if (typeof name !== 'string') throw new ApiError(400, 'name must be a string');
    const trimmed = name.trim();
    if (!trimmed) throw new ApiError(400, '姓名不能为空');
    if (trimmed.length > 50) throw new ApiError(400, '姓名不能超过 50 个字符');
    updates.full_name = trimmed;
  }

  if (school !== undefined) {
    if (school !== null && typeof school !== 'string') throw new ApiError(400, 'school must be a string');
    const trimmed = typeof school === 'string' ? school.trim() : '';
    if (trimmed.length > 100) throw new ApiError(400, '所在学院不能超过 100 个字符');
    updates.school = trimmed || null;
  }

  if (age !== undefined) {
    if (age === null || age === '') {
      updates.age = null;
    } else {
      const n = Number(age);
      if (!Number.isInteger(n) || n < 5 || n > 120) throw new ApiError(400, '年龄需为 5–120 之间的整数');
      updates.age = n;
    }
  }

  if (bio !== undefined) {
    if (bio !== null && typeof bio !== 'string') throw new ApiError(400, 'bio must be a string');
    const trimmed = typeof bio === 'string' ? bio.trim() : '';
    if (trimmed.length > 300) throw new ApiError(400, '个人简介不能超过 300 个字符');
    updates.bio = trimmed || null;
  }

  // 头像只接受本站存储域的 URL：任意外链会把学生的 IP 泄给第三方，
  // 而画布上每张卡都会去加载它。
  if (avatar !== undefined) {
    if (avatar === null || avatar === '') {
      updates.avatar_url = null;
    } else if (typeof avatar === 'string' && isOwnStorageUrl(avatar)) {
      updates.avatar_url = avatar;
    } else {
      throw new ApiError(400, '头像地址不合法，请通过上传接口设置头像。');
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, 'At least one field (name, school, age, bio, avatar) is required');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user!.id)
    .select(PROFILE_SELECT)
    .single();

  if (error) throw new ApiError(500, error.message);

  if (typeof updates.full_name === 'string') {
    const fullName = updates.full_name;
    // 有两张表存了姓名快照，不跟着改的话同一个人会显示成两个名字：
    // notes.author_name（讨论室的发言、观点图谱、讨论速览都读它）、
    // note_feedbacks.published_by_name（教师发布反馈时的署名）。
    await Promise.all([
      supabase.from('notes').update({ author_name: fullName }).eq('author_id', req.user!.id),
      supabase.from('note_feedbacks').update({ published_by_name: fullName }).eq('published_by', req.user!.id),
    ]);
    // 鉴权缓存里存着旧名字（TTL 60 秒）。不清的话这一分钟内他新发的讨论室发言
    // 还会署旧名 —— 刚改完就看见旧名字，会以为没保存成功。
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) invalidateAuthCache(auth.slice(7));
  }

  res.json({ user: toProfileResponse(data) });
});

/** 该 URL 是否指向本项目自己的公开存储桶。 */
function isOwnStorageUrl(url: string): boolean {
  const { data } = supabase.storage.from('note-chat-attachments').getPublicUrl('');
  const root = data.publicUrl.replace(/\/$/, '');
  return url.startsWith(root);
}

// POST /api/auth/me/avatar — 上传头像图片并写回资料
router.post('/me/avatar', verifyJWT, async (req: Request, res: Response) => {
  const { file_name, mime_type = 'image/png', data_url } = req.body as {
    file_name?: string; mime_type?: string; data_url?: string;
  };
  if (!file_name || !data_url) throw new ApiError(400, 'file_name and data_url are required');

  // 与画布附件同一套校验：只收真图片（按字节判定，不信声明的 MIME），头像 5MB 足够。
  const { buffer, safeName } = validateUpload(data_url, file_name, mime_type, {
    imagesOnly: true,
    maxBytes: 5 * 1024 * 1024,
  });

  const path = `avatars/${req.user!.id}-${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from('note-chat-attachments')
    .upload(path, buffer, { contentType: mime_type, upsert: false });
  if (uploadError) throw new ApiError(500, uploadError.message);

  const { data: publicData } = supabase.storage.from('note-chat-attachments').getPublicUrl(path);

  const { data, error } = await supabase
    .from('profiles')
    .update({ avatar_url: publicData.publicUrl })
    .eq('id', req.user!.id)
    .select(PROFILE_SELECT)
    .single();
  if (error) throw new ApiError(500, error.message);

  res.json({ user: toProfileResponse(data), avatar_url: publicData.publicUrl });
});

// GET /api/auth/users (admin only)
router.get('/users', verifyJWT, requireRole('admin'), async (req: Request, res: Response) => {
  const { status } = req.query;
  let query = supabase
    .from('profiles')
    .select('id, full_name, email, role, status, created_at');

  if (status) query = query.eq('status', status);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new ApiError(500, error.message);

  res.json({ users: data?.map(u => ({ ...u, name: u.full_name })) ?? [] });
});

// PATCH /api/auth/users/:id/approve
router.patch('/users/:id/approve', verifyJWT, requireRole('admin'), async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('profiles')
    .update({ status: 'active' })
    .eq('id', req.params.id)
    .eq('role', 'teacher');

  if (error) throw new ApiError(500, error.message);

  // Return the updated user object
  const { data: updatedUser } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, status')
    .eq('id', req.params.id)
    .single();

  res.json({
    message: 'Teacher approved',
    user: updatedUser
      ? {
          id: updatedUser.id,
          name: updatedUser.full_name,
          email: updatedUser.email,
          role: updatedUser.role,
          status: updatedUser.status,
        }
      : undefined,
  });
});

export default router;
