/**
 * AI 教学日志：按课次呈现「计划 → 实际 → 课堂发生了什么」。
 *
 * 系统统计的事实（笔记数、参与人数）和 AI 写的小结是分开的两块 ——
 * 日志要能当研究数据用，就必须看得出哪些是数出来的、哪些是模型写的。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Sparkles, Users, FileText, Link2, Pencil, Check } from 'lucide-react';
import { Language, Course } from '../../types';
import { courseSessions, type CourseSession } from '../../services/apiClient';
import { weekdayLabel } from '../courseSettings/scheduleShared';
import SessionConfirmForm from './SessionConfirmForm';

interface Props {
  lang: Language;
  courseId: string;
  courses?: Course[];
}

const STATUS_TONE: Record<string, string> = {
  held: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  cancelled: 'bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300',
  rescheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  planned: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
};

function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

const TeachingLogPanel: React.FC<Props> = ({ lang, courseId: initialCourseId, courses = [] }) => {
  const zh = lang === 'zh';
  const [activeCourseId, setActiveCourseId] = useState(initialCourseId);
  const courseId = activeCourseId || initialCourseId;
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    courseSessions.list(courseId)
      .then(res => alive && setSessions(res.sessions))
      .catch(err => alive && setError(err?.message ?? (zh ? '读取失败' : 'Failed to load')))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [courseId, zh]);

  const summary = useMemo(() => ({
    total: sessions.length,
    held: sessions.filter(s => s.status === 'held').length,
    rescheduled: sessions.filter(s => s.status === 'rescheduled').length,
    cancelled: sessions.filter(s => s.status === 'cancelled').length,
    pending: sessions.filter(s => s.status === 'planned' && new Date(s.plannedAt).getTime() < Date.now()).length,
  }), [sessions]);

  const replace = (updated: CourseSession) =>
    setSessions(prev => prev.map(s => (s.id === updated.id ? updated : s)));

  const generate = async (session: CourseSession) => {
    setGenerating(session.id);
    setError(null);
    try {
      const { session: updated } = await courseSessions.summarize(session.id);
      replace(updated);
    } catch (err: any) {
      setError(err?.message ?? (zh ? '生成失败，请稍后再试' : 'Generation failed'));
    } finally {
      setGenerating(null);
    }
  };

  const saveEdit = async (session: CourseSession) => {
    try {
      const { session: updated } = await courseSessions.summarize(session.id, draft);
      replace(updated);
      setEditing(null);
    } catch (err: any) {
      setError(err?.message ?? (zh ? '保存失败' : 'Failed to save'));
    }
  };

  const statusLabel = (status: string) => {
    if (zh) return { held: '已上课', cancelled: '未上课', rescheduled: '已调课', planned: '待确认' }[status] ?? status;
    return { held: 'Held', cancelled: 'Cancelled', rescheduled: 'Rescheduled', planned: 'Pending' }[status] ?? status;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl border border-stone-200 bg-stone-100 p-2 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
            <CalendarClock size={17} />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
              {zh ? 'AI 教学日志' : 'AI Teaching Log'}
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {zh ? '逐次记录开课情况，并由 AI 汇总课堂建构活动' : 'Session records with AI-written summaries'}
            </p>
          </div>
        </div>
        {courses.length > 1 && (
          <select
            value={courseId}
            onChange={e => setActiveCourseId(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
          >
            {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-stone-400">
          <Loader2 size={16} className="mr-2 animate-spin" />{zh ? '加载中…' : 'Loading…'}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center dark:border-stone-700">
          <p className="text-sm text-stone-600 dark:text-stone-300">
            {zh ? '这门课还没有排定教学安排。' : 'No teaching schedule for this course yet.'}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
            {zh ? '在「我的课程」里打开课程设置 → 教学安排，填入上课周数和每周时段即可开始记录。' : 'Open Course Settings → Schedule to plan the term.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {([
              [zh ? '计划课次' : 'Planned', summary.total],
              [zh ? '已上课' : 'Held', summary.held],
              [zh ? '已调课' : 'Rescheduled', summary.rescheduled],
              [zh ? '未上课' : 'Cancelled', summary.cancelled],
              [zh ? '待确认' : 'To confirm', summary.pending],
            ] as [string, number][]).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-stone-200 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-950">
                <p className="text-xs text-stone-500 dark:text-stone-400">{label}</p>
                <p className="mt-0.5 text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{value}</p>
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>
          )}

          <div className="space-y-3">
            {sessions.map(session => {
              const past = new Date(session.plannedAt).getTime() < Date.now();
              const metrics = session.metrics ?? {};
              return (
                <div key={session.id} className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {zh ? `第 ${session.sessionNo} 次课` : `Session ${session.sessionNo}`}
                    </span>
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                      {zh ? `第 ${session.weekNo} 周` : `Week ${session.weekNo}`}
                    </span>
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                      {session.plannedDate} {weekdayLabel(isoWeekday(session.plannedDate), zh)} {session.plannedStart}
                    </span>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_TONE[session.status]}`}>
                      {statusLabel(session.status)}
                    </span>
                    {session.status === 'held' && session.actualDate && session.actualDate !== session.plannedDate && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        {zh ? `实际 ${session.actualDate}` : `Actually ${session.actualDate}`}
                      </span>
                    )}
                    {session.status === 'rescheduled' && session.movedToDate && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        {zh ? `调整至 ${session.movedToDate} ${session.movedToStart ?? ''}` : `Moved to ${session.movedToDate}`}
                      </span>
                    )}
                    {session.cancelReason && (
                      <span className="text-xs text-stone-500 dark:text-stone-400">{session.cancelReason}</span>
                    )}
                  </div>

                  {session.note && (
                    <p className="mt-2 text-xs leading-relaxed text-stone-600 dark:text-stone-300">{session.note}</p>
                  )}

                  {session.status === 'held' && (
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-stone-600 dark:text-stone-300">
                      <span className="inline-flex items-center gap-1"><Users size={13} />{zh ? '参与' : 'Participants'} {metrics.participants ?? 0}</span>
                      <span className="inline-flex items-center gap-1"><FileText size={13} />{zh ? '新增笔记' : 'Notes'} {metrics.notes ?? 0}</span>
                      <span className="inline-flex items-center gap-1"><Link2 size={13} />Build-on {metrics.build_ons ?? 0}</span>
                      <span className="inline-flex items-center gap-1"><Sparkles size={13} />{zh ? 'AI 反馈' : 'AI feedback'} {metrics.ai_feedbacks ?? 0}</span>
                    </div>
                  )}

                  {session.status === 'planned' && past && (
                    <div className="mt-3">
                      {confirming === session.id ? (
                        <SessionConfirmForm
                          session={session}
                          zh={zh}
                          onDone={updated => { replace(updated); setConfirming(null); }}
                          onCancel={() => setConfirming(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirming(session.id)}
                          className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900"
                        >
                          {zh ? '补记这次课' : 'Record this session'}
                        </button>
                      )}
                    </div>
                  )}

                  {session.status === 'held' && (
                    <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
                      {editing === session.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            rows={5}
                            className="w-full rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm leading-relaxed text-stone-900 outline-none focus:ring-2 focus:ring-stone-200 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:ring-stone-700"
                          />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => saveEdit(session)} className="flex items-center gap-1.5 rounded-lg bg-[#000080] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#000080]/90">
                              <Check size={13} />{zh ? '保存' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-300">
                              {zh ? '取消' : 'Cancel'}
                            </button>
                          </div>
                        </div>
                      ) : session.aiSummary ? (
                        <div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-stone-200">{session.aiSummary}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-stone-400 dark:text-stone-500">
                            <span>{session.aiSummaryEdited ? (zh ? '教师已修订' : 'Edited by teacher') : (zh ? 'AI 生成' : 'AI generated')}</span>
                            <button type="button" onClick={() => { setEditing(session.id); setDraft(session.aiSummary ?? ''); }} className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-stone-600 dark:hover:text-stone-300">
                              <Pencil size={12} />{zh ? '修改' : 'Edit'}
                            </button>
                            <button type="button" onClick={() => generate(session)} disabled={generating === session.id} className="underline underline-offset-2 hover:text-stone-600 disabled:opacity-50 dark:hover:text-stone-300">
                              {generating === session.id ? (zh ? '生成中…' : 'Generating…') : (zh ? '重新生成' : 'Regenerate')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => generate(session)}
                          disabled={generating === session.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900"
                        >
                          {generating === session.id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                          {zh ? '生成教学日志' : 'Generate log'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default TeachingLogPanel;
