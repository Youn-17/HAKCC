import { courseSettingsError } from './errorText';
/**
 * 一个学习任务的学生提交，课程教职在这里批改。
 *
 * 原先读不到列表时显示成「暂无提交」，批改失败也不出声；得分可以填得比满分还高；
 * 弹窗用的是纯黑遮罩、z-[110] 和蓝紫渐变头像，没有暗色模式。
 */
import React, { useEffect, useState } from 'react';
import { Language, CourseTask, TaskSubmission, TaskSubmissionStatus } from '../../types';
import { courseSettings } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import UserAvatar from '../UserAvatar';
import { MORANDI, chipStyle, noticeStyle } from '../morandiPalette';

interface TaskSubmissionsViewProps {
  courseId: string;
  task: Pick<CourseTask, 'id' | 'title' | 'points'>;
  onClose: () => void;
  /** 批改保存之后调用：任务列表里的提交统计要跟着变 */
  onGraded: () => void;
  lang: Language;
}

const STATUS_TONE: Record<TaskSubmissionStatus, string> = {
  pending: MORANDI.stone,
  submitted: MORANDI.dustyBlue,
  graded: MORANDI.sage,
  returned: MORANDI.ochre,
};

interface GradeDraft {
  /** 输入框里的原样文字，保存时再校验 */
  points: string;
  feedback: string;
}

const TRANSLATIONS = {
  en: {
    title: 'Student submissions',
    close: 'Close',
    empty: 'No student submissions yet.',
    loadFailed: 'Unable to load submissions. Please try again.',
    statusLabels: { pending: 'Not submitted', submitted: 'Submitted', graded: 'Graded', returned: 'Returned' } as Record<TaskSubmissionStatus, string>,
    submittedAt: (time: string) => `Submitted ${time}`,
    notSubmitted: 'Not submitted yet',
    unnamed: 'Unnamed',
    file: 'Attachment',
    video: 'Video link',
    drawing: 'This submission includes a drawing. Preview is not yet supported.',
    points: (max: number) => `Score (out of ${max})`,
    feedback: 'Feedback',
    feedbackPlaceholder: 'Feedback (optional)',
    save: 'Save grade',
    saved: 'Saved',
    pointsInvalid: (max: number) => `The score must be a whole number from 0 to ${max}.`,
    gradeFailed: 'Unable to save the grade. Please try again.',
    pointsUnit: (n: number) => `${n} pts`,
  },
  zh: {
    title: '学生提交',
    close: '关闭',
    empty: '暂无学生提交。',
    loadFailed: '提交记录加载失败，请重试。',
    statusLabels: { pending: '未提交', submitted: '已提交', graded: '已批改', returned: '已退回' } as Record<TaskSubmissionStatus, string>,
    submittedAt: (time: string) => `提交于 ${time}`,
    notSubmitted: '尚未提交',
    unnamed: '未填写姓名',
    file: '附件',
    video: '视频链接',
    drawing: '此提交包含绘图，当前暂不支持预览。',
    points: (max: number) => `得分（满分 ${max}）`,
    feedback: '评语',
    feedbackPlaceholder: '评语（选填）',
    save: '保存批改',
    saved: '已保存',
    pointsInvalid: (max: number) => `得分须为 0–${max} 的整数。`,
    gradeFailed: '批改保存失败，请重试。',
    pointsUnit: (n: number) => `${n} 分`,
  },
};

/** 只把 http(s) 链接做成可点的；后端也只收这两种，这里再挡一道 */
const isHttpUrl = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);

const draftOf = (submission: TaskSubmission): GradeDraft => ({
  points: submission.pointsAwarded != null ? String(submission.pointsAwarded) : '',
  feedback: submission.feedback ?? '',
});

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-900 outline-none transition-[box-shadow,border-color] placeholder:text-stone-400 focus:border-stone-300 focus:ring-2 focus:ring-stone-200 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:ring-stone-700';

const labelClass = 'mb-1.5 block text-xs font-medium text-stone-500 dark:text-stone-400';

const TaskSubmissionsView: React.FC<TaskSubmissionsViewProps> = ({ courseId, task, onClose, onGraded, lang }) => {
  const t = TRANSLATIONS[lang];
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, GradeDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    courseSettings.listSubmissions(courseId, task.id)
      .then(({ submissions: list }) => {
        if (!alive) return;
        setSubmissions(list);
        setDrafts(Object.fromEntries(list.map(s => [s.id, draftOf(s)])));
      })
      .catch(err => {
        if (alive) setLoadError(courseSettingsError(err, lang === 'zh', t.loadFailed));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [courseId, task.id, t]);

  // Esc 关闭；正在输入评语或得分时不关，免得一按就丢了没保存的内容
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const updateDraft = (id: string, patch: Partial<GradeDraft>) => {
    setDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? { points: '', feedback: '' }), ...patch } }));
    if (savedId === id) setSavedId(null);
  };

  const setRowError = (id: string, message: string | null) =>
    setRowErrors(prev => {
      const next = { ...prev };
      if (message) next[id] = message; else delete next[id];
      return next;
    });

  const handleGrade = async (submission: TaskSubmission) => {
    const draft = drafts[submission.id] ?? draftOf(submission);
    let points: number | null = null;
    if (task.points > 0 && draft.points.trim() !== '') {
      const value = Number(draft.points.trim());
      if (!Number.isInteger(value) || value < 0 || value > task.points) {
        setRowError(submission.id, t.pointsInvalid(task.points));
        return;
      }
      points = value;
    }

    setSavingId(submission.id);
    setRowError(submission.id, null);
    try {
      const { submission: updated } = await courseSettings.updateSubmission(courseId, task.id, submission.id, {
        feedback: draft.feedback.trim() || null,
        points_awarded: points,
        status: 'graded',
      });
      setSubmissions(prev => prev.map(item => (item.id === submission.id ? updated : item)));
      setDrafts(prev => ({ ...prev, [submission.id]: draftOf(updated) }));
      setSavedId(submission.id);
      onGraded();
    } catch (err) {
      setRowError(submission.id, courseSettingsError(err, lang === 'zh', t.gradeFailed));
    } finally {
      setSavingId(null);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-submissions-title"
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col rounded-2xl border border-stone-200 bg-white shadow-xl shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-950 dark:shadow-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-4 dark:border-stone-800">
          <div className="min-w-0">
            <h2 id="task-submissions-title" className="text-lg font-bold tracking-tight text-stone-900 dark:text-stone-100">
              {t.title}
            </h2>
            <p className="truncate text-sm text-stone-500 dark:text-stone-400">{task.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <RemixIcon name="close-line" size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1].map(i => (
                <div key={i} className="h-36 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-900" />
              ))}
            </div>
          ) : loadError ? (
            <p role="alert" className="rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed" style={noticeStyle(MORANDI.rose)}>
              {loadError}
            </p>
          ) : submissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-200 bg-stone-50 px-6 py-12 text-center dark:border-stone-800 dark:bg-stone-900">
              <RemixIcon name="file-text-line" size={40} className="mb-3 text-stone-300 dark:text-stone-600" />
              <p className="text-sm text-stone-500 dark:text-stone-400">{t.empty}</p>
            </div>
          ) : (
            <ul className="space-y-4">
              {submissions.map(submission => {
                const draft = drafts[submission.id] ?? draftOf(submission);
                const name = submission.student?.name?.trim() || t.unnamed;
                const fileUrl = isHttpUrl(submission.fileUrl) ? submission.fileUrl : null;
                const videoUrl = isHttpUrl(submission.videoUrl) ? submission.videoUrl : null;
                const hasDrawing = !!submission.drawingData && Object.keys(submission.drawingData).length > 0;
                const hasContent = !!submission.content || !!fileUrl || !!videoUrl || hasDrawing;
                const rowError = rowErrors[submission.id];
                const saving = savingId === submission.id;

                return (
                  <li key={submission.id} className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <UserAvatar name={name} avatar={submission.student?.avatar} size={36} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-stone-900 dark:text-stone-100">{name}</p>
                          <p className="text-xs text-stone-500 dark:text-stone-400">
                            {submission.submittedAt ? t.submittedAt(formatTime(submission.submittedAt)) : t.notSubmitted}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border px-2 py-0.5 text-xs font-medium" style={chipStyle(STATUS_TONE[submission.status] ?? MORANDI.stone)}>
                          {t.statusLabels[submission.status] ?? submission.status}
                        </span>
                        {submission.status === 'graded' && submission.pointsAwarded != null && (
                          <span className="rounded-md border px-2 py-0.5 text-xs font-medium" style={chipStyle(MORANDI.sage)}>
                            {t.pointsUnit(submission.pointsAwarded)}
                          </span>
                        )}
                      </div>
                    </div>

                    {hasContent && (
                      <div className="mt-4 space-y-2 rounded-lg bg-stone-50 p-4 dark:bg-stone-900">
                        {submission.content && (
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-stone-700 dark:text-stone-200">
                            {submission.content}
                          </p>
                        )}
                        {(fileUrl || videoUrl) && (
                          <div className="flex flex-wrap gap-4 text-sm">
                            {fileUrl && (
                              <a
                                href={fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[#000080] underline-offset-2 hover:underline dark:text-[#93AAFD]"
                              >
                                <RemixIcon name="download-2-line" size={14} />
                                {submission.fileName || t.file}
                              </a>
                            )}
                            {videoUrl && (
                              <a
                                href={videoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[#000080] underline-offset-2 hover:underline dark:text-[#93AAFD]"
                              >
                                <RemixIcon name="video-line" size={14} />
                                {t.video}
                              </a>
                            )}
                          </div>
                        )}
                        {hasDrawing && <p className="text-xs text-stone-500 dark:text-stone-400">{t.drawing}</p>}
                      </div>
                    )}

                    <div className={`mt-4 grid gap-3 border-t border-stone-200 pt-4 dark:border-stone-800 ${task.points > 0 ? 'sm:grid-cols-[10rem_minmax(0,1fr)]' : ''}`}>
                      {task.points > 0 && (
                        <label className="block">
                          <span className={labelClass}>{t.points(task.points)}</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={task.points}
                            step={1}
                            value={draft.points}
                            onChange={e => updateDraft(submission.id, { points: e.target.value })}
                            className={inputClass}
                          />
                        </label>
                      )}
                      <label className="block">
                        <span className={labelClass}>{t.feedback}</span>
                        <textarea
                          value={draft.feedback}
                          placeholder={t.feedbackPlaceholder}
                          onChange={e => updateDraft(submission.id, { feedback: e.target.value })}
                          className={`${inputClass} resize-y leading-relaxed`}
                          rows={3}
                        />
                      </label>
                    </div>

                    {rowError && (
                      <p role="alert" className="mt-3 rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed" style={noticeStyle(MORANDI.rose)}>
                        {rowError}
                      </p>
                    )}

                    <div className="mt-3 flex items-center justify-end gap-3">
                      {savedId === submission.id && (
                        <span className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
                          <RemixIcon name="check-line" size={14} />
                          {t.saved}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleGrade(submission)}
                        disabled={saving || submission.status === 'pending'}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#000080] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#000080]/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RemixIcon name={saving ? 'loader-4-line' : 'checkbox-circle-line'} size={16} className={saving ? 'animate-spin' : ''} />
                        {t.save}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-stone-200 px-6 py-4 dark:border-stone-800">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[40px] items-center rounded-lg border border-stone-200 px-5 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskSubmissionsView;
