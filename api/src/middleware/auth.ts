import { Request, Response, NextFunction } from 'express';
import { supabase, supabaseAuth } from '../config/supabase';
import { withAiContext } from '../services/aiGateway';
import { TtlCache } from '../services/ttlCache';

export interface AuthUser {
  id: string;
  email: string;
  role: 'student' | 'teacher' | 'admin';
  name: string;
  status: 'active' | 'pending' | 'inactive';
  avatar?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * token → 已验证的用户，短时缓存。
 *
 * 每个 API 请求原本要往 Supabase 跑两趟：验 token、再查 profiles，合计约 450ms。
 * 学生打开画布会连着发十几个请求，这 450ms 每次都要付一遍。
 *
 * 60 秒的代价：账号被停用或降权后，最多还能用 60 秒。access token 本身就是短期的，
 * 而且停用是低频的管理操作，这个窗口可以接受；换来的是全站每个请求少 450ms。
 * 如果哪天需要即时生效，把 TTL 调到 0 或在停用时调用 invalidateAuthCache。
 */
const authCache = new TtlCache<AuthUser>(
  Number(process.env.AUTH_CACHE_TTL_MS) >= 0 ? Number(process.env.AUTH_CACHE_TTL_MS) || 60_000 : 60_000,
  10_000,
);

export function invalidateAuthCache(token?: string): void {
  if (token) authCache.delete(token);
  else authCache.clear();
}

export async function verifyJWT(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

  if (!token) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const cached = authCache.get(token);
  if (cached) {
    req.user = cached;
    withAiContext(cached.id, next);
    return;
  }

  try {
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Fetch profile from profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, role, status, avatar_url')
      .eq('id', user.id)
      .single();

    // 查不到 profile 有两种完全不同的原因：账号确实没有 profile，或数据库暂时不可用
    // （压测里 PostgREST 过载时整批请求就是这样）。后者不能说成 401，否则前端会把人登出。
    if (profileError) {
      res.status(503).json({ error: 'Service temporarily unavailable, please retry' });
      return;
    }
    if (!profile) {
      res.status(401).json({ error: 'User profile not found' });
      return;
    }

    if (profile.status !== 'active') {
      res.status(403).json({ error: 'Account is pending approval or inactive' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email ?? '',
      role: profile.role,
      name: profile.full_name,
      status: profile.status,
      avatar: profile.avatar_url ?? undefined,
    };

    authCache.set(token, req.user);

    // 把当前用户存进请求上下文：深处的模型调用不用层层传参就能拿到，
    // aiGateway 靠它做「每人最多几路并发」。
    withAiContext(user.id, next);
  } catch (err) {
    res.status(401).json({ error: 'Token verification failed' });
  }
}

export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
