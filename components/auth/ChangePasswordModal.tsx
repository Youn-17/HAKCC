import React, { useState } from 'react';
import { auth } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';

interface Props {
  open: boolean;
  onClose: () => void;
  zh: boolean;
}

const ChangePasswordModal: React.FC<Props> = ({ open, onClose, zh }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!open) return null;

  const t = {
    title: zh ? '修改密码' : 'Change Password',
    current: zh ? '当前密码' : 'Current password',
    next: zh ? '新密码' : 'New password',
    confirm: zh ? '确认新密码' : 'Confirm new password',
    hint: zh ? '至少 6 位字符' : 'At least 6 characters',
    mismatch: zh ? '两次输入的新密码不一致' : 'New passwords do not match',
    tooShort: zh ? '新密码至少需要 6 位字符' : 'New password must be at least 6 characters',
    wrongCurrent: zh ? '当前密码不正确' : 'Current password is incorrect',
    failed: zh ? '修改失败，请稍后重试' : 'Failed to change password, please try again',
    submit: zh ? '确认修改' : 'Update Password',
    cancel: zh ? '取消' : 'Cancel',
    success: zh ? '密码已更新' : 'Password updated',
    successHint: zh ? '下次登录请使用新密码。' : 'Use your new password the next time you sign in.',
    close: zh ? '完成' : 'Done',
  };

  const reset = () => {
    setCurrent(''); setNext(''); setConfirm('');
    setError(''); setDone(false); setLoading(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 6) { setError(t.tooShort); return; }
    if (next !== confirm) { setError(t.mismatch); return; }
    setLoading(true);
    try {
      await auth.changePassword(current, next);
      setDone(true);
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      setError(msg.includes('incorrect') || msg.includes('401') ? t.wrongCurrent : (msg || t.failed));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-950 outline-none transition-all duration-200 placeholder:text-zinc-400 focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/15 dark:border-gray-800 dark:bg-gray-900 dark:text-zinc-100 dark:focus:border-[#4169E1] dark:focus:ring-[#4169E1]/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-950"
        onClick={e => e.stopPropagation()}
      >
        {done ? (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/20">
              <RemixIcon name="checkbox-circle-fill" size={26} className="text-emerald-500" />
            </div>
            <h3 className="mt-3 text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-100">{t.success}</h3>
            <p className="mt-1 text-xs text-zinc-500">{t.successHint}</p>
            <button
              onClick={handleClose}
              className="mt-5 w-full rounded-xl bg-[#000080] py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#000080]/90 active:scale-[0.98] dark:bg-[#4169E1]"
            >
              {t.close}
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-100">{t.title}</h3>
              <button onClick={handleClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-gray-900">
                <RemixIcon name="close-line" size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{t.current}</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={current}
                  onChange={e => setCurrent(e.target.value)}
                  className={inputCls}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{t.next}</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={next}
                  onChange={e => setNext(e.target.value)}
                  className={inputCls}
                  autoComplete="new-password"
                  placeholder={t.hint}
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{t.confirm}</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className={inputCls}
                  autoComplete="new-password"
                  required
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-500">
                <input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} className="h-3.5 w-3.5 rounded accent-[#000080]" />
                {zh ? '显示密码' : 'Show passwords'}
              </label>
              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-600 dark:bg-red-900/15 dark:text-red-400">
                  <RemixIcon name="error-warning-line" size={14} className="mt-0.5 flex-shrink-0" />
                  {error}
                </div>
              )}
              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 transition-all duration-200 hover:bg-zinc-50 active:scale-[0.98] dark:border-gray-800 dark:text-zinc-300 dark:hover:bg-gray-900"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={loading || !current || !next || !confirm}
                  className="flex-1 rounded-xl bg-[#000080] py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#000080]/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#4169E1]"
                >
                  {loading ? (zh ? '提交中…' : 'Updating…') : t.submit}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ChangePasswordModal;
