import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, Check, Eye, EyeOff, Layers, Loader2,
  Pencil, Plus, Search, Star, Trash2, X,
} from 'lucide-react';
import { Language, Scaffold, ScaffoldMetadata } from '../types';
import { scaffolds as scaffoldsApi, trackEvent } from '../services/apiClient';
import {
  L1_LABEL, L1_ORDER, L1_TONE, gaiFlagForSave, type ScaffoldL1,
  groupScaffolds, scaffoldGroup, scaffoldL1, scaffoldLabel, scaffoldMatches,
} from './scaffoldLibrary';

/**
 * 支架管理。
 *
 * 支架条目本身就是学生在笔记里看到的那句话头，所以列表和表单的主字段是支架文本，
 * 不是分类名。
 *
 * 教师有两种不同的意图，界面必须分开：
 *   「这条我这门课不用」→ 隐藏，只影响本课程
 *   「这条写错了/不要了」→ 删除，全局支架会影响所有课程，所以要二次确认
 * 只给一个删除键，第一种意图就会被迫变成第二种。
 */

interface ScaffoldModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * 课程教职（创建者、课程管理员、平台管理员），按课内身份算。新建、修改、隐藏、删除支架和
   * 「强制使用支架」开关后端都只放行他们；在这门课里只是普通成员的教师账号和学生一样只能查阅、插入。
   */
  isStaff: boolean;
  lang: Language;
  scaffolds: Scaffold[];
  onUpdateScaffolds: (scaffolds: Scaffold[]) => void;
  onUseScaffold: (scaffold: Scaffold) => void;
  courseId?: string;
  spaceId?: string;
  /** 本课程是否强制使用支架（课程级开关） */
  requireScaffold?: boolean;
  onRequireScaffoldChange?: (value: boolean) => void;
}

interface DraftScaffold {
  id?: string;
  isGlobal: boolean;
  title: string;
  titleEn: string;
  description: string;
  l1: ScaffoldL1;
  group: string;
  isMandatory: boolean;
  isRecommended: boolean;
}

const ScaffoldModal: React.FC<ScaffoldModalProps> = ({
  isOpen, onClose, isStaff, lang, scaffolds, onUpdateScaffolds, onUseScaffold, courseId, spaceId,
  requireScaffold = false, onRequireScaffoldChange,
}) => {
  const canEdit = isStaff;
  const [policyBusy, setPolicyBusy] = useState(false);
  /** 先切界面再发请求；失败回滚。教师点一下等一次网络往返会以为没生效。 */
  const togglePolicy = async () => {
    if (!courseId || policyBusy) return;
    const next = !requireScaffold;
    onRequireScaffoldChange?.(next);
    setPolicyBusy(true);
    try { await scaffoldsApi.setPolicy(courseId, { require_scaffold: next }); }
    catch (e) { onRequireScaffoldChange?.(!next); setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setPolicyBusy(false); }
  };
  const [activeL1, setActiveL1] = useState<ScaffoldL1 | 'all'>('all');
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<DraftScaffold | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; globals: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const t = lang === 'zh' ? {
    title: '支架管理', all: '全部', use: '插入笔记',
    mandatory: '必用', recommended: '推荐', used: '已用',
    edit: '编辑', del: '删除', hide: '本课隐藏', show: '恢复显示',
    create: '新建支架', save: '保存', cancel: '取消', done: '完成',
    empty: '没有匹配的支架', search: '搜索支架文本…',
    fText: '支架文本（中文）', fTextEn: '支架文本（英文）', fDesc: '说明（可选）',
    fL1: '一级分类', fGroup: '支架组',
    fTextHint: '学生在笔记里看到的就是这句话。写成话头，别写成标题，例如「我的理论」「我认为还缺乏」。',
    preview: '笔记里的样子', previewSlot: '学生写自己的话',
    required: '请先填写中文支架文本和支架组。',
    globalTag: '全局', courseTag: '本课程', hiddenTag: '已隐藏',
    needCourse: '需要在课程里才能新建支架。',
    selectedN: (n: number) => `已选 ${n} 条`,
    clearSel: '取消选择', selectAll: '全选本页',
    bulkHide: '隐藏', bulkShow: '恢复', bulkRec: '设为推荐', bulkUnrec: '取消推荐', bulkDel: '删除',
    delTitle: '确认删除',
    delCourseOnly: (n: number) => `将删除 ${n} 条本课程支架。已经写进笔记里的支架标记不受影响。`,
    delGlobal: (n: number, g: number) => `将删除 ${n} 条支架，其中 ${g} 条是全局支架 —— 删掉后所有课程都少这几条，且无法恢复。只想在本课程停用请改用「隐藏」。`,
    delConfirm: '确认删除', hideInstead: '改为隐藏',
    variants: '原始写法', mergedFrom: (n: number) => `合并自 ${n} 种写法`,
    showHidden: '显示已隐藏', scaffoldCount: (n: number) => `${n} 条`,
  } : {
    title: 'Scaffold management', all: 'All', use: 'Insert',
    mandatory: 'Required', recommended: 'Recommended', used: 'Used',
    edit: 'Edit', del: 'Delete', hide: 'Hide here', show: 'Unhide',
    create: 'New scaffold', save: 'Save', cancel: 'Cancel', done: 'Done',
    empty: 'No matching scaffold', search: 'Search scaffold text…',
    fText: 'Scaffold text (Chinese)', fTextEn: 'Scaffold text (English)', fDesc: 'Note (optional)',
    fL1: 'Category', fGroup: 'Scaffold group',
    fTextHint: 'This is exactly what students see in the note. Write a sentence opener, not a label.',
    preview: 'How it looks in a note', previewSlot: 'student writes here',
    required: 'Scaffold text and group are required.',
    globalTag: 'Global', courseTag: 'This course', hiddenTag: 'Hidden',
    needCourse: 'Open a course to add scaffolds.',
    selectedN: (n: number) => `${n} selected`,
    clearSel: 'Clear', selectAll: 'Select all shown',
    bulkHide: 'Hide', bulkShow: 'Unhide', bulkRec: 'Recommend', bulkUnrec: 'Un-recommend', bulkDel: 'Delete',
    delTitle: 'Confirm delete',
    delCourseOnly: (n: number) => `Deletes ${n} course scaffold(s). Markers already written into notes are untouched.`,
    delGlobal: (n: number, g: number) => `Deletes ${n} scaffold(s), ${g} of them global — every course loses them, and this cannot be undone. To stop using one here only, hide it instead.`,
    delConfirm: 'Delete', hideInstead: 'Hide instead',
    variants: 'Original wordings', mergedFrom: (n: number) => `merged from ${n} wordings`,
    showHidden: 'Show hidden', scaffoldCount: (n: number) => `${n}`,
  };

  useEffect(() => {
    if (!isOpen) { setDraft(null); setError(''); setQuery(''); setSelected(new Set()); setConfirmDelete(null); }
  }, [isOpen]);

  const reload = useCallback(async () => {
    if (!courseId) return;
    const { scaffolds: loaded } = await scaffoldsApi.list(courseId);
    onUpdateScaffolds(loaded.map(s => ({
      id: s.id, hidden: s.hidden, title: s.title, titleEn: s.titleEn ?? undefined,
      description: s.description ?? '', category: s.category,
      metadata: s.metadata, sortOrder: s.sortOrder, icon: s.icon, color: s.color,
      usageCount: s.usageCount, isMandatory: s.isMandatory, isRecommended: s.isRecommended,
      courseId: s.courseId, steps: s.steps,
    })));
  }, [courseId, onUpdateScaffolds]);

  // 隐藏的支架只有能管理的人看得到（「显示已隐藏」也只给他们）。旧版后端按平台身份把隐藏的
  // 也发给了在这门课里只是普通成员的教师账号，这里再挡一道。
  const visible = useMemo(
    () => scaffolds.filter(s => (canEdit && showHidden) || !s.hidden),
    [scaffolds, showHidden, canEdit],
  );

  const counts = useMemo(() => {
    const map = new Map<ScaffoldL1, number>();
    for (const s of visible) map.set(scaffoldL1(s), (map.get(scaffoldL1(s)) ?? 0) + 1);
    return map;
  }, [visible]);

  const sections = useMemo(() => {
    const filtered = visible.filter(s =>
      (activeL1 === 'all' || scaffoldL1(s) === activeL1) && scaffoldMatches(s, query));
    return groupScaffolds(filtered, lang);
  }, [visible, activeL1, query, lang]);

  const shownItems = useMemo(
    () => sections.flatMap(sec => sec.groups.flatMap(g => g.items)),
    [sections],
  );

  const knownGroups = useMemo(() => {
    const map = new Map<ScaffoldL1, string[]>();
    for (const s of scaffolds) {
      const l1 = scaffoldL1(s);
      const g = scaffoldGroup(s, lang);
      const list = map.get(l1) ?? [];
      if (!list.includes(g)) list.push(g);
      map.set(l1, list);
    }
    return map;
  }, [scaffolds, lang]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  /** 显示/隐藏就地更新，不等一次网络往返；失败再回滚并报错。 */
  const toggleHidden = (scaffold: Scaffold) => {
    if (!courseId) return;
    const next = !scaffold.hidden;
    const apply = (value: boolean) =>
      onUpdateScaffolds(scaffolds.map(s => (s.id === scaffold.id ? { ...s, hidden: value } : s)));
    apply(next);
    setError('');
    void scaffoldsApi.setPrefs(courseId, scaffold.id, { hidden: next })
      .catch(e => {
        apply(!next);
        setError(e instanceof Error ? e.message : 'Failed');
      });
  };

  const toggleSel = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const bulk = (action: 'hide' | 'show' | 'recommend' | 'unrecommend') => {
    if (!courseId || !selected.size) return;
    void run(async () => {
      await scaffoldsApi.bulk(courseId, { action, scaffold_ids: [...selected] });
      setSelected(new Set());
    });
  };

  const askDelete = (ids: string[]) => {
    const globals = ids.filter(id => !scaffolds.find(s => s.id === id)?.courseId).length;
    setConfirmDelete({ ids, globals });
  };

  const doDelete = () => {
    if (!confirmDelete || !courseId) return;
    const { ids, globals } = confirmDelete;
    void run(async () => {
      await scaffoldsApi.bulk(courseId, {
        action: 'delete', scaffold_ids: ids, ...(globals ? { scope: 'global' as const } : {}),
      });
      if (spaceId) trackEvent({ event_type: 'scaffold_deleted', object_type: 'scaffold', object_id: ids[0], space_id: spaceId, metadata_json: { count: ids.length, globals } });
      setSelected(new Set());
      setConfirmDelete(null);
    });
  };

  const startCreate = () => {
    const l1: ScaffoldL1 = activeL1 === 'all' ? 'KB' : activeL1;
    setError('');
    setDraft({ isGlobal: false, title: '', titleEn: '', description: '', l1, group: knownGroups.get(l1)?.[0] ?? '', isMandatory: false, isRecommended: false });
  };

  const startEdit = (scaffold: Scaffold) => {
    setError('');
    setDraft({
      id: scaffold.id,
      isGlobal: !scaffold.courseId,
      title: scaffold.title,
      titleEn: scaffold.titleEn ?? '',
      description: scaffold.description ?? '',
      l1: scaffoldL1(scaffold),
      group: scaffoldGroup(scaffold, lang),
      isMandatory: scaffold.isMandatory,
      isRecommended: scaffold.isRecommended,
    });
  };

  const save = () => {
    if (!draft || !courseId) { setError(t.needCourse); return; }
    if (!draft.title.trim() || !draft.group.trim()) { setError(t.required); return; }
    const existing = draft.id ? scaffolds.find(s => s.id === draft.id) : null;
    const metadata: ScaffoldMetadata = {
      ...(existing?.metadata ?? {}),
      l1: draft.l1,
      l1_zh: L1_LABEL[draft.l1].zh,
      l1_en: L1_LABEL[draft.l1].en,
      l2_zh: draft.group.trim(),
      l2_en: existing?.metadata?.l2_en && lang === 'zh' ? existing.metadata.l2_en : draft.group.trim(),
      gai: gaiFlagForSave(draft.l1, existing?.metadata),
      source: existing?.metadata?.source ?? 'course_custom',
    };
    const payload = {
      title: draft.title.trim(),
      title_en: draft.titleEn.trim() || undefined,
      description: draft.description.trim() || draft.titleEn.trim() || undefined,
      category: `${L1_LABEL[draft.l1].zh}/${draft.group.trim()}`,
      metadata,
      steps: [{ id: 's1', prompt: draft.title.trim(), type: 'textarea' as const, required: true }],
      is_mandatory: draft.isMandatory,
      is_recommended: draft.isRecommended,
    };
    void run(async () => {
      if (draft.id) await scaffoldsApi.update(draft.id, payload);
      else await scaffoldsApi.create(courseId, payload);
      if (spaceId) {
        trackEvent({
          event_type: draft.id ? 'scaffold_updated' : 'scaffold_created',
          object_type: 'scaffold', object_id: draft.id ?? 'new', space_id: spaceId,
        });
      }
      setDraft(null);
    });
  };

  if (!isOpen) return null;

  const frameworkChips = (meta?: ScaffoldMetadata) => {
    const parts = [meta?.hannafin, meta?.saye_brush, meta?.liu_metacognitive].filter(Boolean) as string[];
    return parts.length ? <span className="text-[0.6875rem] text-zinc-400 dark:text-gray-500">{parts.join(' · ')}</span> : null;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm dark:bg-black/60">
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">

        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-6 py-3.5 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <Layers size={18} className="text-[#000080] dark:text-blue-300" />
            <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-gray-100">{t.title}</h2>
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-gray-900 dark:text-gray-400">
              {t.scaffoldCount(scaffolds.length)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && !draft && (
              <button
                type="button" role="switch" aria-checked={requireScaffold} onClick={() => void togglePolicy()} disabled={policyBusy}
                title={lang === 'zh' ? '开启后，学生保存笔记必须至少使用一条支架' : 'When on, students must use at least one scaffold to save a note'}
                className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                  requireScaffold
                    ? 'border-[#000080]/30 bg-[#000080]/[0.07] text-[#000080] dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900'}`}
              >
                <span className={`relative inline-block h-4 w-7 rounded-full transition-colors ${requireScaffold ? 'bg-[#000080] dark:bg-blue-400' : 'bg-zinc-300 dark:bg-gray-600'}`}>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${requireScaffold ? 'left-3.5' : 'left-0.5'}`} />
                </span>
                {lang === 'zh' ? '强制使用支架' : 'Require scaffold'}
              </button>
            )}
            {canEdit && !draft && (
              <button type="button" onClick={startCreate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#000080] px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98]">
                <Plus size={14} />{t.create}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={t.cancel}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-gray-900">
              <X size={18} />
            </button>
          </div>
        </header>

        {draft ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl space-y-5">
              {draft.isGlobal && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {lang === 'zh'
                    ? '这是全局支架，改动会同步到所有课程。只想在本课程停用，请关掉这里用「本课隐藏」。'
                    : 'This is a global scaffold — edits apply to every course. To stop using it here only, hide it instead.'}
                </p>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-zinc-800 dark:text-gray-200">{t.fText}</span>
                <input value={draft.title} autoFocus
                  onChange={e => { setDraft({ ...draft, title: e.target.value }); setError(''); }}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base outline-none transition-colors focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                <span className="mt-1 block text-xs leading-relaxed text-zinc-500 dark:text-gray-400">{t.fTextHint}</span>
              </label>

              {draft.title.trim() && (
                <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
                  <div className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wider text-zinc-400">{t.preview}</div>
                  <div className="note-prose text-[0.9375rem] text-zinc-900 dark:text-gray-100">
                    <strong className="text-[#000080] dark:text-blue-300">{draft.title.trim()}</strong>
                    <span className="text-zinc-400">[</span>
                    <span className="italic">{t.previewSlot}</span>
                    <span className="text-zinc-400">]</span>
                  </div>
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-zinc-800 dark:text-gray-200">{t.fTextEn}</span>
                <input value={draft.titleEn} onChange={e => setDraft({ ...draft, titleEn: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-zinc-800 dark:text-gray-200">{t.fL1}</span>
                  <select value={draft.l1}
                    onChange={e => {
                      const l1 = e.target.value as ScaffoldL1;
                      setDraft({ ...draft, l1, group: knownGroups.get(l1)?.[0] ?? draft.group });
                    }}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                    {L1_ORDER.map(l1 => <option key={l1} value={l1}>{L1_LABEL[l1][lang]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-zinc-800 dark:text-gray-200">{t.fGroup}</span>
                  <input value={draft.group} list="scaffold-group-options"
                    onChange={e => { setDraft({ ...draft, group: e.target.value }); setError(''); }}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                  <datalist id="scaffold-group-options">
                    {(knownGroups.get(draft.l1) ?? []).map(g => <option key={g} value={g} />)}
                  </datalist>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-zinc-800 dark:text-gray-200">{t.fDesc}</span>
                <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
              </label>

              <div className="flex flex-wrap gap-5">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-gray-300">
                  <input type="checkbox" checked={draft.isMandatory} onChange={e => setDraft({ ...draft, isMandatory: e.target.checked })} />
                  {t.mandatory}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-gray-300">
                  <input type="checkbox" checked={draft.isRecommended} onChange={e => setDraft({ ...draft, isRecommended: e.target.checked })} />
                  {t.recommended}
                </label>
              </div>

              {error && (
                <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />{error}
                </p>
              )}

              <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-gray-800">
                <button type="button" onClick={() => setDraft(null)} disabled={busy}
                  className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300">{t.cancel}</button>
                <button type="button" onClick={save} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#000080] px-4 py-2 text-sm font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-60">
                  {busy && <Loader2 size={14} className="animate-spin" />}{t.save}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-6 py-2.5 dark:border-gray-800">
              <div className="relative min-w-[170px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search}
                  className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none transition-colors focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
              </div>
              <button type="button" onClick={() => setActiveL1('all')}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  activeL1 === 'all'
                    ? 'border-zinc-800 bg-zinc-800 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-gray-700 dark:text-gray-400'}`}>
                {t.all} {visible.length}
              </button>
              {L1_ORDER.filter(l1 => counts.has(l1)).map(l1 => (
                <button key={l1} type="button" onClick={() => setActiveL1(l1)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    activeL1 === l1 ? L1_TONE[l1].chipActive : L1_TONE[l1].chip}`}>
                  {L1_LABEL[l1][lang]} {counts.get(l1)}
                </button>
              ))}
              {canEdit && (
                <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500 dark:text-gray-400">
                  <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
                  {t.showHidden}
                </label>
              )}
            </div>

            {canEdit && selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-[#000080]/20 bg-[#000080]/5 px-6 py-2 dark:border-blue-900 dark:bg-blue-950/30">
                <span className="text-xs font-bold text-[#000080] dark:text-blue-300">{t.selectedN(selected.size)}</span>
                <button type="button" onClick={() => bulk('hide')} disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                  <EyeOff size={12} />{t.bulkHide}
                </button>
                <button type="button" onClick={() => bulk('show')} disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                  <Eye size={12} />{t.bulkShow}
                </button>
                <button type="button" onClick={() => bulk('recommend')} disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                  <Star size={12} />{t.bulkRec}
                </button>
                <button type="button" onClick={() => askDelete([...selected])} disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-gray-900">
                  <Trash2 size={12} />{t.bulkDel}
                </button>
                <button type="button" onClick={() => setSelected(new Set())}
                  className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-gray-400">{t.clearSel}</button>
                <button type="button" onClick={() => setSelected(new Set(shownItems.map(s => s.id)))}
                  className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-gray-400">{t.selectAll}</button>
                {busy && <Loader2 size={13} className="animate-spin text-[#000080]" />}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {error && (
                <p className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />{error}
                </p>
              )}
              {shownItems.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-400">
                  <Layers size={40} className="opacity-20" />
                  <p className="text-sm">{t.empty}</p>
                </div>
              ) : sections.map(section => (
                <section key={section.l1} className="mb-6">
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${L1_TONE[section.l1].dot}`} />
                    <h3 className="text-sm font-bold tracking-tight text-zinc-800 dark:text-gray-200">{L1_LABEL[section.l1][lang]}</h3>
                  </div>
                  <div className="space-y-4">
                    {section.groups.map(group => (
                      <div key={group.name}>
                        <div className="mb-1.5 text-xs font-semibold text-zinc-400 dark:text-gray-500">
                          {group.name} · {group.items.length}
                        </div>
                        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-gray-800 dark:border-gray-800">
                          {group.items.map(scaffold => {
                            const isGlobal = !scaffold.courseId;
                            const meta = scaffold.metadata;
                            return (
                              <li key={scaffold.id}
                                className={`group flex items-center gap-3 px-3 py-2.5 transition-colors ${
                                  scaffold.hidden ? 'bg-zinc-50/70 dark:bg-gray-900/60' : 'bg-white dark:bg-gray-950'
                                } hover:bg-zinc-50 dark:hover:bg-gray-900`}>
                                {canEdit && (
                                  <input type="checkbox" checked={selected.has(scaffold.id)}
                                    onChange={() => toggleSel(scaffold.id)}
                                    className="shrink-0 cursor-pointer" aria-label={scaffold.title} />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className={`note-prose truncate text-[0.9375rem] ${scaffold.hidden ? 'text-zinc-400 line-through dark:text-gray-600' : 'text-zinc-900 dark:text-gray-100'}`}
                                    title={scaffoldLabel(scaffold, lang)}>
                                    {scaffoldLabel(scaffold, lang)}
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.6875rem] font-medium text-zinc-500 dark:bg-gray-900 dark:text-gray-400">
                                      {isGlobal ? t.globalTag : t.courseTag}
                                    </span>
                                    {scaffold.hidden && (
                                      <span className="inline-flex items-center gap-0.5 rounded bg-zinc-200 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-zinc-600 dark:bg-gray-800 dark:text-gray-400">
                                        <EyeOff size={10} />{t.hiddenTag}
                                      </span>
                                    )}
                                    {scaffold.isMandatory && (
                                      <span className="inline-flex items-center gap-0.5 text-[0.6875rem] font-semibold text-red-600"><AlertCircle size={11} />{t.mandatory}</span>
                                    )}
                                    {scaffold.isRecommended && (
                                      <span className="inline-flex items-center gap-0.5 text-[0.6875rem] font-semibold text-[#000080] dark:text-blue-300"><Check size={11} />{t.recommended}</span>
                                    )}
                                    {frameworkChips(meta)}
                                    {typeof meta?.merged_from === 'number' && meta.merged_from > 1 && (
                                      <span className="text-[0.6875rem] text-zinc-400" title={(meta.variants ?? []).join('  |  ')}>
                                        {t.mergedFrom(meta.merged_from)}
                                      </span>
                                    )}
                                    {scaffold.usageCount > 0 && (
                                      <span className="text-[0.6875rem] text-zinc-400">{t.used} {scaffold.usageCount}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5">
                                  {canEdit && courseId && (
                                    <button type="button" title={scaffold.hidden ? t.show : t.hide} disabled={busy}
                                      onClick={() => toggleHidden(scaffold)}
                                      className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-gray-800">
                                      {scaffold.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                                    </button>
                                  )}
                                  {canEdit && (
                                    <>
                                      <button type="button" onClick={() => startEdit(scaffold)} title={t.edit}
                                        className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-[#000080] dark:hover:bg-gray-800">
                                        <Pencil size={14} />
                                      </button>
                                      <button type="button" onClick={() => askDelete([scaffold.id])} title={t.del}
                                        className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600">
                                        <Trash2 size={14} />
                                      </button>
                                    </>
                                  )}
                                  <button type="button" onClick={() => { onUseScaffold(scaffold); onClose(); }}
                                    className="ml-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-700 opacity-0 transition-all hover:border-[#000080] hover:text-[#000080] focus:opacity-100 group-hover:opacity-100 dark:border-gray-700 dark:text-gray-300">
                                    {t.use}
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        {confirmDelete && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-950">
              <div className="mb-2 flex items-center gap-2 text-base font-bold text-zinc-900 dark:text-gray-100">
                <AlertTriangle size={17} className={confirmDelete.globals ? 'text-red-600' : 'text-amber-500'} />
                {t.delTitle}
              </div>
              <p className="mb-4 text-sm leading-relaxed text-zinc-600 dark:text-gray-400">
                {confirmDelete.globals
                  ? t.delGlobal(confirmDelete.ids.length, confirmDelete.globals)
                  : t.delCourseOnly(confirmDelete.ids.length)}
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmDelete(null)}
                  className="rounded-lg border border-zinc-200 px-3.5 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-gray-700 dark:text-gray-300">{t.cancel}</button>
                {confirmDelete.globals > 0 && courseId && (
                  <button type="button" disabled={busy}
                    onClick={() => void run(async () => {
                      await scaffoldsApi.bulk(courseId, { action: 'hide', scaffold_ids: confirmDelete.ids });
                      setSelected(new Set()); setConfirmDelete(null);
                    })}
                    className="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-gray-700 dark:text-gray-300">
                    {t.hideInstead}
                  </button>
                )}
                <button type="button" onClick={doDelete} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-red-700 active:scale-[0.98] disabled:opacity-60">
                  {busy && <Loader2 size={14} className="animate-spin" />}{t.delConfirm}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScaffoldModal;
