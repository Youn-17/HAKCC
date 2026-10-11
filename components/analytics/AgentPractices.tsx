/**
 * 讨论分析 → 指导策略（2026-10-11 第五步，只给教职）。
 * 指导策略：系统从学生和智能体的对话里看出「这样回答学生更常接住」，生成候选；老师采用后才放进提示词，
 *   采用后试用，用满 20 次不比以前好就自动撤回。老师也可以编写指导策略。
 * 网页模板：平台自带的几种，加上从做得好的网页（放进过笔记的）存下来的本课模板。
 */
import { useCallback, useEffect, useState } from 'react';
import RemixIcon from '../RemixIcon';
import {
  agentPracticesApi,
  apiUrl,
  type AgentPracticesView,
  type PracticeCardView,
  type PracticeTaskKind,
} from '../../services/apiClient';

type Lang = 'zh' | 'en';

const KIND: Record<PracticeTaskKind, { zh: string; en: string }> = {
  ask: { zh: '提问讨论', en: 'Questions' },
  make: { zh: '制作内容', en: 'Creating content' },
  plan: { zh: '规划写作', en: 'Planning writing' },
  ghostwrite: { zh: '请求代写', en: 'Requests for AI writing' },
  polish: { zh: '修改自写内容', en: 'Revising own text' },
};
const KINDS = Object.keys(KIND) as PracticeTaskKind[];

const pct = (r: number) => `${Math.round(r * 100)}%`;
const btn = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';
const primary = `${btn} bg-[#000080] text-white hover:bg-[#000080]/90 dark:bg-[#93AAFD] dark:text-gray-950`;
const quiet = `${btn} border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:text-zinc-900 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-200`;

export default function AgentPractices({ spaceId, lang }: { spaceId: string; lang: Lang }) {
  const zh = lang === 'zh';
  const [view, setView] = useState<AgentPracticesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [draftKind, setDraftKind] = useState<PracticeTaskKind>('make');
  const [draft, setDraft] = useState('');

  const load = useCallback(() => {
    agentPracticesApi.get(spaceId)
      .then(v => { setView(v); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [spaceId]);
  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const generate = () => act('generate', async () => {
    const r = await agentPracticesApi.generate(spaceId);
    setNotice(r.created > 0
      ? (zh ? `已生成 ${r.created} 条候选策略，请在下方查看。` : `${r.created} candidates created. Review them below.`)
      : r.reason === 'not_enough'
        ? (zh ? `数据不足：最近有 ${r.turns} 条回答，每类任务至少需要 ${view?.stats.minKindTurns ?? 20} 条。也可自行编写指导策略。` : `Not enough data yet (${r.turns} answers). You can write a strategy yourself.`)
        : (zh ? '这段时间没有符合条件的候选策略。' : 'No strategy met the candidate criteria in this period.'));
  });

  const saveDraft = () => act('write', async () => {
    await agentPracticesApi.write(spaceId, draftKind, draft.trim());
    setDraft('');
    setWriting(false);
  }, zh ? '已保存并启用，将用于这类任务的后续回答。' : 'Saved and active from the next answer.');

  if (error) {
    return <div className="da-empty" role="alert">{zh ? '读取失败：' : 'Could not load: '}{error}<button type="button" className="da-more" onClick={load}>{zh ? '重试' : 'Retry'}</button></div>;
  }
  if (!view) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-gray-800" />)}
      </div>
    );
  }

  const candidates = view.cards.filter(c => c.status === 'candidate');
  const active = view.cards.filter(c => c.status === 'active');
  const past = view.cards.filter(c => c.status === 'rejected' || c.status === 'retired');
  const kindsSeen = KINDS.filter(k => view.stats.byKind[k]?.total > 0);

  const cardRow = (c: PracticeCardView, actions: React.ReactNode, extra?: React.ReactNode) => (
    <li key={c.id} className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[0.6875rem]">
            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600 dark:bg-gray-800 dark:text-zinc-300">{KIND[c.taskKind][zh ? 'zh' : 'en']}</span>
            <span className="text-zinc-400">{c.origin === 'teacher' ? (zh ? '教师编写' : 'Written by a teacher') : (zh ? '根据对话记录生成' : 'Based on conversation records')}</span>
          </div>
          <p className="text-sm font-medium leading-6 text-zinc-900 dark:text-zinc-50">{c.practice}</p>
          {c.rationale && <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{c.rationale}</p>}
          {extra}
        </div>
        <div className="flex shrink-0 gap-1.5">{actions}</div>
      </div>
    </li>
  );

  const trialText = (c: PracticeCardView) => {
    const t = c.trial;
    if (!t) return null;
    const base = c.baselineRate === null ? (zh ? '采用前数据不足，不会自动撤回' : 'no baseline, will not auto-withdraw') : (zh ? `采用前 ${pct(c.baselineRate)}` : `before: ${pct(c.baselineRate)}`);
    return (
      <p className="mt-1.5 text-xs leading-5 text-[#000080] dark:text-[#93AAFD]">
        {t.verdict === 'trial'
          ? (zh ? `试用中：已使用 ${t.uses} 次，满 20 次后比较数据` : `On trial: ${t.uses} uses; compared after 20`)
          : (zh ? `已使用 ${t.uses} 次，后续互动比例 ${pct(t.rate)}` : `Used ${t.uses} times; follow-up activity ${pct(t.rate)}`)}
        {' · '}{base}
      </p>
    );
  };

  return (
    <div className="space-y-10 text-left">
      {notice && <p className="rounded-xl bg-[#000080]/[0.06] px-3 py-2 text-xs leading-5 text-[#000080] dark:bg-blue-950/40 dark:text-blue-200" role="status">{notice}</p>}

      <section aria-labelledby="practice-cards" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 id="practice-cards" className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{zh ? 'AI 指导策略' : 'AI guidance strategies'}</h3>
            <p className="mt-1 max-w-[65ch] text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {zh
                ? `最近 ${view.stats.windowDays} 天，智能体向学生回复 ${view.stats.turns} 条回答。后续互动包括导入回答或网页、30 分钟内继续提问，以及回答选项卡。指导策略需教师采用后才使用；有基线数据时，使用满 20 次后比较互动比例，未高于基线则自动撤回。此比例不代表学习效果。`
                : `${view.stats.turns} agent answers to students in the last ${view.stats.windowDays} days. Follow-up activity includes imports, questions within 30 minutes, and option-card responses. Strategies are used after teacher adoption. With a baseline, they are withdrawn after 20 uses if the follow-up rate does not exceed it. This rate does not measure learning outcomes.`}
            </p>
            {kindsSeen.length > 0 && (
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {kindsSeen.map(k => `${KIND[k][zh ? 'zh' : 'en']} ${pct(view.stats.byKind[k].rate)}（${view.stats.byKind[k].total}）`).join(zh ? ' · ' : ' · ')}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className={quiet} onClick={() => setWriting(w => !w)} aria-expanded={writing}><RemixIcon name="edit-line" size={14} />{zh ? '编写指导策略' : 'Write a strategy'}</button>
            <button type="button" className={primary} onClick={() => void generate()} disabled={busy === 'generate'}>
              <RemixIcon name={busy === 'generate' ? 'loader-4-line' : 'sparkling-line'} size={14} className={busy === 'generate' ? 'animate-spin' : ''} />
              {zh ? '生成候选' : 'Find candidates'}
            </button>
          </div>
        </div>
        {view.stats.lastGeneratedAt && <p className="text-[0.6875rem] text-zinc-400">{zh ? '上次生成：' : 'Last generated: '}{new Date(view.stats.lastGeneratedAt).toLocaleDateString(zh ? 'zh-CN' : 'en-US')}</p>}

        {writing && (
          <form className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-gray-800 dark:bg-gray-900/60" onSubmit={e => { e.preventDefault(); void saveDraft(); }}>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {zh ? '用在哪类任务' : 'Task type'}
              <select value={draftKind} onChange={e => setDraftKind(e.target.value as PracticeTaskKind)} className="mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-950">
                {KINDS.map(k => <option key={k} value={k}>{KIND[k][zh ? 'zh' : 'en']}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {zh ? '智能体回答建议' : 'Guidance for agent responses'}
              <textarea value={draft} onChange={e => setDraft(e.target.value)} maxLength={120} rows={2} placeholder={zh ? '例如：做自测题时，最后一题留成开放题，让学生用自己的话写' : 'e.g. End self-quizzes with an open question students answer in their own words'} className="mt-1 block w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 dark:border-gray-700 dark:bg-gray-950" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={quiet} onClick={() => setWriting(false)}>{zh ? '取消' : 'Cancel'}</button>
              <button type="submit" className={primary} disabled={draft.trim().length < 4 || busy === 'write'}>{zh ? '保存并启用' : 'Save and use'}</button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{zh ? '待采用的策略' : 'Candidates'}{candidates.length > 0 && <span className="ml-1 font-normal tabular-nums text-zinc-400">{candidates.length}</span>}</h4>
          {candidates.length === 0
            ? <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-4 text-xs leading-5 text-zinc-400 dark:border-gray-800">{zh ? '暂无候选策略，可从最近的对话记录中生成。' : 'No candidates. Use "Find candidates".'}</p>
            : <ul className="space-y-2">{candidates.map(c => cardRow(c, <>
              <button type="button" className={primary} disabled={busy === c.id} onClick={() => void act(c.id, () => agentPracticesApi.decide(spaceId, c.id, 'active'), zh ? '已采用，将用于这类任务的后续回答。' : 'Adopted.')}>{zh ? '采用' : 'Adopt'}</button>
              <button type="button" className={quiet} disabled={busy === c.id} onClick={() => void act(c.id, () => agentPracticesApi.decide(spaceId, c.id, 'rejected'))}>{zh ? '不用' : 'Reject'}</button>
            </>))}</ul>}
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{zh ? '在用' : 'In use'}{active.length > 0 && <span className="ml-1 font-normal tabular-nums text-zinc-400">{active.length}</span>}</h4>
          {active.length === 0
            ? <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-4 text-xs leading-5 text-zinc-400 dark:border-gray-800">{zh ? '暂无已启用的策略。' : 'No strategies in use.'}</p>
            : <ul className="space-y-2">{active.map(c => cardRow(c,
              <button type="button" className={quiet} disabled={busy === c.id} onClick={() => void act(c.id, () => agentPracticesApi.decide(spaceId, c.id, 'retired'))}>{zh ? '撤回' : 'Withdraw'}</button>,
              trialText(c)))}</ul>}
        </div>

        {past.length > 0 && (
          <details className="group rounded-xl border border-zinc-200/70 px-4 py-3 dark:border-gray-800">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-600 dark:text-zinc-300">{zh ? `已撤回或未采用（${past.length}）` : `Withdrawn and rejected (${past.length})`}</summary>
            <ul className="mt-3 space-y-2">{past.map(c => cardRow(c,
              <button type="button" className={quiet} disabled={busy === c.id} onClick={() => void act(c.id, () => agentPracticesApi.decide(spaceId, c.id, 'active'))}>{zh ? '重新启用' : 'Use again'}</button>,
              c.retiredReason ? <p className="mt-1 text-xs text-zinc-500">{zh ? '撤回原因：' : 'Reason: '}{c.retiredReason}</p> : null))}</ul>
          </details>
        )}
      </section>

      <section aria-labelledby="page-templates" className="space-y-4">
        <div>
          <h3 id="page-templates" className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{zh ? '网页模板' : 'Page templates'}</h3>
          <p className="mt-1 max-w-[65ch] text-xs leading-5 text-zinc-500 dark:text-zinc-400">{zh ? '制作网页时可使用平台或本课模板。教师可从已导入笔记的网页提取版式和交互说明，保存为本课模板。' : 'The agent can use built-in or course templates. Teachers can extract layout and interaction guidance from pages imported into Notes and save it as a course template.'}</p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[...view.templates.builtin.map(t => ({ ...t, builtin: true })), ...view.templates.course.map(t => ({ ...t, builtin: false }))].map(t => (
            <li key={t.slug} className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t.name}<span className="ml-1.5 text-[0.6875rem] font-normal text-zinc-400">{t.builtin ? (zh ? '平台自带' : 'Built-in') : (zh ? '本课' : 'Course')}</span></p>
                  <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t.whenToUse}</p>
                  <p className="mt-1 text-[0.6875rem] text-zinc-400">{zh ? `已生成 ${t.usage.made} 个网页，${t.usage.adopted} 个已导入笔记` : `${t.usage.made} made, ${t.usage.adopted} put into notes`}</p>
                </div>
                {!t.builtin && t.id && (
                  <button type="button" className={quiet} disabled={busy === t.id} onClick={() => void act(t.id!, () => agentPracticesApi.setTemplateStatus(spaceId, t.id!, 'retired'))}>{zh ? '停用' : 'Retire'}</button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{zh ? '已导入笔记的网页' : 'Pages imported into Notes'}</h4>
          {view.goodPages.length === 0
            ? <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-4 text-xs leading-5 text-zinc-400 dark:border-gray-800">{zh ? '还没有学生把智能体做的网页放进笔记。' : 'No agent-built pages have been put into notes yet.'}</p>
            : <ul className="space-y-2">{view.goodPages.map(p => (
              <li key={p.artifactId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{p.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{p.brief}</p>
                  <p className="mt-0.5 text-[0.6875rem] text-zinc-400">{zh ? `放进了 ${p.notes} 条笔记` : `In ${p.notes} notes`}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <a className={quiet} href={apiUrl(p.viewPath)} target="_blank" rel="noopener noreferrer"><RemixIcon name="external-link-line" size={14} />{zh ? '打开网页' : 'Open'}</a>
                  <button type="button" className={primary} disabled={p.savedAsTemplate || busy === p.artifactId} onClick={() => void act(p.artifactId, () => agentPracticesApi.saveTemplate(spaceId, p.artifactId), zh ? '已保存为本课模板，可用于后续网页制作。' : 'Saved as a course template.')}>
                    {p.savedAsTemplate ? (zh ? '已保存模板' : 'Saved') : busy === p.artifactId ? (zh ? '正在保存模板…' : 'Saving…') : (zh ? '保存为模板' : 'Save as template')}
                  </button>
                </div>
              </li>
            ))}</ul>}
        </div>
      </section>
    </div>
  );
}
