import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, LogIn, Search, ShieldCheck } from 'lucide-react';
import { loginLogs, type LoginRecord, type PlatformLoginSummary } from '../../services/apiClient';
import type { Language } from '../../types';

/** 「3 分钟前 / 昨天 14:05 / 2026-09-01 09:12」——列表里看一眼就知道多久没来了。 */
export function formatLoginTime(iso: string | null | undefined, lang: Language): string {
  if (!iso) return lang === 'zh' ? '从未登录' : 'Never';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return lang === 'zh' ? '刚刚' : 'just now';
  if (min < 60) return lang === 'zh' ? `${min} 分钟前` : `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return lang === 'zh' ? `${hr} 小时前` : `${hr} h ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return lang === 'zh' ? `${days} 天前` : `${days} d ago`;
  return d.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function methodLabel(method: string, lang: Language): string {
  if (method === 'google') return 'Google';
  if (method === 'direct') return lang === 'zh' ? '密码（直连）' : 'Password (direct)';
  return lang === 'zh' ? '密码' : 'Password';
}

/** 一个人的登录时间列表。管理员看别人、学生看自己都用它。 */
export const LoginHistoryList: React.FC<{ records: LoginRecord[]; lang: Language; retentionDays?: number; loading?: boolean }> = ({ records, lang, retentionDays, loading }) => {
  const zh = lang === 'zh';
  if (loading) {
    return <div className="flex items-center gap-2 py-3 text-sm text-stone-500"><Loader2 size={14} className="animate-spin" />{zh ? '加载中…' : 'Loading…'}</div>;
  }
  if (records.length === 0) {
    return <p className="py-3 text-sm text-stone-500">{zh ? '保留期内没有登录记录。' : 'No sign-ins within the retention period.'}</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="max-h-72 divide-y divide-stone-100 overflow-y-auto rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {records.map((r, i) => (
          <li key={`${r.at}-${i}`} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm">
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-200">
              {new Date(r.at).toLocaleString(zh ? 'zh-CN' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-xs text-stone-500">{methodLabel(r.method, lang)}</span>
          </li>
        ))}
      </ul>
      {retentionDays && (
        <p className="text-xs text-stone-500">{zh ? `只记录登录时间与方式，不记录 IP 或设备；保留 ${retentionDays} 天后自动删除。` : `Only time and method are recorded, never IP or device; entries are deleted after ${retentionDays} days.`}</p>
      )}
    </div>
  );
};

/** 平台管理员的全站登录记录：每人最近一次、30 天次数，点开看明细。 */
const LoginLogPanel: React.FC<{ lang: Language }> = ({ lang }) => {
  const zh = lang === 'zh';
  const [days, setDays] = useState(30);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PlatformLoginSummary[]>([]);
  const [retention, setRetention] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, LoginRecord[]>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loginLogs.platform(days)
      .then(res => { if (!cancelled) { setRows(res.users); setRetention(res.retentionDays); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter(r => (r.name ?? '').toLowerCase().includes(needle) || (r.email ?? '').toLowerCase().includes(needle))
      : rows;
    return [...list].sort((a, b) => (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? ''));
  }, [rows, q]);

  const toggle = (userId: string) => {
    if (openUser === userId) { setOpenUser(null); return; }
    setOpenUser(userId);
    if (!detail[userId]) {
      setDetailLoading(userId);
      loginLogs.platformUser(userId)
        .then(res => setDetail(prev => ({ ...prev, [userId]: res.logins })))
        .catch(() => setDetail(prev => ({ ...prev, [userId]: [] })))
        .finally(() => setDetailLoading(null));
    }
  };

  const roleLabel = (role: string) => zh
    ? ({ admin: '管理员', teacher: '教师', student: '学生' } as Record<string, string>)[role] ?? role
    : role;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="mb-4 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
        <div className="rounded-xl border border-stone-200 bg-stone-100 p-2 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
          <LogIn size={18} />
        </div>
        {zh ? '登录记录' : 'Sign-in records'}
      </h2>

      <div className="rounded-[24px] border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="relative flex-1 min-w-[14rem]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={zh ? '按姓名或邮箱筛选' : 'Filter by name or email'}
              className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2 pl-9 pr-3 text-sm text-stone-800 outline-none transition-colors focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          <div className="flex items-center gap-1 rounded-xl border border-stone-200 p-1 dark:border-stone-800">
            {[7, 30, 90].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${days === d ? 'bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'}`}
              >
                {zh ? `${d} 天` : `${d} d`}
              </button>
            ))}
          </div>
        </div>

        <p className="mb-3 flex items-center gap-1.5 text-xs text-stone-500">
          <ShieldCheck size={13} />
          {zh
            ? `仅用于账号安全与教学管理。只记录登录时间与方式，保留 ${retention ?? 180} 天；你的每次查看也会留痕。`
            : `For account security and teaching management only. Time and method are kept for ${retention ?? 180} days; each view is itself logged.`}
        </p>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-stone-500"><Loader2 size={15} className="animate-spin" />{zh ? '正在加载…' : 'Loading…'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="py-2 pr-3 font-medium">{zh ? '姓名' : 'Name'}</th>
                  <th className="py-2 pr-3 font-medium">{zh ? '身份' : 'Role'}</th>
                  <th className="py-2 pr-3 font-medium">{zh ? '最近登录' : 'Last sign-in'}</th>
                  <th className="py-2 pr-3 font-medium text-right">{zh ? `${days} 天内次数` : `Sign-ins / ${days} d`}</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {filtered.map(r => (
                  <React.Fragment key={r.userId}>
                    <tr className="align-top">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-stone-800 dark:text-stone-100">{r.name || r.email}</div>
                        <div className="text-xs text-stone-500">{r.email}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-stone-600 dark:text-stone-300">{roleLabel(r.role)}</td>
                      <td className="py-2.5 pr-3 text-stone-700 dark:text-stone-200">{formatLoginTime(r.lastLoginAt, lang)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-stone-700 dark:text-stone-200">{r.count}</td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggle(r.userId)}
                          className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                        >
                          {zh ? '明细' : 'Details'}
                          {openUser === r.userId ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      </td>
                    </tr>
                    {openUser === r.userId && (
                      <tr>
                        <td colSpan={5} className="pb-4 pt-1">
                          <LoginHistoryList records={detail[r.userId] ?? []} lang={lang} retentionDays={retention} loading={detailLoading === r.userId} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-sm text-stone-500">{zh ? '没有匹配的用户。' : 'No matching users.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};

export default LoginLogPanel;
