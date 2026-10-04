import React, { useCallback, useEffect, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import PyCodeEditor from '../PyCodeEditor';
import { usePythonRunner } from '../../hooks/usePythonRunner';
import { ctTool, type CtProblem, type CtSolutionSteps } from '../../services/apiClient';

interface Props {
  courseId: string;
  problem: CtProblem;
  onClose: () => void;
}

type StepKey = 'decomposition' | 'pattern' | 'abstraction' | 'algorithm' | 'code' | 'reflection';

const STEPS: Array<{ key: StepKey; icon: string; label: string; question: string }> = [
  { key: 'decomposition', icon: 'git-branch-line', label: '问题分解', question: '这个大问题可以拆成哪些更小的子问题？' },
  { key: 'pattern', icon: 'bubble-chart-line', label: '模式识别', question: '试几个小例子，你发现了什么规律？' },
  { key: 'abstraction', icon: 'shape-line', label: '抽象概括', question: '忽略细节后，这个问题的本质是什么？' },
  { key: 'algorithm', icon: 'list-ordered', label: '算法设计', question: '按什么步骤执行就能解决它？' },
  { key: 'code', icon: 'code-s-slash-line', label: '编码验证', question: '把算法变成代码，运行验证你的想法' },
  { key: 'reflection', icon: 'seedling-line', label: '反思发布', question: '这个方法还能用在哪？分享给社区' },
];

const CTWorkbench: React.FC<Props> = ({ courseId, problem, onClose }) => {
  const [active, setActive] = useState<StepKey>('decomposition');
  const [steps, setSteps] = useState<CtSolutionSteps>({});
  const [stepStatus, setStepStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [publishedNote, setPublishedNote] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{ step: StepKey; feedback: string; suggestions: string[] } | null>(null);

  const { run, engineReady } = usePythonRunner();
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState('');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ steps, stepStatus });
  latestRef.current = { steps, stepStatus };

  // ── Load workspace ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    ctTool.loadSolution(courseId, problem.id)
      .then(({ solution }) => {
        if (cancelled) return;
        const loaded = (solution.steps ?? {}) as CtSolutionSteps;
        if (!loaded.code?.source && problem.starterCode) {
          loaded.code = { source: problem.starterCode };
        }
        setSteps(loaded);
        setStepStatus(solution.step_status ?? {});
        setPublishedNote(solution.published_note_id);
      })
      .catch(() => { /* fresh workspace */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [courseId, problem.id, problem.starterCode]);

  // ── Autosave (debounced) ───────────────────────────────────
  const scheduleSave = useCallback(() => {
    setSaveState('dirty');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const { steps: s, stepStatus: st } = latestRef.current;
        const allDone = ['decomposition', 'pattern', 'abstraction', 'algorithm', 'code'].every(k => st[k]);
        await ctTool.saveSolution(courseId, problem.id, { steps: s, step_status: st, status: allDone ? 'completed' : 'active' });
        setSaveState('saved');
      } catch {
        setSaveState('dirty');
      }
    }, 1200);
  }, [courseId, problem.id]);

  const patchSteps = useCallback((patch: Partial<CtSolutionSteps>) => {
    setSteps(prev => ({ ...prev, ...patch }));
    scheduleSave();
  }, [scheduleSave]);

  const toggleDone = useCallback((key: StepKey) => {
    setStepStatus(prev => ({ ...prev, [key]: !prev[key] }));
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // ── AI assist ──────────────────────────────────────────────
  const askAi = useCallback(async (kind: 'decompose' | 'pattern_hint' | 'algorithm_review' | 'code_feedback' | 'reflect_prompt', context: string) => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiFeedback(null);
    try {
      const res = await ctTool.aiAssist(courseId, {
        kind,
        problemTitle: problem.title,
        problemDescription: problem.description,
        context,
      });
      setAiFeedback({ step: active, feedback: res.feedback, suggestions: res.suggestions });
    } catch {
      setAiFeedback({ step: active, feedback: 'AI 暂时不可用，先自己试试提示里的思路。', suggestions: [] });
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, courseId, problem, active]);

  // ── Run code ───────────────────────────────────────────────
  const runCode = useCallback(async () => {
    const source = steps.code?.source ?? '';
    if (running || !source.trim()) return;
    setRunning(true);
    setOutput('');
    const res = await run(source);
    const out = (res.output || '') + (res.error ? `\n❌ ${res.error}` : '');
    setOutput(out);
    patchSteps({ code: { source, lastOutput: out.slice(0, 2000) } });
    setRunning(false);
  }, [steps.code, running, run, patchSteps]);

  // ── Publish ────────────────────────────────────────────────
  const publish = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      // Flush pending edits first
      const { steps: s, stepStatus: st } = latestRef.current;
      await ctTool.saveSolution(courseId, problem.id, { steps: s, step_status: st });
      const res = await ctTool.publish(courseId, problem.id);
      setPublishedNote(res.noteId);
    } catch (e) {
      setAiFeedback({ step: 'reflection', feedback: e instanceof Error ? e.message : '发布失败，工作区可能还是空的', suggestions: [] });
    } finally {
      setPublishing(false);
    }
  }, [publishing, courseId, problem.id]);

  const doneCount = ['decomposition', 'pattern', 'abstraction', 'algorithm', 'code'].filter(k => stepStatus[k]).length;

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-stone-400">载入工作区…</div>;
  }

  const decompNodes = steps.decomposition?.nodes ?? [];
  const algoSteps = steps.algorithm?.steps ?? [];

  return (
    <div className="flex h-full flex-col bg-stone-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-gray-950">
        <button onClick={onClose} className="flex items-center gap-1 text-xs font-medium text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-200">
          <RemixIcon name="arrow-left-line" size={14} />
          返回问题库
        </button>
        <div className="h-4 w-px bg-stone-200 dark:bg-stone-700" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">{problem.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-[0.6875rem] ${saveState === 'saved' ? 'text-emerald-600' : 'text-amber-500'}`}>
            <RemixIcon name={saveState === 'saved' ? 'checkbox-circle-line' : 'loader-4-line'} size={12} className={saveState === 'saving' ? 'animate-spin' : ''} />
            {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '待保存'}
          </span>
          <span className="text-[0.6875rem] tabular-nums text-stone-400">{doneCount}/5 步完成</span>
        </div>
      </div>

      {/* Problem description */}
      <div className="flex-none border-b border-stone-200 bg-white px-4 py-2.5 dark:border-stone-800 dark:bg-gray-950">
        <p className="text-[0.7812rem] leading-relaxed text-stone-600 dark:text-stone-300">{problem.description}</p>
        {problem.hints.length > 0 && (
          <button onClick={() => setShowHints(s => !s)} className="mt-1 flex items-center gap-1 text-[0.6875rem] font-medium text-amber-600 hover:underline dark:text-amber-400">
            <RemixIcon name="lightbulb-line" size={12} />
            {showHints ? '收起提示' : `思路提示（${problem.hints.length}）`}
          </button>
        )}
        {showHints && (
          <div className="mt-1.5 space-y-1 animate-in fade-in duration-200">
            {problem.hints.map((h, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[0.7188rem] text-stone-500 dark:text-stone-400">
                <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-[0.5625rem] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{i + 1}</span>
                {h}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Step navigation — freely navigable (KB: epistemic agency) */}
        <nav className="flex w-44 flex-none flex-col gap-1 overflow-y-auto border-r border-stone-200 bg-white p-2 dark:border-stone-800 dark:bg-gray-950">
          {STEPS.map((s, i) => {
            const isActive = active === s.key;
            const isDone = !!stepStatus[s.key];
            return (
              <button
                key={s.key}
                onClick={() => { setActive(s.key); setAiFeedback(null); }}
                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-all ${isActive
                  ? 'bg-[#000080]/[0.06] text-[#000080] dark:bg-[#4169E1]/15 dark:text-[#93AAFD]'
                  : 'text-stone-500 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-900'}`}
              >
                <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg ${isDone ? 'bg-emerald-100 dark:bg-emerald-500/15' : isActive ? 'bg-[#000080]/10 dark:bg-[#4169E1]/20' : 'bg-stone-100 dark:bg-stone-800'}`}>
                  {isDone
                    ? <RemixIcon name="check-line" size={13} className="text-emerald-600 dark:text-emerald-400" />
                    : <RemixIcon name={s.icon} size={13} />}
                </div>
                <div className="min-w-0">
                  <div className={`truncate text-[0.75rem] font-semibold ${isActive ? '' : 'text-stone-700 dark:text-stone-300'}`}>{s.label}</div>
                  <div className="text-[0.6875rem] text-stone-400">{i < 5 ? `步骤 ${i + 1}` : '收尾'}</div>
                </div>
              </button>
            );
          })}
          <p className="mt-auto px-2 pb-1 pt-3 text-[0.5938rem] leading-relaxed text-stone-400">
            步骤顺序由你决定——真实的问题解决常常来回穿梭
          </p>
        </nav>

        {/* Active step workspace */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {/* Step header with question + done toggle */}
          <div className="mb-3 flex flex-none items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                {STEPS.find(s => s.key === active)?.label}
              </h3>
              <p className="text-[0.75rem] text-stone-500 dark:text-stone-400">{STEPS.find(s => s.key === active)?.question}</p>
            </div>
            {active !== 'reflection' && (
              <button
                onClick={() => toggleDone(active)}
                className={`flex flex-none items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[0.6875rem] font-semibold transition-all active:scale-95 ${stepStatus[active]
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'border-stone-300 text-stone-500 hover:border-stone-400 dark:border-stone-600 dark:text-stone-400'}`}
              >
                <RemixIcon name={stepStatus[active] ? 'checkbox-circle-fill' : 'checkbox-blank-circle-line'} size={13} />
                {stepStatus[active] ? '已完成' : '标记完成'}
              </button>
            )}
          </div>

          {/* AI feedback banner */}
          {aiFeedback && aiFeedback.step === active && (
            <div className="mb-3 flex-none rounded-xl border border-[#000080]/15 bg-[#000080]/[0.03] p-3.5 dark:border-[#4169E1]/25 dark:bg-[#4169E1]/10 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-start gap-2">
                <RemixIcon name="robot-2-line" size={14} className="mt-0.5 flex-shrink-0 text-[#000080] dark:text-[#93AAFD]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.7812rem] leading-relaxed text-stone-700 dark:text-stone-200">{aiFeedback.feedback}</p>
                  {aiFeedback.suggestions.length > 0 && active === 'decomposition' && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {aiFeedback.suggestions.map((sug, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            patchSteps({ decomposition: { nodes: [...decompNodes, sug] } });
                            setAiFeedback(f => f ? { ...f, suggestions: f.suggestions.filter(x => x !== sug) } : f);
                          }}
                          className="flex items-center gap-1 rounded-full border border-[#000080]/25 bg-white px-2.5 py-1 text-[0.6875rem] text-[#000080] transition-colors hover:bg-[#000080]/5 dark:border-[#4169E1]/40 dark:bg-stone-900 dark:text-[#93AAFD]"
                        >
                          <RemixIcon name="add-line" size={11} />
                          {sug}
                        </button>
                      ))}
                    </div>
                  )}
                  {aiFeedback.suggestions.length > 0 && active === 'algorithm' && (
                    <ul className="mt-1.5 space-y-0.5 text-[0.7188rem] text-stone-500 dark:text-stone-400">
                      {aiFeedback.suggestions.map((sug, i) => <li key={i}>· {sug}</li>)}
                    </ul>
                  )}
                </div>
                <button onClick={() => setAiFeedback(null)} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200">
                  <RemixIcon name="close-line" size={13} />
                </button>
              </div>
            </div>
          )}

          {/* ── Step: Decomposition ── */}
          {active === 'decomposition' && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
                <div className="mx-auto mb-3 w-fit rounded-xl bg-[#000080] px-4 py-2 text-center text-[0.8125rem] font-semibold text-white dark:bg-[#4169E1]">
                  {problem.title}
                </div>
                {decompNodes.length > 0 && <div className="mx-auto h-4 w-px bg-stone-300 dark:bg-stone-600" />}
                <div className="flex flex-wrap justify-center gap-2">
                  {decompNodes.map((node, i) => (
                    <div key={i} className="group flex items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[0.7812rem] text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
                      {node}
                      <button
                        onClick={() => patchSteps({ decomposition: { nodes: decompNodes.filter((_, j) => j !== i) } })}
                        className="text-stone-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                      >
                        <RemixIcon name="close-line" size={12} />
                      </button>
                    </div>
                  ))}
                  {decompNodes.length === 0 && (
                    <p className="py-4 text-[0.75rem] text-stone-400">还没有子问题——把大问题拆开，每次添加一个</p>
                  )}
                </div>
              </div>
              <SubItemInput placeholder="添加一个子问题，如「先解决只有 1 个盘的情况」" onAdd={v => patchSteps({ decomposition: { nodes: [...decompNodes, v] } })} />
              <button
                onClick={() => askAi('decompose', decompNodes.join('；'))}
                disabled={aiBusy}
                className="flex items-center gap-1.5 rounded-xl border border-[#000080]/20 px-3.5 py-2 text-[0.75rem] font-medium text-[#000080] transition-colors hover:bg-[#000080]/5 disabled:opacity-50 dark:border-[#4169E1]/35 dark:text-[#93AAFD] dark:hover:bg-[#4169E1]/10"
              >
                <RemixIcon name={aiBusy ? 'loader-4-line' : 'sparkling-2-line'} size={13} className={aiBusy ? 'animate-spin' : ''} />
                AI：我漏了什么子问题？
              </button>
            </div>
          )}

          {/* ── Step: Pattern ── */}
          {active === 'pattern' && (
            <div className="space-y-3">
              <textarea
                value={steps.pattern?.observation ?? ''}
                onChange={e => patchSteps({ pattern: { observation: e.target.value } })}
                rows={7}
                placeholder={'从最小的例子开始试：\nN=1 时……\nN=2 时……\nN=3 时……\n\n我发现的规律是：'}
                className="w-full resize-y rounded-2xl border border-stone-200 bg-white p-4 text-[0.8125rem] leading-relaxed text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
              />
              <button
                onClick={() => askAi('pattern_hint', steps.pattern?.observation ?? '')}
                disabled={aiBusy}
                className="flex items-center gap-1.5 rounded-xl border border-[#000080]/20 px-3.5 py-2 text-[0.75rem] font-medium text-[#000080] transition-colors hover:bg-[#000080]/5 disabled:opacity-50 dark:border-[#4169E1]/35 dark:text-[#93AAFD] dark:hover:bg-[#4169E1]/10"
              >
                <RemixIcon name={aiBusy ? 'loader-4-line' : 'sparkling-2-line'} size={13} className={aiBusy ? 'animate-spin' : ''} />
                AI：帮我看看这个规律对吗
              </button>
            </div>
          )}

          {/* ── Step: Abstraction ── */}
          {active === 'abstraction' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-stone-100 px-4 py-3 text-[0.75rem] leading-relaxed text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                抽象 = 抓住本质、忽略细节。想一想：如果把盘子换成书、柱子换成桌子，问题变了吗？哪些信息是解题必需的，哪些只是表面装饰？
              </div>
              <textarea
                value={steps.abstraction?.essence ?? ''}
                onChange={e => patchSteps({ abstraction: { essence: e.target.value } })}
                rows={6}
                placeholder={'这个问题的本质是……\n可以忽略的细节有……\n它和我见过的哪类问题相似？'}
                className="w-full resize-y rounded-2xl border border-stone-200 bg-white p-4 text-[0.8125rem] leading-relaxed text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
              />
            </div>
          )}

          {/* ── Step: Algorithm ── */}
          {active === 'algorithm' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                {algoSteps.map((s, i) => (
                  <div key={i} className="group flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 dark:border-stone-800 dark:bg-stone-950">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-[#000080]/[0.06] text-[0.6875rem] font-bold text-[#000080] dark:bg-[#4169E1]/15 dark:text-[#93AAFD]">{i + 1}</span>
                    <span className="min-w-0 flex-1 text-[0.8125rem] text-stone-700 dark:text-stone-200">{s}</span>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        disabled={i === 0}
                        onClick={() => {
                          const next = [...algoSteps];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          patchSteps({ algorithm: { steps: next } });
                        }}
                        className="rounded p-1 text-stone-400 hover:text-stone-700 disabled:opacity-30 dark:hover:text-stone-200"
                      >
                        <RemixIcon name="arrow-up-s-line" size={14} />
                      </button>
                      <button
                        disabled={i === algoSteps.length - 1}
                        onClick={() => {
                          const next = [...algoSteps];
                          [next[i], next[i + 1]] = [next[i + 1], next[i]];
                          patchSteps({ algorithm: { steps: next } });
                        }}
                        className="rounded p-1 text-stone-400 hover:text-stone-700 disabled:opacity-30 dark:hover:text-stone-200"
                      >
                        <RemixIcon name="arrow-down-s-line" size={14} />
                      </button>
                      <button
                        onClick={() => patchSteps({ algorithm: { steps: algoSteps.filter((_, j) => j !== i) } })}
                        className="rounded p-1 text-stone-400 hover:text-rose-500"
                      >
                        <RemixIcon name="close-line" size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {algoSteps.length === 0 && (
                  <p className="rounded-xl border border-dashed border-stone-300 py-6 text-center text-[0.75rem] text-stone-400 dark:border-stone-700">
                    用一句话写下第一步，逐步搭出完整流程
                  </p>
                )}
              </div>
              <SubItemInput placeholder="添加一个步骤，如「如果只有一个盘，直接移动」" onAdd={v => patchSteps({ algorithm: { steps: [...algoSteps, v] } })} />
              <button
                onClick={() => askAi('algorithm_review', algoSteps.map((s, i) => `${i + 1}. ${s}`).join('\n'))}
                disabled={aiBusy || algoSteps.length === 0}
                className="flex items-center gap-1.5 rounded-xl border border-[#000080]/20 px-3.5 py-2 text-[0.75rem] font-medium text-[#000080] transition-colors hover:bg-[#000080]/5 disabled:opacity-50 dark:border-[#4169E1]/35 dark:text-[#93AAFD] dark:hover:bg-[#4169E1]/10"
              >
                <RemixIcon name={aiBusy ? 'loader-4-line' : 'sparkling-2-line'} size={13} className={aiBusy ? 'animate-spin' : ''} />
                AI：审查我的算法步骤
              </button>
            </div>
          )}

          {/* ── Step: Code ── */}
          {active === 'code' && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="min-h-0 flex-1" style={{ minHeight: 280 }}>
                <PyCodeEditor
                  value={steps.code?.source ?? ''}
                  onChange={v => patchSteps({ code: { ...steps.code, source: v } })}
                  disabled={running}
                  minHeight={280}
                />
              </div>
              <div className="flex flex-none gap-2">
                <button
                  onClick={runCode}
                  disabled={running || !engineReady || !(steps.code?.source ?? '').trim()}
                  className="flex items-center gap-1.5 rounded-xl bg-[#000080] px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-40 dark:bg-[#4169E1]"
                >
                  <RemixIcon name={running ? 'loader-4-line' : 'play-line'} size={15} className={running ? 'animate-spin' : ''} />
                  {running ? '运行中…' : '运行'}
                </button>
                <button
                  onClick={() => askAi('code_feedback', `代码：\n${steps.code?.source ?? ''}\n\n输出：\n${output || '(还没运行)'}`)}
                  disabled={aiBusy}
                  className="flex items-center gap-1.5 rounded-xl border border-[#000080]/20 px-3.5 py-2 text-[0.75rem] font-medium text-[#000080] transition-colors hover:bg-[#000080]/5 disabled:opacity-50 dark:border-[#4169E1]/35 dark:text-[#93AAFD] dark:hover:bg-[#4169E1]/10"
                >
                  <RemixIcon name={aiBusy ? 'loader-4-line' : 'sparkling-2-line'} size={13} className={aiBusy ? 'animate-spin' : ''} />
                  AI：给点提示（不要答案）
                </button>
                {!engineReady && (
                  <span className="flex items-center gap-1 text-[0.6875rem] text-amber-500">
                    <RemixIcon name="loader-4-line" size={12} className="animate-spin" />
                    Python 引擎加载中…
                  </span>
                )}
              </div>
              <div className="flex h-36 flex-none flex-col overflow-hidden rounded-xl border border-stone-800 bg-[#0c0a09]">
                <div className="flex flex-none items-center gap-1.5 border-b border-stone-800 px-3 py-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                  <span className="ml-2 text-[0.6875rem] text-stone-500">输出</span>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3.5 py-2.5 font-mono text-[0.75rem] leading-relaxed text-emerald-300/90">
                  {output || '点击「运行」验证你的算法'}
                </pre>
              </div>
            </div>
          )}

          {/* ── Step: Reflection + Publish ── */}
          {active === 'reflection' && (
            <div className="space-y-3">
              <textarea
                value={steps.reflection?.text ?? ''}
                onChange={e => patchSteps({ reflection: { text: e.target.value } })}
                rows={6}
                placeholder={'· 这个解法的关键一步是什么？\n· 同样的思路还能解决什么问题？\n· 什么情况下这个方法会失效？'}
                className="w-full resize-y rounded-2xl border border-stone-200 bg-white p-4 text-[0.8125rem] leading-relaxed text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
              />
              <button
                onClick={() => askAi('reflect_prompt', `分解:${decompNodes.join('/')} 模式:${steps.pattern?.observation?.slice(0, 100) ?? ''} 算法:${algoSteps.join('/')}`)}
                disabled={aiBusy}
                className="flex items-center gap-1.5 rounded-xl border border-[#000080]/20 px-3.5 py-2 text-[0.75rem] font-medium text-[#000080] transition-colors hover:bg-[#000080]/5 disabled:opacity-50 dark:border-[#4169E1]/35 dark:text-[#93AAFD] dark:hover:bg-[#4169E1]/10"
              >
                <RemixIcon name={aiBusy ? 'loader-4-line' : 'sparkling-2-line'} size={13} className={aiBusy ? 'animate-spin' : ''} />
                AI：给我一个更深的反思问题
              </button>

              {publishedNote ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10 animate-in zoom-in-95 duration-300">
                  <RemixIcon name="checkbox-circle-fill" size={28} className="mx-auto text-emerald-500" />
                  <p className="mt-2 text-sm font-bold text-stone-900 dark:text-stone-100">解题方案已发布到课程社区</p>
                  <p className="mt-1 text-[0.75rem] text-stone-500">同伴可以在你的方案之上继续建构与改进，你也随时可以重新发布</p>
                  <button
                    onClick={publish}
                    disabled={publishing}
                    className="mt-3 rounded-xl border border-emerald-300 px-4 py-2 text-[0.75rem] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                  >
                    {publishing ? '更新中…' : '更新已发布的方案'}
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-stone-300 p-5 text-center dark:border-stone-700">
                  <p className="text-[0.7812rem] text-stone-500 dark:text-stone-400">
                    把你的分解、规律、算法和反思整理成一篇 Note 发布到社区——你的方案会成为集体知识的一部分
                  </p>
                  <button
                    onClick={publish}
                    disabled={publishing}
                    className="mt-3 flex items-center gap-2 rounded-xl bg-[#000080] px-6 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-40 dark:bg-[#4169E1] mx-auto"
                  >
                    <RemixIcon name={publishing ? 'loader-4-line' : 'send-plane-fill'} size={15} className={publishing ? 'animate-spin' : ''} />
                    {publishing ? '发布中…' : '发布到课程社区'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Small input row with an add button, used by decomposition & algorithm steps */
const SubItemInput: React.FC<{ placeholder: string; onAdd: (v: string) => void }> = ({ placeholder, onAdd }) => {
  const [value, setValue] = useState('');
  const submit = () => {
    if (!value.trim()) return;
    onAdd(value.trim());
    setValue('');
  };
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        maxLength={120}
        placeholder={placeholder}
        className="flex-1 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-[0.8125rem] text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        className="rounded-xl bg-[#000080] px-4 text-sm font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-95 disabled:opacity-40 dark:bg-[#4169E1]"
      >
        <RemixIcon name="add-line" size={16} />
      </button>
    </div>
  );
};

export default CTWorkbench;
