import React, { useEffect, useMemo, useState } from 'react';
import RemixIcon from './RemixIcon';
import { groupAssignments, type ApiGroupAssignment, type GroupAssignmentInput } from '../services/apiClient';
import { MORANDI, chipStyle, noticeStyle } from './morandiPalette';
import { useLayoutMotion } from '../hooks/useLayoutMotion';
import { dueLabel, fromLocalInput, placementLabel, toLocalInput } from './groupAssignmentModel';
import { WELCOME_VIEW_ID } from './viewPalette';

/**
 * 小组管理里的「发布任务」（只给课程教职，2026-10-10 用户）：写任务内容和要求，一键发给各组；
 * 可选发到哪个视图，不选就在所有视图里显示。发出去的任务在小组进到视图时以任务面板出现，不是笔记。
 * 已发布的可以修改、撤回；列表的增减用 anime.js 布局动画。
 */

interface Props {
  courseId: string;
  groups: Array<{ id: string; name: string }>;
  /** 当前空间的视图（含主画布、各组的视图） */
  views: Array<{ id: string; title: string; groupId?: string | null }>;
  /** 当前所在的空间：选视图时任务就挂在这个空间的视图上 */
  spaceId?: string;
  lang: 'zh' | 'en';
  /** 发布、修改、撤回之后通知工作区刷新任务面板 */
  onChanged?: () => void;
}

interface Draft {
  title: string;
  content: string;
  requirements: string;
  due: string;
  /** 'any' | 'group_view' | `view:<id>` */
  where: string;
  groupIds: Set<string>;
}

const emptyDraft = (groups: Props['groups']): Draft => ({
  title: '', content: '', requirements: '', due: '', where: 'any', groupIds: new Set(groups.map(g => g.id)),
});

/** 表单里的位置 → 接口字段 */
export function placementBody(where: string, spaceId: string | undefined): Pick<GroupAssignmentInput, 'placement' | 'space_id' | 'view_id'> {
  if (where === 'group_view' && spaceId) return { placement: 'group_view', space_id: spaceId, view_id: null };
  if (where.startsWith('view:') && spaceId) return { placement: 'view', space_id: spaceId, view_id: where.slice(5) };
  return { placement: 'any', space_id: null, view_id: null };
}

const T = {
  zh: {
    formTitle: '发布新任务', editTitle: '修改任务', title: '任务标题', titlePh: '例如：第 3 周小组任务',
    content: '任务内容', contentPh: '这次要做什么、读什么材料、产出什么', requirements: '要求', requirementsPh: '每行一条，例如：\n每人至少提出一个观点\n至少回应一位同学并说明理由',
    requirementsHint: '每行一条，任务面板里逐条列出', due: '截止时间（可选）', clearDue: '不设截止',
    view: '显示在哪（可选）', viewAll: '不限：所有视图都显示', viewGroups: '各组自己的视图', viewGroupsMissing: '各组自己的视图（先在「小组概览」里为每组建视图）',
    viewPick: '指定视图', viewHint: '选「各组自己的视图」，每组只在自己的视图里看到；选了某个视图，任务只在那里出现',
    groups: '发给哪些组', all: '全选', none: '全不选', publish: (n: number) => `发布给 ${n} 个小组`, save: '保存修改', cancelEdit: '取消修改',
    publishing: '发布中…', saving: '保存中…', published: (n: number) => `已发布给 ${n} 个小组，组员会收到通知。`, saved: '已保存修改。',
    listTitle: '已发布的任务', empty: '还没有发布任务。', edit: '修改', withdraw: '撤回', confirmWithdraw: '确定撤回？各组的任务面板里会一起消失。',
    yes: '撤回', no: '先不撤', withdrawn: '已撤回。', failed: '没有成功，请再试一次。', noGroups: '这门课还没有小组，先在「小组概览」里建组。',
    to: '发给', where: '显示在', otherSpace: '位置在另一个空间，修改时保持不变',
  },
  en: {
    formTitle: 'Publish a task', editTitle: 'Edit task', title: 'Title', titlePh: 'e.g. Week 3 group task',
    content: 'What to do', contentPh: 'What groups should do, read and produce', requirements: 'Requirements', requirementsPh: 'One per line, e.g.\nEveryone posts at least one idea\nBuild on at least one classmate and say why',
    requirementsHint: 'One per line; listed one by one in the task panel', due: 'Due (optional)', clearDue: 'No due date',
    view: 'Where to show (optional)', viewAll: 'Any: show in every view', viewGroups: "Each group's own view", viewGroupsMissing: "Each group's own view (create group views under Overview first)",
    viewPick: 'A specific view', viewHint: "With each group's own view, every group sees it only in its view; a specific view shows it only there",
    groups: 'Groups', all: 'All', none: 'None', publish: (n: number) => `Publish to ${n} group${n === 1 ? '' : 's'}`, save: 'Save changes', cancelEdit: 'Cancel',
    publishing: 'Publishing…', saving: 'Saving…', published: (n: number) => `Published to ${n} group${n === 1 ? '' : 's'}; members are notified.`, saved: 'Changes saved.',
    listTitle: 'Published tasks', empty: 'No tasks yet.', edit: 'Edit', withdraw: 'Withdraw', confirmWithdraw: 'Withdraw this task? It disappears from every group panel.',
    yes: 'Withdraw', no: 'Keep', withdrawn: 'Withdrawn.', failed: 'That did not work. Please try again.', noGroups: 'This course has no groups yet. Create some under Overview first.',
    to: 'To', where: 'Shown in', otherSpace: 'Placed in another space; kept as is when you edit',
  },
};

const inputClass = 'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-[#000080]/40 focus:ring-2 focus:ring-[#000080]/10';

const GroupAssignmentPublisher: React.FC<Props> = ({ courseId, groups, views, spaceId, lang, onChanged }) => {
  const t = T[lang];
  const [list, setList] = useState<ApiGroupAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(groups));
  const [editing, setEditing] = useState<ApiGroupAssignment | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const motion = useLayoutMotion<HTMLOListElement>({ step: 30, maxStagger: 8 });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    groupAssignments.listForCourse(courseId)
      .then(({ assignments }) => { if (alive) setList(assignments); })
      .catch(() => { if (alive) setList([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [courseId]);

  // 组的名单晚到时，新建的草稿默认全选
  const groupKey = groups.map(g => g.id).join('|');
  useEffect(() => {
    if (editing) return;
    setDraft(d => (d.title || d.content || d.requirements ? d : emptyDraft(groups)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey]);

  useEffect(() => {
    if (!notice || notice.tone !== 'ok') return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const viewOptions = useMemo(() => views.map(v => ({ id: v.id, title: v.id === WELCOME_VIEW_ID ? `${v.title}（${lang === 'zh' ? '主画布' : 'main canvas'}）` : v.title })), [views, lang]);
  const hasGroupViews = views.some(v => v.groupId);
  const editingElsewhere = Boolean(editing?.spaceId && editing.spaceId !== spaceId);
  const canSubmit = draft.title.trim().length > 0 && draft.groupIds.size > 0 && !busy;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));
  const toggleGroup = (id: string) => setDraft(d => {
    const next = new Set(d.groupIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...d, groupIds: next };
  });

  const startEdit = (a: ApiGroupAssignment) => {
    setEditing(a);
    setConfirmId(null);
    setNotice(null);
    const where = a.spaceId !== spaceId || a.placement === 'any' ? 'any' : a.placement === 'group_view' ? 'group_view' : `view:${a.viewId}`;
    setDraft({
      title: a.title, content: a.content, requirements: a.requirementsText, due: toLocalInput(a.dueAt),
      where, groupIds: new Set(a.groups.map(g => g.id)),
    });
  };
  const cancelEdit = () => { setEditing(null); setDraft(emptyDraft(groups)); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setNotice(null);
    const body: GroupAssignmentInput = {
      title: draft.title.trim(), content: draft.content, requirements: draft.requirements,
      due_at: fromLocalInput(draft.due), group_ids: [...draft.groupIds], lang,
    };
    if (!editingElsewhere) Object.assign(body, placementBody(draft.where, spaceId));
    try {
      if (editing) {
        const { assignment } = await groupAssignments.update(editing.id, body);
        motion.capture();
        setList(prev => prev.map(a => (a.id === assignment.id ? assignment : a)));
        setEditing(null);
        setNotice({ tone: 'ok', text: t.saved });
      } else {
        const { assignment } = await groupAssignments.publish(courseId, body);
        motion.capture();
        setList(prev => [assignment, ...prev]);
        setNotice({ tone: 'ok', text: t.published(assignment.groups.length) });
      }
      setDraft(emptyDraft(groups));
      onChanged?.();
    } catch {
      setNotice({ tone: 'error', text: t.failed });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    setBusy(true);
    try {
      await groupAssignments.withdraw(id);
      motion.capture();
      setList(prev => prev.filter(a => a.id !== id));
      setConfirmId(null);
      if (editing?.id === id) cancelEdit();
      setNotice({ tone: 'ok', text: t.withdrawn });
      onChanged?.();
    } catch {
      setNotice({ tone: 'error', text: t.failed });
    } finally {
      setBusy(false);
    }
  };

  if (groups.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-500">{t.noGroups}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 lg:flex-row">
      <form onSubmit={submit} className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 lg:w-[26rem] lg:shrink-0">
        <h3 className="text-[0.9375rem] font-bold tracking-tight text-zinc-900">{editing ? t.editTitle : t.formTitle}</h3>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-600">{t.title}</span>
          <input value={draft.title} onChange={e => set('title', e.target.value)} maxLength={200} placeholder={t.titlePh} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-600">{t.content}</span>
          <textarea value={draft.content} onChange={e => set('content', e.target.value)} maxLength={8000} rows={4} placeholder={t.contentPh} className={`${inputClass} resize-y leading-relaxed`} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-600">{t.requirements}</span>
          <textarea value={draft.requirements} onChange={e => set('requirements', e.target.value)} maxLength={8000} rows={4} placeholder={t.requirementsPh} className={`${inputClass} resize-y leading-relaxed`} />
          <span className="mt-1 block text-[0.6875rem] text-zinc-400">{t.requirementsHint}</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-zinc-600">{t.due}</span>
            <div className="flex items-center gap-2">
              <input type="datetime-local" value={draft.due} onChange={e => set('due', e.target.value)} className={inputClass} />
              {draft.due && (
                <button type="button" onClick={() => set('due', '')} className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800">{t.clearDue}</button>
              )}
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-zinc-600">{t.view}</span>
            {editingElsewhere ? (
              <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-500">{t.otherSpace}</p>
            ) : (
              <select value={draft.where} onChange={e => set('where', e.target.value)} disabled={!spaceId} className={inputClass}>
                <option value="any">{t.viewAll}</option>
                <option value="group_view" disabled={!hasGroupViews}>{hasGroupViews ? t.viewGroups : t.viewGroupsMissing}</option>
                <optgroup label={t.viewPick}>
                  {viewOptions.map(v => <option key={v.id} value={`view:${v.id}`}>{v.title}</option>)}
                </optgroup>
              </select>
            )}
            <span className="mt-1 block text-[0.6875rem] text-zinc-400">{t.viewHint}</span>
          </label>
        </div>
        <fieldset>
          <legend className="mb-1.5 flex w-full items-center gap-2 text-xs font-medium text-zinc-600">
            {t.groups}
            <span className="ml-auto flex gap-1">
              <button type="button" onClick={() => set('groupIds', new Set(groups.map(g => g.id)))} className="rounded-md px-1.5 py-0.5 text-[0.6875rem] text-[#000080] hover:bg-[#000080]/[0.06]">{t.all}</button>
              <button type="button" onClick={() => set('groupIds', new Set())} className="rounded-md px-1.5 py-0.5 text-[0.6875rem] text-zinc-500 hover:bg-zinc-100">{t.none}</button>
            </span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {groups.map(g => {
              const on = draft.groupIds.has(g.id);
              return (
                <button key={g.id} type="button" aria-pressed={on} onClick={() => toggleGroup(g.id)}
                  className={`min-h-8 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 ${on ? 'border-[#000080]/40 bg-[#000080]/[0.07] text-[#000080]' : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'}`}>
                  {on && <RemixIcon name="check-line" size={12} className="mr-1 -ml-0.5" />}{g.name}
                </button>
              );
            })}
          </div>
        </fieldset>
        {notice && <div className="rounded-xl border px-3.5 py-2.5 text-xs" style={noticeStyle(notice.tone === 'ok' ? MORANDI.sage : MORANDI.rose)}>{notice.text}</div>}
        <div className="mt-auto flex items-center gap-2 pt-1">
          <button type="submit" disabled={!canSubmit}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#000080] px-4 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#000066] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
            <RemixIcon name={editing ? 'save-line' : 'send-plane-line'} size={15} />
            {busy ? (editing ? t.saving : t.publishing) : (editing ? t.save : t.publish(draft.groupIds.size))}
          </button>
          {editing && (
            <button type="button" onClick={cancelEdit} className="min-h-10 rounded-xl px-3 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800">{t.cancelEdit}</button>
          )}
        </div>
      </form>

      <section className="flex min-h-0 flex-1 flex-col">
        <h3 className="mb-3 text-[0.9375rem] font-bold tracking-tight text-zinc-900">{t.listTitle}</h3>
        {loading ? (
          <div className="space-y-3">{[0, 1].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-zinc-200/60" />)}</div>
        ) : list.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 bg-white/60 py-10 text-center text-sm text-zinc-400">{t.empty}</p>
        ) : (
          <ol ref={motion.ref} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {list.map(a => {
              const due = dueLabel(a.dueAt, lang);
              return (
                <li key={a.id} data-layout-item
                  className={`rounded-2xl border bg-white p-4 transition-colors ${editing?.id === a.id ? 'border-[#000080]/40 ring-2 ring-[#000080]/10' : 'border-zinc-200'}`}>
                  <div className="flex items-start gap-2">
                    <h4 className="min-w-0 flex-1 text-sm font-bold tracking-tight text-zinc-900">{a.title}</h4>
                    {due && <span className="shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium" style={chipStyle(due.tone === 'overdue' ? MORANDI.rose : due.tone === 'soon' ? MORANDI.ochre : MORANDI.dustyBlue)}>{due.text}</span>}
                  </div>
                  {a.content && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-600">{a.content}</p>}
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-zinc-500">
                    <span>{t.to} {a.groups.map(g => g.name).join(lang === 'zh' ? '、' : ', ')}</span>
                    <span>{t.where} {placementLabel(a, views, lang)}</span>
                    {a.requirements.length > 0 && <span>{lang === 'zh' ? `${a.requirements.length} 条要求` : `${a.requirements.length} requirements`}</span>}
                  </div>
                  {confirmId === a.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={noticeStyle(MORANDI.rose)}>
                      <span className="flex-1">{t.confirmWithdraw}</span>
                      <button type="button" disabled={busy} onClick={() => void withdraw(a.id)} className="rounded-lg bg-white/80 px-2.5 py-1 font-semibold">{t.yes}</button>
                      <button type="button" onClick={() => setConfirmId(null)} className="rounded-lg px-2.5 py-1">{t.no}</button>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-1">
                      <button type="button" onClick={() => startEdit(a)} className="min-h-8 rounded-lg px-2.5 text-xs font-medium text-[#000080] transition-colors hover:bg-[#000080]/[0.06]">{t.edit}</button>
                      <button type="button" onClick={() => setConfirmId(a.id)} className="min-h-8 rounded-lg px-2.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800">{t.withdraw}</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
};

export default GroupAssignmentPublisher;
