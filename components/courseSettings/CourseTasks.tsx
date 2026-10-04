/**
 * 学习任务。
 *
 * 原先的毛病：编辑表单每次都把当前状态一起发出去，后端按「状态转换」校验，改个标题也被拒，
 * 而失败只打到控制台；截止时间把 datetime-local 的本地时间原样发出去，数据库按 UTC 存，
 * 东八区显示晚 8 小时，回填编辑框时又截了 UTC 的前 16 位；清空截止时间发的是 undefined，
 * 根本清不掉；「提交情况」的分子分母是同一个数。
 * 现在只发改了的字段，时间换算成带时区的 ISO，失败在页面上写出原因。
 */
import React, { useState } from 'react';
import { Language, CourseTask, CourseTaskStatus } from '../../types';
import { ApiClientError, courseSettings } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { MORANDI, chipStyle, noticeStyle } from '../morandiPalette';
import TaskSubmissionsView from './TaskSubmissionsView';

interface CourseTasksProps {
  courseId: string;
  tasks: CourseTask[];
  onTasksChange: React.Dispatch<React.SetStateAction<CourseTask[]>>;
  /** 重取任务列表：批改之后提交统计会变 */
  onRefresh: () => Promise<void> | void;
  /** 课程创建者、课程管理员、平台管理员。其他人只能看。 */
  canManage: boolean;
  lang: Language;
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;
const POINTS_MAX = 1000;

/** 和后端 VALID_TASK_STATUS_TRANSITIONS 一致：列出来的都是保存得了的 */
const NEXT_STATUSES: Record<CourseTaskStatus, CourseTaskStatus[]> = {
  draft: ['published'],
  published: ['closed', 'draft'],
  closed: ['published'],
};

const STATUS_TONE: Record<CourseTaskStatus, string> = {
  draft: MORANDI.stone,
  published: MORANDI.sage,
  closed: MORANDI.clay,
};

interface Draft {
  title: string;
  description: string;
  /** datetime-local 的值：本地时间，不带时区 */
  dueLocal: string;
  /** 输入框里的原样文字，保存时再校验 */
  points: string;
  status: CourseTaskStatus;
}

const NEW_DRAFT: Draft = { title: '', description: '', dueLocal: '', points: '100', status: 'published' };

const TRANSLATIONS = {
  en: {
    title: 'Assignments',
    addTask: 'New assignment',
    readOnly: 'Only the course creator and course managers can change assignments.',
    emptyStaff: 'No assignments yet.',
    emptyReadOnly: 'This course has no assignments yet.',
    titlePlaceholder: 'Assignment title',
    descriptionPlaceholder: 'What students should do (optional)',
    dueDate: 'Due',
    clearDue: 'Remove due date',
    points: 'Points',
    pointsHint: '0 means not scored',
    status: 'Status',
    statusShort: { draft: 'Draft', published: 'Published', closed: 'Closed' } as Record<CourseTaskStatus, string>,
    statusOption: {
      draft: 'Draft (hidden from students)',
      published: 'Published (students can submit)',
      closed: 'Closed (no more submissions)',
    } as Record<CourseTaskStatus, string>,
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit assignment',
    remove: 'Delete assignment',
    viewSubmissions: 'View submissions',
    noDue: 'No due date',
    overdue: ' (past due)',
    notScored: 'Not scored',
    pointsUnit: (n: number) => `${n} pts`,
    stats: (submitted: number, graded: number) => `${submitted} submitted · ${graded} graded`,
    titleRequired: 'Enter a title first.',
    pointsInvalid: `Points must be a whole number from 0 to ${POINTS_MAX}.`,
    dueInvalid: 'The due date is not a valid time.',
    deleteConfirm: (title: string, submissions: number) => submissions > 0
      ? `Delete "${title}"? The ${submissions} submission(s) students handed in are deleted with it and cannot be restored.`
      : `Delete "${title}"?`,
    addFailed: 'The assignment was not created: ',
    updateFailed: 'The assignment was not saved: ',
    deleteFailed: 'The assignment was not deleted: ',
    gone: 'This assignment no longer exists (it may have been deleted by another teacher).',
  },
  zh: {
    title: '学习任务',
    addTask: '布置任务',
    readOnly: '只有课程创建者和课程管理员可以修改学习任务。',
    emptyStaff: '还没有布置学习任务。',
    emptyReadOnly: '这门课还没有学习任务。',
    titlePlaceholder: '任务标题',
    descriptionPlaceholder: '要学生做什么（选填）',
    dueDate: '截止时间',
    clearDue: '去掉截止时间',
    points: '分值',
    pointsHint: '0 表示不计分',
    status: '状态',
    statusShort: { draft: '草稿', published: '已发布', closed: '已关闭' } as Record<CourseTaskStatus, string>,
    statusOption: {
      draft: '草稿（学生看不到）',
      published: '已发布（学生可以提交）',
      closed: '已关闭（不再收提交）',
    } as Record<CourseTaskStatus, string>,
    save: '保存',
    cancel: '取消',
    edit: '编辑任务',
    remove: '删除任务',
    viewSubmissions: '查看提交',
    noDue: '没有截止时间',
    overdue: '（已过截止时间）',
    notScored: '不计分',
    pointsUnit: (n: number) => `${n} 分`,
    stats: (submitted: number, graded: number) => `已交 ${submitted} 份 · 已批改 ${graded} 份`,
    titleRequired: '请先填写任务标题。',
    pointsInvalid: `分值要填 0 到 ${POINTS_MAX} 之间的整数。`,
    dueInvalid: '截止时间不是有效的时间。',
    deleteConfirm: (title: string, submissions: number) => submissions > 0
      ? `确定删除任务「${title}」吗？学生已经交的 ${submissions} 份提交会一起删除，不能恢复。`
      : `确定删除任务「${title}」吗？`,
    addFailed: '任务没有布置成功：',
    updateFailed: '任务没有保存成功：',
    deleteFailed: '任务没有删除成功：',
    gone: '这个任务已经不在了，可能被其他教师删掉了。',
  },
};

type Texts = typeof TRANSLATIONS['zh'];

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → datetime-local 要的本地时间。直接截 ISO 的前 16 位拿到的是 UTC，东八区差 8 小时。 */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 两个时间在分钟上是否相同。编辑框只到分钟，原值带秒的话不能当成改过。 */
function sameMinute(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return Math.floor(Date.parse(a) / 60_000) === Math.floor(Date.parse(b) / 60_000);
}

interface TaskFields {
  title: string;
  description: string | null;
  due_date: string | null;
  points: number;
  status: CourseTaskStatus;
}

/** 表单 → 要发给后端的值。datetime-local 的值按浏览器所在时区解释，换成带时区的 ISO。 */
function readDraft(draft: Draft, t: Texts): { fields: TaskFields } | { problem: string } {
  const title = draft.title.trim();
  if (!title) return { problem: t.titleRequired };
  const pointsText = draft.points.trim();
  const points = pointsText === '' ? 0 : Number(pointsText);
  if (!Number.isInteger(points) || points < 0 || points > POINTS_MAX) return { problem: t.pointsInvalid };
  let dueDate: string | null = null;
  if (draft.dueLocal) {
    const due = new Date(draft.dueLocal);
    if (Number.isNaN(due.getTime())) return { problem: t.dueInvalid };
    dueDate = due.toISOString();
  }
  return {
    fields: { title, description: draft.description.trim() || null, due_date: dueDate, points, status: draft.status },
  };
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-900 outline-none transition-[box-shadow,border-color] placeholder:text-stone-400 focus:border-stone-300 focus:ring-2 focus:ring-stone-200 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:ring-stone-700';

const labelClass = 'mb-1.5 block text-xs font-medium text-stone-500 dark:text-stone-400';

const primaryButton =
  'inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#000080] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#000080]/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';

const secondaryButton =
  'inline-flex min-h-[40px] items-center rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800';

const iconButton =
  'flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100';

interface TaskFormProps {
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** 状态下拉里能选的：新建是发布或草稿，编辑是当前状态加上能转去的 */
  statusOptions: CourseTaskStatus[];
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  t: Texts;
}

const TaskForm: React.FC<TaskFormProps> = ({ draft, onChange, statusOptions, onSubmit, onCancel, busy, t }) => (
  <div className="space-y-3">
    <input
      type="text"
      value={draft.title}
      maxLength={TITLE_MAX}
      placeholder={t.titlePlaceholder}
      aria-label={t.titlePlaceholder}
      onChange={e => onChange({ ...draft, title: e.target.value })}
      onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
      className={`${inputClass} font-medium`}
      autoFocus
    />
    <textarea
      value={draft.description}
      maxLength={DESCRIPTION_MAX}
      placeholder={t.descriptionPlaceholder}
      aria-label={t.descriptionPlaceholder}
      onChange={e => onChange({ ...draft, description: e.target.value })}
      className={`${inputClass} resize-y leading-relaxed`}
      rows={3}
    />
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="block">
        <span className={labelClass}>{t.dueDate}</span>
        <input
          type="datetime-local"
          value={draft.dueLocal}
          onChange={e => onChange({ ...draft, dueLocal: e.target.value })}
          className={inputClass}
        />
        {draft.dueLocal && (
          <button
            type="button"
            onClick={() => onChange({ ...draft, dueLocal: '' })}
            className="mt-1 text-xs text-stone-500 underline underline-offset-2 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
          >
            {t.clearDue}
          </button>
        )}
      </label>
      <label className="block">
        <span className={labelClass}>{t.points}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={POINTS_MAX}
          step={1}
          value={draft.points}
          onChange={e => onChange({ ...draft, points: e.target.value })}
          className={inputClass}
        />
        <span className="mt-1 block text-xs text-stone-400 dark:text-stone-500">{t.pointsHint}</span>
      </label>
      <label className="block">
        <span className={labelClass}>{t.status}</span>
        <select
          value={draft.status}
          onChange={e => onChange({ ...draft, status: e.target.value as CourseTaskStatus })}
          className={inputClass}
        >
          {statusOptions.map(status => (
            <option key={status} value={status}>{t.statusOption[status]}</option>
          ))}
        </select>
      </label>
    </div>
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className={secondaryButton}>{t.cancel}</button>
      <button type="button" onClick={onSubmit} disabled={busy || !draft.title.trim()} className={primaryButton}>
        <RemixIcon name={busy ? 'loader-4-line' : 'check-line'} size={16} className={busy ? 'animate-spin' : ''} />
        {t.save}
      </button>
    </div>
  </div>
);

const CourseTasks: React.FC<CourseTasksProps> = ({ courseId, tasks, onTasksChange, onRefresh, canManage, lang }) => {
  const t = TRANSLATIONS[lang];
  const [isAdding, setIsAdding] = useState(false);
  const [newTask, setNewTask] = useState<Draft>(NEW_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<Draft>(NEW_DRAFT);
  /** 'new' = 正在布置；否则是正在保存或删除的那个任务 */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<CourseTask | null>(null);

  const openAdd = () => {
    setError(null);
    setNewTask(NEW_DRAFT);
    setIsAdding(true);
  };

  const closeAdd = () => {
    setIsAdding(false);
    setNewTask(NEW_DRAFT);
  };

  const handleAdd = async () => {
    const read = readDraft(newTask, t);
    if ('problem' in read) { setError(read.problem); return; }
    setBusyId('new');
    setError(null);
    try {
      const { task } = await courseSettings.createTask(courseId, read.fields);
      onTasksChange(prev => [task, ...prev]);
      closeAdd();
    } catch (err) {
      setError(`${t.addFailed}${messageOf(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (task: CourseTask) => {
    setError(null);
    setEditingId(task.id);
    setEditTask({
      title: task.title,
      description: task.description ?? '',
      dueLocal: toLocalInput(task.dueDate),
      points: String(task.points ?? 0),
      status: task.status,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTask(NEW_DRAFT);
  };

  const dropIfGone = (err: unknown, taskId: string) => {
    if (err instanceof ApiClientError && err.status === 404) {
      onTasksChange(prev => prev.filter(task => task.id !== taskId));
      if (editingId === taskId) cancelEdit();
      setError(t.gone);
      return true;
    }
    return false;
  };

  const handleUpdate = async (task: CourseTask) => {
    const read = readDraft(editTask, t);
    if ('problem' in read) { setError(read.problem); return; }
    const next = read.fields;

    // 只发改了的字段。原先每次都带上当前状态，后端按「状态转换」拒收，改个标题都存不上
    const patch: Parameters<typeof courseSettings.updateTask>[2] = {};
    if (next.title !== task.title) patch.title = next.title;
    if (next.description !== (task.description ?? null)) patch.description = next.description;
    if (!sameMinute(next.due_date, task.dueDate)) patch.due_date = next.due_date;
    if (next.points !== task.points) patch.points = next.points;
    if (next.status !== task.status) patch.status = next.status;
    if (Object.keys(patch).length === 0) { cancelEdit(); return; }

    setBusyId(task.id);
    setError(null);
    try {
      const { task: updated } = await courseSettings.updateTask(courseId, task.id, patch);
      onTasksChange(prev => prev.map(item => (item.id === task.id ? updated : item)));
      cancelEdit();
    } catch (err) {
      if (!dropIfGone(err, task.id)) setError(`${t.updateFailed}${messageOf(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (task: CourseTask) => {
    if (!window.confirm(t.deleteConfirm(task.title, task.submissionStats.total))) return;
    setBusyId(task.id);
    setError(null);
    try {
      await courseSettings.deleteTask(courseId, task.id);
      onTasksChange(prev => prev.filter(item => item.id !== task.id));
      if (editingId === task.id) cancelEdit();
    } catch (err) {
      if (!dropIfGone(err, task.id)) setError(`${t.deleteFailed}${messageOf(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const formatDue = (iso: string) => {
    const date = new Date(iso);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      ...(sameYear ? {} : { year: 'numeric' as const }),
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight text-stone-900 dark:text-stone-100">
          <RemixIcon name="task-line" size={20} className="text-[#000080] dark:text-[#93AAFD]" />
          {t.title}
        </h3>
        {canManage && (
          <button type="button" onClick={openAdd} disabled={isAdding} className={primaryButton}>
            <RemixIcon name="add-line" size={16} />
            {t.addTask}
          </button>
        )}
      </div>

      {!canManage && (
        <p className="flex max-w-[65ch] items-start gap-2 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
          <RemixIcon name="lock-line" size={15} className="mt-0.5 shrink-0" />
          <span>{t.readOnly}</span>
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed" style={noticeStyle(MORANDI.rose)}>
          {error}
        </p>
      )}

      {canManage && isAdding && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-900">
          <TaskForm
            draft={newTask}
            onChange={setNewTask}
            statusOptions={['published', 'draft']}
            onSubmit={() => void handleAdd()}
            onCancel={closeAdd}
            busy={busyId === 'new'}
            t={t}
          />
        </div>
      )}

      {tasks.length === 0 ? (
        !isAdding && (
          <div className="flex min-h-[22rem] flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-200 bg-stone-50 px-6 py-12 text-center dark:border-stone-800 dark:bg-stone-900">
            <RemixIcon name="task-line" size={40} className="mb-3 text-stone-300 dark:text-stone-600" />
            <p className="max-w-sm text-sm leading-relaxed text-stone-500 dark:text-stone-400">
              {canManage ? t.emptyStaff : t.emptyReadOnly}
            </p>
            {canManage && (
              <button type="button" onClick={openAdd} className={`${primaryButton} mt-4`}>
                <RemixIcon name="add-line" size={15} />
                {t.addTask}
              </button>
            )}
          </div>
        )
      ) : (
        <ul className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          {tasks.map(task => {
            const overdue = task.status === 'published' && !!task.dueDate && Date.parse(task.dueDate) < Date.now();
            return (
              <li
                key={task.id}
                className="rounded-xl border border-stone-200 bg-white p-5 transition-shadow hover:shadow-md hover:shadow-stone-200/60 dark:border-stone-800 dark:bg-stone-950 dark:hover:shadow-none"
              >
                {editingId === task.id ? (
                  <TaskForm
                    draft={editTask}
                    onChange={setEditTask}
                    statusOptions={[task.status, ...NEXT_STATUSES[task.status]]}
                    onSubmit={() => void handleUpdate(task)}
                    onCancel={cancelEdit}
                    busy={busyId === task.id}
                    t={t}
                  />
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-stone-900 dark:text-stone-100">{task.title}</h4>
                        <span className="rounded-md border px-2 py-0.5 text-xs font-medium" style={chipStyle(STATUS_TONE[task.status] ?? MORANDI.stone)}>
                          {t.statusShort[task.status] ?? task.status}
                        </span>
                      </div>
                      {task.description && (
                        <p className="mt-1.5 line-clamp-3 max-w-[65ch] whitespace-pre-line text-sm leading-relaxed text-stone-600 dark:text-stone-300">
                          {task.description}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-stone-500 dark:text-stone-400">
                        <span className="flex items-center gap-1.5">
                          <RemixIcon name="calendar-event-line" size={14} />
                          {task.dueDate ? formatDue(task.dueDate) : t.noDue}
                          {overdue && <span className="text-xs">{t.overdue}</span>}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <RemixIcon name="award-line" size={14} />
                          {task.points > 0 ? t.pointsUnit(task.points) : t.notScored}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <RemixIcon name="group-line" size={14} />
                          {t.stats(task.submissionStats.submitted, task.submissionStats.graded)}
                        </span>
                      </div>
                    </div>
                    {canManage && (
                      <div className="-mb-2 -mr-2 flex shrink-0 items-center gap-1 self-end sm:mb-0 sm:mr-0 sm:self-start">
                        <button
                          type="button"
                          onClick={() => setViewing(task)}
                          className={iconButton}
                          title={t.viewSubmissions}
                          aria-label={`${t.viewSubmissions} ${task.title}`}
                        >
                          <RemixIcon name="eye-line" size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(task)}
                          disabled={busyId === task.id}
                          className={iconButton}
                          title={t.edit}
                          aria-label={`${t.edit} ${task.title}`}
                        >
                          <RemixIcon name="pencil-line" size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(task)}
                          disabled={busyId === task.id}
                          className={iconButton}
                          title={t.remove}
                          aria-label={`${t.remove} ${task.title}`}
                        >
                          <RemixIcon
                            name={busyId === task.id ? 'loader-4-line' : 'delete-bin-line'}
                            size={16}
                            className={busyId === task.id ? 'animate-spin' : ''}
                          />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {viewing && (
        <TaskSubmissionsView
          courseId={courseId}
          task={viewing}
          onClose={() => setViewing(null)}
          onGraded={() => void onRefresh()}
          lang={lang}
        />
      )}
    </div>
  );
};

export default CourseTasks;
