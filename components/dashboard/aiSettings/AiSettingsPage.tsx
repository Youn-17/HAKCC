import React, { useEffect, useState } from 'react';
import type { Course, Language } from '../../../types';
import AiProvidersPanel from './AiProvidersPanel';
import AiFeatureModelsPanel from '../AiFeatureModelsPanel';
import TriggerSettingsPanel from './TriggerSettingsPanel';

/**
 * 教师端「AI 设置」页（2026-10-11 用户：太复杂太长；切换课程后下面的都要跟着变；别增加老师的负担）。
 *
 * 原来三块各有一个课程下拉框，切了上面那块，下面两块还停在原来的课程上。现在课程只在页面顶上选一次，
 * 三块都跟着它（换课程时整块重新加载，不会留着上一门课的数据）；三块分成三个页签，不再一长页往下拉。
 * 选过的课程和页签记在浏览器里，下次打开还是它。
 */

type Tab = 'providers' | 'features' | 'feedback';
const TABS: Tab[] = ['providers', 'features', 'feedback'];
const COURSE_KEY = 'hakcc-ai-settings-course';
const TAB_KEY = 'hakcc-ai-settings-tab';

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* 隐私模式记不住，照样能用 */ } };

interface Props {
  lang: Language;
  courses: Course[];
}

const AiSettingsPage: React.FC<Props> = ({ lang, courses }) => {
  const zh = lang === 'zh';
  const pick = (wanted: string | null) => (wanted && courses.some(c => c.id === wanted) ? wanted : courses[0]?.id ?? '');
  const [courseId, setCourseId] = useState(() => pick(read(COURSE_KEY)));
  const [tab, setTab] = useState<Tab>(() => {
    const saved = read(TAB_KEY) as Tab | null;
    return saved && TABS.includes(saved) ? saved : 'providers';
  });

  // 课程列表晚到或变了：选中的课不在里面就换成第一门
  useEffect(() => {
    if (!courses.some(c => c.id === courseId)) setCourseId(pick(read(COURSE_KEY)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses]);

  const chooseCourse = (id: string) => { setCourseId(id); write(COURSE_KEY, id); };
  const chooseTab = (next: Tab) => { setTab(next); write(TAB_KEY, next); };

  const tabLabel: Record<Tab, string> = zh
    ? { providers: '服务商与密钥', features: '各功能用哪个 AI', feedback: '自动反馈' }
    : { providers: 'Providers & keys', features: 'Models per feature', feedback: 'Auto-feedback' };

  if (courses.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-gray-800 dark:bg-gray-950 dark:text-zinc-300">
        {zh ? '先创建一门课程，再来配置 AI。' : 'Create a course first, then configure AI.'}
      </section>
    );
  }

  const current = courses.find(c => c.id === courseId);
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">{zh ? 'AI 设置' : 'AI settings'}</h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{zh ? '下面的设置只对选中的这门课生效。' : 'Everything below applies to the selected course only.'}</p>
        </div>
        {courses.length > 1 ? (
          <label className="flex min-w-0 items-center gap-2 sm:w-80">
            <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">{zh ? '课程' : 'Course'}</span>
            <select
              value={courseId}
              onChange={e => chooseCourse(e.target.value)}
              aria-label={zh ? '课程' : 'Course'}
              className="h-10 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none transition-colors hover:border-zinc-300 focus-visible:border-[#000080] focus-visible:ring-2 focus-visible:ring-[#000080]/20 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-100"
            >
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        ) : (
          <p className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">{current?.title}</p>
        )}
      </header>

      <div role="tablist" aria-label={zh ? 'AI 设置' : 'AI settings'} className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-gray-800">
        {TABS.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`ai-settings-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="ai-settings-panel"
            onClick={() => chooseTab(id)}
            className={`-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-sm transition-colors duration-200 ${tab === id
              ? 'border-[#000080] font-semibold text-[#000080] dark:border-[#93AAFD] dark:text-[#93AAFD]'
              : 'border-transparent font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
          >
            {tabLabel[id]}
          </button>
        ))}
      </div>

      <div id="ai-settings-panel" role="tabpanel" aria-labelledby={`ai-settings-tab-${tab}`} key={`${courseId}:${tab}`} className="animate-in fade-in duration-200">
        {tab === 'providers' && <AiProvidersPanel lang={lang} courseId={courseId} />}
        {tab === 'features' && <AiFeatureModelsPanel lang={lang} courseId={courseId} />}
        {tab === 'feedback' && <TriggerSettingsPanel lang={lang} courseId={courseId} />}
      </div>
    </section>
  );
};

export default AiSettingsPage;
