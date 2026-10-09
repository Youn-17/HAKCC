import { courseSettingsError } from './errorText';
/**
 * 协作与权限：谁能和创建者一起管理这门课。
 *
 * 授予权只归创建者。课程管理员能改课程设置、排课、写教学日志、收课次提醒，
 * 但不能再指定别人 —— 否则权限会一层层扩散，创建者无从收回。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, Search, UserPlus, X, Crown } from 'lucide-react';
import { Language } from '../../types';
import { courseSettings, type CourseMember, type CourseRole } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import UserAvatar from '../UserAvatar';
import { inputClass, labelClass } from './scheduleShared';

interface Props {
  courseId: string;
  lang: Language;
}

const CourseAccess: React.FC<Props> = ({ courseId, lang }) => {
  const zh = lang === 'zh';
  const [members, setMembers] = useState<CourseMember[]>([]);
  const [standing, setStanding] = useState<CourseRole | 'none'>('none');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; full_name: string; email: string; avatar_url?: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const isOwner = standing === 'owner';

  const load = useCallback(async () => {
    try {
      const res = await courseSettings.listMembers(courseId);
      setMembers(res.members);
      setStanding(res.viewerStanding);
    } catch (err: any) {
      setError(courseSettingsError(err, zh, zh ? '加载失败，请重试。' : 'Unable to load data. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [courseId, zh]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isOwner || query.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { teachers } = await courseSettings.searchTeachers(courseId, query.trim());
        setResults(teachers);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, courseId, isOwner]);

  const teachers = members.filter(m => m.courseRole !== 'member' || m.role === 'teacher');
  const managers = teachers.filter(m => m.courseRole === 'manager');

  const setRole = async (userId: string, role: 'manager' | 'member') => {
    setBusyId(userId);
    setError(null);
    try {
      await courseSettings.setMemberRole(courseId, userId, role);
      setMembers(prev => prev.map(m => (m.userId === userId ? { ...m, courseRole: role } : m)));
    } catch (err: any) {
      setError(courseSettingsError(err, zh, zh ? '操作失败，请重试。' : 'Action failed. Please try again.'));
    } finally {
      setBusyId(null);
    }
  };

  const invite = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      await courseSettings.inviteTeacher(courseId, userId);
      setQuery('');
      setResults([]);
      await load();
    } catch (err: any) {
      setError(courseSettingsError(err, zh, zh ? '添加教师失败，请重试。' : 'Unable to add the teacher. Please try again.'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-stone-400">
        <Loader2 size={16} className="mr-2 animate-spin" />{zh ? '加载中…' : 'Loading…'}
      </div>
    );
  }

  return (
    <div className="course-settings-section max-w-4xl space-y-6">
      <div className="course-settings-section-header flex items-center gap-2.5">
        <div className="rounded-xl border border-stone-200 bg-stone-100 p-2 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
          <ShieldCheck size={17} />
        </div>
        <div>
          <h3 className="text-base font-semibold tracking-tight text-stone-950 dark:text-stone-100">
            {zh ? '协作与权限' : 'Collaboration & Access'}
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {zh ? '教师成员与课程管理权限' : 'Teacher membership and course management permissions'}
          </p>
        </div>
      </div>

      <details className="course-settings-guidance">
        <summary><RemixIcon name="shield-check-line" size={16} />{zh ? '课程管理员权限说明' : 'Course manager permissions'}<RemixIcon name="arrow-down-s-line" size={16} /></summary>
        <p className="mt-2 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
          {zh
            ? '课程管理员可维护课程设置与教学记录、接收课次补记提醒，并移除学生；无权移除教师或任命其他管理员。'
            : 'Course managers can maintain course settings and teaching records, receive session reminders, and remove students. They cannot remove teachers or appoint other managers.'}
        </p>
      </details>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>
      )}

      <div>
        <p className="mb-2.5 text-sm font-medium text-stone-700 dark:text-stone-300">
          {zh ? `教师成员（${teachers.length}）` : `Teacher members (${teachers.length})`}
          {managers.length > 0 && (
            <span className="ml-2 text-xs font-normal text-stone-500 dark:text-stone-400">
              {zh ? `课程管理员 ${managers.length} 人` : `${managers.length} manager${managers.length > 1 ? 's' : ''}`}
            </span>
          )}
        </p>

        <div className="course-settings-members divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {teachers.map(member => (
            <div key={member.userId} className="course-settings-member flex flex-wrap items-center gap-3 px-4 py-3">
              <UserAvatar name={member.name} avatar={member.avatar} size={34} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                  {member.name || (zh ? '未填写姓名' : 'Unnamed')}
                  {member.courseRole === 'owner' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      <Crown size={11} />{zh ? '创建者' : 'Creator'}
                    </span>
                  )}
                  {member.courseRole === 'manager' && (
                    <span className="rounded-md bg-[#000080]/10 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-[#000080] dark:bg-[#93AAFD]/15 dark:text-[#93AAFD]">
                      {zh ? '课程管理员' : 'Manager'}
                    </span>
                  )}
                </p>
                {member.email && <p className="truncate text-xs text-stone-500 dark:text-stone-400">{member.email}</p>}
              </div>

              {member.courseRole === 'owner' ? (
                <span className="text-xs text-stone-400 dark:text-stone-500">{zh ? '创建者身份不可更改' : 'Creator role cannot be changed'}</span>
              ) : isOwner ? (
                <button
                  type="button"
                  onClick={() => setRole(member.userId, member.courseRole === 'manager' ? 'member' : 'manager')}
                  disabled={busyId === member.userId}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 active:scale-[0.98] disabled:opacity-50 ${
                    member.courseRole === 'manager'
                      ? 'border-stone-200 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
                      : 'border-[#000080]/25 text-[#000080] hover:bg-[#000080]/[0.06] dark:border-[#93AAFD]/30 dark:text-[#93AAFD] dark:hover:bg-[#93AAFD]/10'
                  }`}
                >
                  {busyId === member.userId && <Loader2 size={12} className="animate-spin" />}
                  {member.courseRole === 'manager'
                    ? (zh ? '撤销管理权限' : 'Revoke management access')
                    : (zh ? '设为课程管理员' : 'Make course manager')}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {isOwner && (
        <div>
          <label className={labelClass}>{zh ? '添加教师' : 'Add teacher'}</label>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
            <input
              aria-label={zh ? '搜索教师' : 'Search teachers'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={zh ? '输入教师姓名或邮箱搜索…' : 'Search by name or email…'}
              className={`${inputClass} pl-9`}
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setResults([]); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-300"
                aria-label={zh ? '清空' : 'Clear'}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {searching && <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">{zh ? '搜索中…' : 'Searching…'}</p>}

          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
              {zh ? '未找到匹配教师。请核对姓名或邮箱，并确认对方已注册教师账号。' : 'No matching teacher found. Check the name or email and confirm they have a registered teacher account.'}
            </p>
          )}

          {results.length > 0 && (
            <div className="mt-2 divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
              {results.map(teacher => (
                <div key={teacher.id} className="flex items-center gap-3 px-4 py-2.5">
                  <UserAvatar name={teacher.full_name} avatar={teacher.avatar_url} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-stone-900 dark:text-stone-100">{teacher.full_name}</p>
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400">{teacher.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => invite(teacher.id)}
                    disabled={busyId === teacher.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#000080] px-3 py-1.5 text-xs font-medium text-white transition-all duration-200 hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-50"
                  >
                    {busyId === teacher.id ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                    {zh ? '添加至课程' : 'Add to course'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
            {zh ? '新增教师默认为普通成员；管理权限需另行授予。' : 'New teachers join as regular members. Management permissions must be granted separately.'}
          </p>
        </div>
      )}

      {!isOwner && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {zh ? '只有课程创建者可以指定或撤销课程管理员。' : 'Only the course creator can appoint or revoke managers.'}
        </p>
      )}
    </div>
  );
};

export default CourseAccess;
