import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  auth,
  setAuthToken,
  AuthUser,
  LoginResult,
  AUTH_REFRESH_TOKEN_KEY,
  AUTH_SESSION_CLEARED_EVENT,
  AUTH_TOKEN_KEY,
  clearStoredAuthSession,
} from '../services/apiClient';
import { supabase } from '../services/supabaseClient';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name: string; role: string }) => Promise<{ status: string; message: string }>;
  logout: () => void;
  forgotPassword: (email: string) => Promise<void>;
  /** 资料保存成功后把新用户对象换进来，避免整页刷新才看到新头像。 */
  applyUser: (next: AuthUser) => void;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * 先让浏览器直接向 Supabase 登录，再拿 token 到后端换会话。
 *
 * Supabase 对密码登录按来源 IP 限流（每 5 分钟 30 次）。走后端 /auth/login 中转时，
 * 全校学生共用服务器一个 IP，一个班同时登录就会有人被拒；直连则各算各的。
 * 密码错误直接抛回同样的提示；其余情况（限流、网络、被拦）返回 null，退回后端中转。
 */
async function loginViaSupabase(email: string, password: string): Promise<LoginResult | null> {
  let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data'];
  try {
    const res = await supabase.auth.signInWithPassword({ email, password });
    if (res.error) {
      if (res.error.status === 400) throw new Error('Invalid email or password');
      return null;
    }
    data = res.data;
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid email or password') throw err;
    return null;
  }
  if (!data.session) return null;
  return auth.session({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // On mount: restore session from localStorage
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    setAuthToken(token);
    auth.me()
      .then(({ user: u }) => setUser(u))
      .catch(() => {
        // Token expired — try refresh
        const refreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
        if (!refreshToken) {
          clearSession();
          return;
        }
        return auth.refresh(refreshToken)
          .then(({ accessToken, refreshToken: newRefresh }) => {
            saveSession({ accessToken, refreshToken: newRefresh } as LoginResult);
            return auth.me();
          })
          .then((result) => result && setUser(result.user))
          .catch(() => clearSession());
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleSessionCleared = () => setUser(null);
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, handleSessionCleared);
    return () => window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, handleSessionCleared);
  }, []);

  function saveSession(result: Pick<LoginResult, 'accessToken' | 'refreshToken'> & { user?: AuthUser }) {
    localStorage.setItem(AUTH_TOKEN_KEY, result.accessToken);
    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, result.refreshToken);
    setAuthToken(result.accessToken);
    void supabase.auth.setSession({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    });
    if (result.user) setUser(result.user);
  }

  function clearSession() {
    clearStoredAuthSession();
    void supabase.auth.signOut();
    setUser(null);
  }

  const applyUser = useCallback((next: AuthUser) => setUser(next), []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const result = await loginViaSupabase(email, password) ?? await auth.login(email, password);
      saveSession(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      throw err;
    }
  }, []);

  const register = useCallback(async (data: { email: string; password: string; name: string; role: string }) => {
    setError(null);
    try {
      const result = await auth.register(data);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      setError(msg);
      throw err;
    }
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    setError(null);
    try {
      await auth.forgotPassword(email);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send reset email';
      setError(msg);
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    clearSession();
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, forgotPassword, applyUser, error, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
