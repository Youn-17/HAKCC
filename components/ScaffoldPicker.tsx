import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Sparkles, X } from 'lucide-react';
import type { Language, Scaffold } from '../types';
import { isGenAiScaffold, scaffoldGroup, scaffoldLabel, scaffoldMatches } from './scaffoldLibrary';

/**
 * 支架选择器：两级，照 Knowledge Forum 的做法。
 *
 * 先在下拉里选一个支架组（「CT4 算法设计」「整合与提升观点」「思考后询问 GAI」……共二十组），
 * 下面只列这一组的支架——最多十七条，一屏放得下，不用滑。
 * 之前多套了一层「四个一级分类」再往下折叠分组，147 条散在几层折叠段里，
 * 学生找一句话头要点开、滑动、再点开。分类学对研究有用（元数据里都留着），
 * 对正在写笔记的学生只是噪音，所以界面上去掉了那一层。
 *
 * 搜索时越过分组，把全部命中的条目按组名平铺 —— 否则命中的那条藏在哪个组里
 * 学生不知道。上次选的组记在 localStorage：同一节课多半在同一个组里反复选。
 *
 * onlyGenAi 用在「把 AI 内容写进笔记」那一步，只列转述 AI 产出的支架。
 */

interface Props {
  scaffolds: Scaffold[];
  lang: Language;
  onPick: (scaffold: Scaffold) => void;
  /** 已选中的支架 id；选择模式下显示勾选态 */
  selectedId?: string | null;
  /** 只列出与 AI 产出有关的支架 */
  onlyGenAi?: boolean;
  /** 侧栏用的紧凑排版 */
  compact?: boolean;
  emptyHint?: string;
  /** AI 为当前这条笔记建议的支架（随反馈生成）。只针对这条笔记，不进支架库。 */
  aiSuggestions?: { id: string; text: string }[];
  onPickAi?: (suggestion: { id: string; text: string }) => void;
}

const LAST_GROUP_KEY = 'hakcc-scaffold-group';

const ScaffoldPicker: React.FC<Props> = ({
  scaffolds, lang, onPick, selectedId, onlyGenAi = false, compact = false, emptyHint,
  aiSuggestions = [], onPickAi,
}) => {
  const [query, setQuery] = useState('');

  const t = lang === 'zh'
    ? { search: '搜索支架…', group: '支架组', empty: emptyHint ?? '没有匹配的支架', clear: '清空搜索',
        add: '插入这条支架', results: (n: number) => `找到 ${n} 条`,
        hint: '先选一个支架组，再点一条。光标停在哪一段，那一段就被框进支架；括号里回车是换行，要在支架外写，把光标点到 ] 后面。' }
    : { search: 'Search scaffolds…', group: 'Scaffold group', empty: emptyHint ?? 'No matching scaffold', clear: 'Clear search',
        add: 'Insert this scaffold', results: (n: number) => `${n} found`,
        hint: 'Choose a group, then pick one line. The paragraph your caret is in gets wrapped; Enter adds a line inside, and to write outside click just after the ].' };

  const pool = useMemo(
    () => (onlyGenAi ? scaffolds.filter(isGenAiScaffold) : scaffolds),
    [scaffolds, onlyGenAi],
  );

  /** 组的顺序跟分类表走（sortOrder），不按字母 —— CT1…CT6 要按数字排。 */
  const groups = useMemo(() => {
    const ordered = [...pool].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const map = new Map<string, Scaffold[]>();
    for (const s of ordered) {
      const g = scaffoldGroup(s, lang);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  }, [pool, lang]);

  const [activeGroup, setActiveGroup] = useState<string>(() => {
    try { return localStorage.getItem(LAST_GROUP_KEY) ?? ''; } catch { return ''; }
  });

  // 记住的组在这批支架里不存在（比如切到只看 GenAI）就退回第一组
  useEffect(() => {
    if (groups.length === 0) return;
    if (!groups.some(g => g.name === activeGroup)) setActiveGroup(groups[0].name);
  }, [groups, activeGroup]);

  const pickGroup = (name: string) => {
    setActiveGroup(name);
    try { localStorage.setItem(LAST_GROUP_KEY, name); } catch { /* 隐私模式忽略 */ }
  };

  const searching = query.trim().length > 0;
  const visible = useMemo(() => {
    if (searching) {
      return groups
        .map(g => ({ name: g.name, items: g.items.filter(s => scaffoldMatches(s, query)) }))
        .filter(g => g.items.length > 0);
    }
    const g = groups.find(x => x.name === activeGroup);
    return g ? [g] : [];
  }, [groups, activeGroup, query, searching]);
  const total = visible.reduce((n, g) => n + g.items.length, 0);

  const renderItem = (scaffold: Scaffold) => {
    const active = selectedId === scaffold.id;
    const label = scaffoldLabel(scaffold, lang);
    const alt = lang === 'zh' ? scaffold.titleEn : scaffold.title;
    return (
      <button
        key={scaffold.id} type="button" onClick={() => onPick(scaffold)}
        title={alt && alt !== label ? alt : t.add}
        className={`group flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[0.8125rem] leading-snug transition-colors ${
          active
            ? 'bg-[#000080]/[0.07] font-semibold text-[#000080] dark:bg-blue-950/40 dark:text-blue-200'
            : 'text-zinc-700 hover:bg-zinc-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
      >
        <span className="min-w-0 flex-1">{label}</span>
        <span aria-hidden
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#000080] text-white transition-opacity ${
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <Plus size={12} />
        </span>
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      {aiSuggestions.length > 0 && onPickAi && (
        <div className="rounded-lg border border-[#000080]/15 bg-[#000080]/[0.04] p-2 dark:border-blue-400/25 dark:bg-blue-950/30">
          <div className="mb-1.5 flex items-center gap-1 text-[0.6875rem] font-semibold text-[#000080] dark:text-blue-300">
            <Sparkles size={12} />{lang === 'zh' ? 'AI 为这条笔记建议' : 'AI suggests for this note'}
          </div>
          <div className="space-y-0.5">
            {aiSuggestions.map(sg => (
              <button key={sg.id} type="button" onClick={() => onPickAi(sg)}
                className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[0.8125rem] leading-snug text-zinc-800 transition-colors hover:bg-white dark:text-gray-100 dark:hover:bg-gray-800">
                <span className="min-w-0 flex-1">{sg.text}</span>
                <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#000080] text-white opacity-0 transition-opacity group-hover:opacity-100"><Plus size={12} /></span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[0.625rem] leading-relaxed text-zinc-500 dark:text-gray-400">
            {lang === 'zh' ? '这是 AI 看了你这条笔记后给的话头，只出现在这里。用不用由你。' : 'A prompt the AI wrote for this note. Use it or not.'}
          </p>
        </div>
      )}
      {groups.length > 1 && (
        <label className="block">
          <span className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-400 dark:text-gray-500">{t.group}</span>
          <select
            value={searching ? '' : activeGroup}
            disabled={searching}
            onChange={e => pickGroup(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[0.8125rem] font-semibold text-zinc-800 outline-none transition-colors focus:border-[#000080] disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:focus:border-blue-400"
          >
            {searching && <option value="">{t.results(total)}</option>}
            {groups.map(g => (
              <option key={g.name} value={g.name}>{g.name} · {g.items.length}</option>
            ))}
          </select>
        </label>
      )}

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t.search}
          className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-7 text-[0.8125rem] text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:focus:border-blue-400"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label={t.clear}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-gray-200">
            <X size={13} />
          </button>
        )}
      </div>

      <div className={`min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5 ${compact ? '' : 'max-h-[46vh]'}`}>
        {total === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-xs text-zinc-500 dark:border-gray-700 dark:text-gray-400">{t.empty}</p>
        ) : visible.map(g => (
          <div key={g.name}>
            {/* 搜索时跨组平铺，组名当小标题；单组模式下组名已在下拉里，不重复 */}
            {searching && (
              <div className="mb-0.5 mt-2 px-2 text-[0.6875rem] font-semibold text-zinc-400 first:mt-0 dark:text-gray-500">{g.name}</div>
            )}
            <div className="space-y-0.5">{g.items.map(renderItem)}</div>
          </div>
        ))}
      </div>

      {!compact && (
        <p className="border-t border-zinc-100 pt-2 text-[0.6875rem] leading-relaxed text-zinc-400 dark:border-gray-800 dark:text-gray-500">{t.hint}</p>
      )}
    </div>
  );
};

export default ScaffoldPicker;
