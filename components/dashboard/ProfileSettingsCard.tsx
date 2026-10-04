/**
 * 个人资料编辑卡。
 *
 * 头像不是装饰：画布上几十张卡挤在一起时，学生靠头像一眼认出自己的笔记，
 * 而不是逐张读署名。所以这里把头像放在最显眼的位置，其余字段依次排下。
 *
 * 真实姓名：教师和管理员可改，学生只读 —— 课堂记录和研究数据都用它认人，
 * 学生改名会让历史署名对不上；教师的名字是自己注册时填的，填错了没人能替他改。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronDown, ChevronUp, Loader2, Lock } from 'lucide-react';
import { auth as authApi, ApiClientError, loginLogs, type AuthUser, type LoginRecord } from '../../services/apiClient';
import { LoginHistoryList } from './LoginLogPanel';
import { useAuth } from '../../contexts/AuthContext';
import UserAvatar from '../UserAvatar';
import type { Language } from '../../types';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

interface Props {
  lang: Language;
  roleLabel: string;
}

const ProfileSettingsCard: React.FC<Props> = ({ lang, roleLabel }) => {
  const { user, applyUser } = useAuth();
  const zh = lang === 'zh';
  const [showLogins, setShowLogins] = useState(false);
  const [logins, setLogins] = useState<LoginRecord[] | null>(null);
  const [loginsRetention, setLoginsRetention] = useState<number | undefined>();
  const toggleLogins = () => {
    const next = !showLogins;
    setShowLogins(next);
    if (next && logins === null) {
      loginLogs.mine()
        .then(res => { setLogins(res.logins); setLoginsRetention(res.retentionDays); })
        .catch(() => setLogins([]));
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);

  // 学生改名会让历史署名和研究编号对不上，所以只开给教师和管理员。
  const canEditName = user?.role === 'teacher' || user?.role === 'admin';
  const [name, setName] = useState(user?.name ?? '');
  const [school, setSchool] = useState(user?.school ?? '');
  const [age, setAge] = useState(user?.age != null ? String(user.age) : '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * user 是异步到达的（AuthProvider 先 loading 再 setUser），
   * 而 useState 的初始值只在首次渲染取一次 —— 不补这一步，
   * 已保存的学院和年龄会显示成空白，学生一保存就把自己填过的清掉了。
   * 只在第一次拿到 user 时灌入，之后不再覆盖，免得打断正在输入的内容。
   */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!user || hydratedRef.current) return;
    hydratedRef.current = true;
    setName(user.name ?? '');
    setSchool(user.school ?? '');
    setAge(user.age != null ? String(user.age) : '');
    setBio(user.bio ?? '');
  }, [user]);

  const dirty =
    (canEditName && (user?.name ?? '') !== name) ||
    (user?.school ?? '') !== school ||
    (user?.age != null ? String(user.age) : '') !== age ||
    (user?.bio ?? '') !== bio;

  const fail = (err: unknown, fallback: string) => {
    setError(err instanceof ApiClientError || err instanceof Error ? err.message : fallback);
  };

  const handleSave = async () => {
    setError(null);
    if (age.trim()) {
      const n = Number(age);
      if (!Number.isInteger(n) || n < 5 || n > 120) {
        setError(zh ? '年龄需为 5–120 之间的整数。' : 'Age must be a whole number between 5 and 120.');
        return;
      }
    }
    if (canEditName && !name.trim()) {
      setError(zh ? '姓名不能为空。' : 'Name cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      const { user: updated } = await authApi.updateProfile({
        ...(canEditName && name.trim() !== (user?.name ?? '') ? { name: name.trim() } : {}),
        school: school.trim() || null,
        age: age.trim() ? Number(age) : null,
        bio: bio.trim() || null,
      });
      applyUser(updated as AuthUser);
      setSavedAt(Date.now());
    } catch (err) {
      fail(err, zh ? '保存失败，请稍后重试。' : 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一个文件
    if (!file) return;
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError(zh ? '请选择图片文件（PNG、JPG、GIF、WebP）。' : 'Pick an image file (PNG, JPG, GIF, WebP).');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError(zh ? '头像不能超过 5MB。' : 'Avatar must be under 5MB.');
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const { user: updated } = await authApi.uploadAvatar({
        file_name: file.name,
        mime_type: file.type,
        data_url: dataUrl,
      });
      applyUser(updated as AuthUser);
      setSavedAt(Date.now());
    } catch (err) {
      fail(err, zh ? '头像上传失败，请稍后重试。' : 'Avatar upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const labelCls = 'block text-[0.8125rem] font-semibold text-stone-700 dark:text-stone-200';
  const inputCls =
    'mt-1.5 w-full min-h-[44px] rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 ' +
    'placeholder:text-stone-400 transition-colors focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 ' +
    'dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:ring-stone-100/10';

  return (
    <div className="rounded-[24px] border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-950">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        {/* 头像 */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <UserAvatar name={user?.name} avatar={user?.avatar} size={96} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label={zh ? '更换头像' : 'Change avatar'}
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition-colors hover:bg-stone-50 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            </button>
          </div>
          <div className="max-w-[160px] text-center text-[0.6875rem] leading-relaxed text-stone-500 dark:text-stone-400">
            {zh ? '头像会显示在你的每一条笔记上' : 'Your avatar appears on every note you write'}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePickAvatar} />
        </div>

        {/* 字段 */}
        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <label className={labelCls}>{zh ? '真实姓名' : 'Real name'}</label>
            {canEditName ? (
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={50}
                placeholder={zh ? '你在课堂中的显示名称' : 'How you appear in class'}
                className="mt-1.5 min-h-[44px] w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-sm font-medium text-stone-900 outline-none transition-colors focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
              />
            ) : (
              <div className="mt-1.5 flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 dark:border-stone-800 dark:bg-stone-900">
                <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{user?.name ?? ''}</span>
                <Lock size={13} className="ml-auto flex-shrink-0 text-stone-400" />
              </div>
            )}
            <p className="mt-1.5 text-[0.6875rem] text-stone-500 dark:text-stone-400">
              {canEditName
                ? (zh
                  ? '姓名即你在课堂中的显示名称。改了之后，你以往发言和已发布反馈上的署名会一并更新。'
                  : 'Your name is how you appear in class. Changing it also updates your name on posts and feedback you published earlier.')
                : (zh
                  ? '姓名即你在课堂中的显示名称，不可修改。需要更正请联系教师。'
                  : 'Your name is how you appear in class and cannot be changed. Contact your teacher to correct it.')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="profile-school">{zh ? '所在学院' : 'College'}</label>
              <input
                id="profile-school"
                type="text"
                value={school}
                maxLength={100}
                onChange={e => setSchool(e.target.value)}
                placeholder={zh ? '如：教育信息技术学院' : 'e.g. School of Education'}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="profile-age">{zh ? '年龄' : 'Age'}</label>
              <input
                id="profile-age"
                type="number"
                min={5}
                max={120}
                value={age}
                onChange={e => setAge(e.target.value)}
                placeholder={zh ? '如：20' : 'e.g. 20'}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="profile-bio">{zh ? '一句话介绍' : 'About you'}</label>
            <textarea
              id="profile-bio"
              value={bio}
              maxLength={300}
              rows={2}
              onChange={e => setBio(e.target.value)}
              placeholder={zh ? '选填，让同学更快认识你' : 'Optional, helps classmates know you'}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
              {roleLabel}
            </div>
            <div className="truncate text-xs text-stone-500 dark:text-stone-400">{user?.email ?? ''}</div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-stone-50 transition-all duration-200 hover:bg-stone-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {zh ? '保存资料' : 'Save profile'}
            </button>
            {savedAt && !dirty && !saving && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <Check size={15} />
                {zh ? '已保存' : 'Saved'}
              </span>
            )}
          </div>

          <div className="border-t border-stone-200 pt-4 dark:border-stone-800">
            <button
              type="button"
              onClick={toggleLogins}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-stone-700 dark:text-stone-200"
            >
              {zh ? '最近登录记录' : 'Recent sign-ins'}
              {showLogins ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {showLogins && (
              <div className="mt-3">
                <LoginHistoryList records={logins ?? []} lang={lang} retentionDays={loginsRetention} loading={logins === null} />
                <p className="mt-2 text-xs text-stone-500">
                  {zh
                    ? '平台管理员和你所在课程的创建者 / 课程管理员也能看到这些时间，用于账号安全与教学管理；他们的查看会留痕。'
                    : 'Platform admins and the creators / managers of your courses can also see these times, for account security and teaching management; their views are logged.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileSettingsCard;
