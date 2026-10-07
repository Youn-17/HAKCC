/**
 * 学习目标。
 *
 * 原先三处毛病：增删改失败只打到控制台，界面上什么都不说；改完、删完要把目标、资料、任务
 * 三个列表整个重取一遍，还不等结果就关掉表单；同一优先级里的顺序每次刷新都可能变。
 * 现在用接口返回的那条直接更新列表，失败就在页面上写出原因；排序和后端一致
 * （高优先级在前，同一档按添加先后）。只有课程创建者和课程管理员看得到增删改。
 */
import React, { useMemo, useState } from 'react';
import { Language, CourseGoal } from '../../types';
import { ApiClientError, courseSettings } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { MORANDI, chipStyle, noticeStyle } from '../morandiPalette';

interface CourseGoalsProps {
  courseId: string;
  goals: CourseGoal[];
  onGoalsChange: React.Dispatch<React.SetStateAction<CourseGoal[]>>;
  /** 课程创建者、课程管理员、平台管理员。其他人只能看。 */
  canManage: boolean;
  lang: Language;
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const PRIORITIES = [0, 1, 2] as const;
const PRIORITY_TONE: Record<number, string> = { 2: MORANDI.rose, 1: MORANDI.ochre, 0: MORANDI.stone };

interface Draft {
  title: string;
  description: string;
  priority: number;
}

const EMPTY_DRAFT: Draft = { title: '', description: '', priority: 0 };

const TRANSLATIONS = {
  en: {
    title: 'Learning Goals',
    addGoal: 'Add goal',
    usage: 'Lesson Prep references the first five goals by priority. Goals are not currently shown to students.',
    readOnly: 'Only the course creator and course managers can change the goals.',
    emptyStaff: 'No learning goals yet.',
    emptyReadOnly: 'This course has no learning goals yet.',
    titlePlaceholder: 'Goal title',
    descriptionPlaceholder: 'Description (optional)',
    priority: 'Priority',
    priorityShort: ['Low', 'Medium', 'High'],
    priorityLabel: ['Low priority', 'Medium priority', 'High priority'],
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit goal',
    remove: 'Delete goal',
    titleRequired: 'Enter a title first.',
    deleteConfirm: (title: string) => `Delete the goal "${title}"?`,
    addFailed: 'The goal was not added: ',
    updateFailed: 'The goal was not saved: ',
    deleteFailed: 'The goal was not deleted: ',
    gone: 'This goal no longer exists (it may have been deleted by another teacher).',
  },
  zh: {
    title: '学习目标',
    addGoal: '添加目标',
    usage: '备课助手参考优先级最高的前 5 项目标；学生端暂不展示。',
    readOnly: '只有课程创建者和课程管理员可以修改学习目标。',
    emptyStaff: '还没有学习目标。',
    emptyReadOnly: '这门课还没有设置学习目标。',
    titlePlaceholder: '目标标题',
    descriptionPlaceholder: '目标描述（选填）',
    priority: '优先级',
    priorityShort: ['低', '中', '高'],
    priorityLabel: ['低优先级', '中优先级', '高优先级'],
    save: '保存',
    cancel: '取消',
    edit: '编辑目标',
    remove: '删除目标',
    titleRequired: '请先填写目标标题。',
    deleteConfirm: (title: string) => `确定删除目标「${title}」吗？`,
    addFailed: '目标没有添加成功：',
    updateFailed: '目标没有保存成功：',
    deleteFailed: '目标没有删除成功：',
    gone: '这条目标已经不在了，可能被其他教师删掉了。',
  },
};

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 高优先级在前，同一档按添加先后，和后端的排序一致 */
function compareGoals(a: CourseGoal, b: CourseGoal): number {
  return (b.priority - a.priority) || ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-900 outline-none transition-[box-shadow,border-color] placeholder:text-stone-400 focus:border-stone-300 focus:ring-2 focus:ring-stone-200 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:ring-stone-700';

const primaryButton =
  'inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#000080] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#000080]/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';

const secondaryButton =
  'inline-flex min-h-[40px] items-center rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800';

const iconButton =
  'flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100';

interface GoalFormProps {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  t: typeof TRANSLATIONS['zh'];
}

const GoalForm: React.FC<GoalFormProps> = ({ draft, onChange, onSubmit, onCancel, busy, t }) => {
  const titleMissing = !draft.title.trim();
  return (
    <div className="space-y-3">
      <input
        type="text"
        value={draft.title}
        maxLength={TITLE_MAX}
        placeholder={t.titlePlaceholder}
        aria-label={t.titlePlaceholder}
        onChange={e => onChange({ ...draft, title: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (!titleMissing) onSubmit(); }
          if (e.key === 'Escape') onCancel();
        }}
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2" role="group" aria-label={t.priority}>
          <span className="text-sm font-medium text-stone-600 dark:text-stone-300">{t.priority}</span>
          {PRIORITIES.map(p => (
            <button
              key={p}
              type="button"
              aria-pressed={draft.priority === p}
              onClick={() => onChange({ ...draft, priority: p })}
              className={`min-h-[36px] min-w-[44px] rounded-lg border px-3 text-sm font-medium transition-colors ${
                draft.priority === p
                  ? 'border-[#000080] bg-[#000080] text-white'
                  : 'border-stone-200 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              {t.priorityShort[p]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={secondaryButton}>{t.cancel}</button>
          <button type="button" onClick={onSubmit} disabled={busy || titleMissing} className={primaryButton}>
            <RemixIcon name={busy ? 'loader-4-line' : 'check-line'} size={16} className={busy ? 'animate-spin' : ''} />
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
};

const CourseGoals: React.FC<CourseGoalsProps> = ({ courseId, goals, onGoalsChange, canManage, lang }) => {
  const t = TRANSLATIONS[lang];
  const [isAdding, setIsAdding] = useState(false);
  const [newGoal, setNewGoal] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState<Draft>(EMPTY_DRAFT);
  /** 'new' = 正在添加；否则是正在保存或删除的那条目标 */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedGoals = useMemo(() => [...goals].sort(compareGoals), [goals]);

  const openAdd = () => {
    setError(null);
    setNewGoal(EMPTY_DRAFT);
    setIsAdding(true);
  };

  const closeAdd = () => {
    setIsAdding(false);
    setNewGoal(EMPTY_DRAFT);
  };

  const handleAdd = async () => {
    const title = newGoal.title.trim();
    if (!title) { setError(t.titleRequired); return; }
    setBusyId('new');
    setError(null);
    try {
      const { goal } = await courseSettings.createGoal(courseId, {
        title,
        description: newGoal.description.trim() || null,
        priority: newGoal.priority,
      });
      onGoalsChange(prev => [...prev, goal]);
      closeAdd();
    } catch (err) {
      setError(`${t.addFailed}${messageOf(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (goal: CourseGoal) => {
    setError(null);
    setEditingId(goal.id);
    setEditGoal({ title: goal.title, description: goal.description ?? '', priority: goal.priority });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditGoal(EMPTY_DRAFT);
  };

  /** 服务器说这条已经不在了：列表里也拿掉，别让人对着它反复点 */
  const dropIfGone = (err: unknown, goalId: string) => {
    if (err instanceof ApiClientError && err.status === 404) {
      onGoalsChange(prev => prev.filter(g => g.id !== goalId));
      if (editingId === goalId) cancelEdit();
      setError(t.gone);
      return true;
    }
    return false;
  };

  const handleUpdate = async (goalId: string) => {
    const title = editGoal.title.trim();
    if (!title) { setError(t.titleRequired); return; }
    setBusyId(goalId);
    setError(null);
    try {
      const { goal } = await courseSettings.updateGoal(courseId, goalId, {
        title,
        description: editGoal.description.trim() || null,
        priority: editGoal.priority,
      });
      onGoalsChange(prev => prev.map(g => (g.id === goalId ? goal : g)));
      cancelEdit();
    } catch (err) {
      if (!dropIfGone(err, goalId)) setError(`${t.updateFailed}${messageOf(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (goal: CourseGoal) => {
    if (!window.confirm(t.deleteConfirm(goal.title))) return;
    setBusyId(goal.id);
    setError(null);
    try {
      await courseSettings.deleteGoal(courseId, goal.id);
      onGoalsChange(prev => prev.filter(g => g.id !== goal.id));
      if (editingId === goal.id) cancelEdit();
    } catch (err) {
      if (!dropIfGone(err, goal.id)) setError(`${t.deleteFailed}${messageOf(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="course-settings-section flex min-h-full max-w-4xl flex-col gap-5">
      <div className="course-settings-section-header flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight text-stone-900 dark:text-stone-100">
          <RemixIcon name="focus-3-line" size={20} className="text-[#000080] dark:text-[#93AAFD]" />
          {t.title}
        </h3>
        {canManage && (
          <button type="button" onClick={openAdd} disabled={isAdding} className={primaryButton}>
            <RemixIcon name="add-line" size={16} />
            {t.addGoal}
          </button>
        )}
      </div>

      <p className="flex max-w-[65ch] items-start gap-2 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
        <RemixIcon name={canManage ? 'information-line' : 'lock-line'} size={15} className="mt-0.5 shrink-0" />
        <span>{canManage ? t.usage : t.readOnly}</span>
      </p>

      {error && (
        <p role="alert" className="rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed" style={noticeStyle(MORANDI.rose)}>
          {error}
        </p>
      )}

      {canManage && isAdding && (
        <div className="course-settings-form-panel rounded-xl border border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-900">
          <GoalForm
            draft={newGoal}
            onChange={setNewGoal}
            onSubmit={() => void handleAdd()}
            onCancel={closeAdd}
            busy={busyId === 'new'}
            t={t}
          />
        </div>
      )}

      {sortedGoals.length === 0 ? (
        !isAdding && (
          <div className="flex min-h-[22rem] flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-200 bg-stone-50 px-6 py-12 text-center dark:border-stone-800 dark:bg-stone-900">
            <RemixIcon name="focus-3-line" size={40} className="mb-3 text-stone-300 dark:text-stone-600" />
            <p className="max-w-sm text-sm leading-relaxed text-stone-500 dark:text-stone-400">
              {canManage ? t.emptyStaff : t.emptyReadOnly}
            </p>
            {canManage && (
              <button type="button" onClick={openAdd} className={`${primaryButton} mt-4`}>
                <RemixIcon name="add-line" size={15} />
                {t.addGoal}
              </button>
            )}
          </div>
        )
      ) : (
        <ul className="course-goals-list space-y-3">
          {sortedGoals.map(goal => (
            <li
              key={goal.id}
              data-priority={goal.priority}
              className="course-settings-card course-goal-card rounded-xl border border-stone-200 bg-white p-5 transition-shadow hover:shadow-md hover:shadow-stone-200/60 dark:border-stone-800 dark:bg-stone-950 dark:hover:shadow-none"
            >
              {editingId === goal.id ? (
                <GoalForm
                  draft={editGoal}
                  onChange={setEditGoal}
                  onSubmit={() => void handleUpdate(goal.id)}
                  onCancel={cancelEdit}
                  busy={busyId === goal.id}
                  t={t}
                />
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-stone-900 dark:text-stone-100">{goal.title}</h4>
                      <span
                        className="rounded-md border px-2 py-0.5 text-xs font-medium"
                        style={chipStyle(PRIORITY_TONE[goal.priority] ?? MORANDI.stone)}
                      >
                        {t.priorityLabel[goal.priority] ?? t.priorityLabel[0]}
                      </span>
                    </div>
                    {goal.description && (
                      <p className="mt-1.5 max-w-[65ch] whitespace-pre-line text-sm leading-relaxed text-stone-600 dark:text-stone-300">
                        {goal.description}
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <div className="-mb-2 -mr-2 flex shrink-0 items-center gap-1 self-end sm:mb-0 sm:mr-0 sm:self-start">
                      <button
                        type="button"
                        onClick={() => startEdit(goal)}
                        disabled={busyId === goal.id}
                        className={iconButton}
                        title={t.edit}
                        aria-label={`${t.edit} ${goal.title}`}
                      >
                        <RemixIcon name="pencil-line" size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(goal)}
                        disabled={busyId === goal.id}
                        className={iconButton}
                        title={t.remove}
                        aria-label={`${t.remove} ${goal.title}`}
                      >
                        <RemixIcon
                          name={busyId === goal.id ? 'loader-4-line' : 'delete-bin-line'}
                          size={16}
                          className={busyId === goal.id ? 'animate-spin' : ''}
                        />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default CourseGoals;
