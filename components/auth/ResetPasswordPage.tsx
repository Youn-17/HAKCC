import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { auth } from '../../services/apiClient';

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;

  if (score <= 1) return { score: 1, label: 'Weak', color: 'bg-red-500' };
  if (score <= 2) return { score: 2, label: 'Fair', color: 'bg-amber-500' };
  if (score <= 3) return { score: 3, label: 'Good', color: 'bg-blue-500' };
  return { score: 4, label: 'Strong', color: 'bg-green-500' };
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    setAccessToken(params.get('access_token'));
    setRefreshToken(params.get('refresh_token'));
  }, []);

  const strength = newPassword ? getPasswordStrength(newPassword) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!accessToken || !refreshToken) {
      setError('Invalid or expired reset link. Please request a new one.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await auth.resetPassword(accessToken, refreshToken, newPassword);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-white/25 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 transition-all text-sm';

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-white dark:bg-[#111318] px-4">
      <div className="w-full max-w-[380px]">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-[0.75rem] text-gray-400 dark:text-white/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors mb-8">
          <ArrowLeft size={13} />
          Back to login
        </Link>

        <div className="mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
            <Lock size={18} className="text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-[1.375rem] font-semibold text-gray-900 dark:text-white tracking-tight">
            Set New Password
          </h1>
          <p className="text-gray-500 dark:text-white/35 text-[0.8125rem] mt-1.5">
            Enter your new password below.
          </p>
        </div>

        {error && (
          <div className="mb-5 flex items-start gap-2 px-3 py-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-red-700 dark:text-red-300 text-[0.75rem] leading-relaxed">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg text-green-700 dark:text-green-300 text-[0.75rem] leading-relaxed">
            <CheckCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>Password updated successfully. Redirecting to login...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 mb-1.5 tracking-wide">
                New Password
              </label>
              <input
                id="new-password" type="password" required minLength={6}
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className={inputCls}
              />
              {strength && (
                <div className="mt-2">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength.score ? strength.color : 'bg-gray-200 dark:bg-white/10'}`} />
                    ))}
                  </div>
                  <p className={`text-[0.6875rem] mt-1 ${strength.score <= 1 ? 'text-red-500' : strength.score <= 2 ? 'text-amber-500' : strength.score <= 3 ? 'text-blue-500' : 'text-green-500'}`}>
                    {strength.label}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-[0.75rem] font-medium text-gray-600 dark:text-white/45 mb-1.5 tracking-wide">
                Confirm Password
              </label>
              <input
                id="confirm-password" type="password" required minLength={6}
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className={inputCls}
              />
            </div>

            <button
              type="submit" disabled={submitting}
              className="w-full py-2.5 mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-[0.8125rem] cursor-pointer"
            >
              {submitting
                ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Updating...</>
                : 'Update Password'
              }
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
