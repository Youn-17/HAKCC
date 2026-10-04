import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { codingTrainer, type CodingProfile, type CodingTask } from '../services/apiClient';
import RemixIcon from './RemixIcon';
import { usePythonRunner } from '../hooks/usePythonRunner';
import PyCodeEditor from './PyCodeEditor';

interface Props {
  zh: boolean;
}

type CodingMode = 'challenge' | 'bughunt' | 'sandbox';

const MODE_META: Record<CodingMode, { icon: string; gradient: string; zh: string; en: string; descZh: string; descEn: string; howZh: string; howEn: string }> = {
  challenge: {
    icon: 'rocket-2-line', gradient: 'from-emerald-500/90 to-teal-600/90',
    zh: '挑战关卡', en: 'Challenge',
    descZh: '用自然语言指挥 AI 写代码，通过全部测试过关', descEn: 'Direct the AI in natural language; pass all tests to win',
    howZh: '需求说得越清楚，迭代越少，得分越高', howEn: 'Clearer intent → fewer iterations → higher score',
  },
  bughunt: {
    icon: 'bug-line', gradient: 'from-rose-500/90 to-red-600/90',
    zh: '代码捉虫', en: 'Bug Hunt',
    descZh: 'AI 写的代码有 bug——亲手找到并修复它', descEn: 'The AI wrote buggy code — find and fix it yourself',
    howZh: '自己修满分，喊 AI 帮忙要扣分哦', howEn: 'Fix it solo for full marks; AI hints cost points',
  },
  sandbox: {
    icon: 'flask-line', gradient: 'from-sky-500/90 to-indigo-600/90',
    zh: '自由创作', en: 'Sandbox',
    descZh: '无关卡压力，和 AI 副驾一起把想法变成代码', descEn: 'No pressure — build anything with your AI copilot',
    howZh: '想到什么做什么，运行和提问都攒经验', howEn: 'Runs and prompts both earn XP',
  },
};

const CODING_SKILL_META: Record<string, { zh: string; en: string }> = {
  prompting: { zh: '提示力', en: 'Prompting' },
  reading: { zh: '读码', en: 'Reading' },
  debugging: { zh: '调试', en: 'Debugging' },
  iteration: { zh: '迭代', en: 'Iteration' },
};

// Shared editor lives in PyCodeEditor.tsx (also used by the CT tool)
const CodeEditor = PyCodeEditor;

// ── Playing screen ─────────────────────────────────────────────

interface GameSession {
  sessionId: string;
  mode: CodingMode;
  difficulty: number;
  aiPowered: boolean;
  task: CodingTask;
}

interface ChatMsg {
  role: 'me' | 'ai';
  text: string;
  action?: string;
}

const PlayScreen: React.FC<{ session: GameSession; zh: boolean; onExit: () => void; onFinished: (settle: any) => void }> = ({ session, zh, onExit, onFinished }) => {
  const { run, engineReady } = usePythonRunner();
  const [code, setCode] = useState(session.task.starterCode ?? '');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'running' | 'passed' | 'failed'>('idle');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [prompt, setPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiCalls, setAiCalls] = useState(0);
  const [showTests, setShowTests] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const runCode = useCallback(async () => {
    if (running || !code.trim()) return;
    setRunning(true);
    setOutput('');
    void codingTrainer.countRun(session.sessionId).catch(() => {});
    const res = await run(code);
    setOutput((res.output || '') + (res.error ? `\n❌ ${res.error}` : ''));
    setRunning(false);
  }, [code, run, running, session.sessionId]);

  const runTests = useCallback(async () => {
    if (running || !code.trim() || !session.task.testCode) return;
    setRunning(true);
    setTestState('running');
    void codingTrainer.countRun(session.sessionId).catch(() => {});
    const combined = `${code}\n\n# ── 测试 ──\n${session.task.testCode}`;
    const res = await run(combined);
    const passed = res.ok && res.output.includes('__ALL_TESTS_PASSED__');
    setOutput((res.output || '').replace('__ALL_TESTS_PASSED__', '') + (res.error ? `\n❌ ${res.error}` : ''));
    setTestState(passed ? 'passed' : 'failed');
    setRunning(false);
  }, [code, run, running, session]);

  const askAi = useCallback(async (action: 'generate' | 'explain' | 'fix' | 'review', customPrompt?: string) => {
    if (aiBusy) return;
    const p = customPrompt ?? prompt;
    if (action === 'generate' && !p.trim()) return;
    setAiBusy(true);
    if (p.trim()) setChat(c => [...c, { role: 'me', text: p.trim() }]);
    setPrompt('');
    try {
      const res = await codingTrainer.ai(session.sessionId, {
        action,
        prompt: p.trim() || undefined,
        currentCode: code,
        lastOutput: output || undefined,
      });
      setAiCalls(n => n + 1);
      setChat(c => [...c, { role: 'ai', text: res.reply, action }]);
      if (res.code) {
        setCode(res.code);
        setTestState('idle');
      }
    } catch {
      setChat(c => [...c, { role: 'ai', text: zh ? '副驾出错了，稍后再试。' : 'Copilot error, try again.' }]);
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, prompt, code, output, session.sessionId, zh]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const settle = await codingTrainer.submit(session.sessionId, {
        passed: session.mode === 'sandbox' ? true : testState === 'passed',
        finalCode: code,
      });
      onFinished(settle);
    } catch { /* noop */ } finally {
      setSubmitting(false);
    }
  }, [submitting, session, testState, code, onFinished]);

  const meta = MODE_META[session.mode];
  const canSubmit = session.mode === 'sandbox' || testState === 'passed';

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-200px)] lg:min-h-[600px]">
      <div className="flex flex-none items-center justify-between">
        <button onClick={onExit} className="flex items-center gap-1 text-xs font-medium text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-200">
          <RemixIcon name="arrow-left-line" size={13} />
          {zh ? '退出本局' : 'Exit'}
        </button>
        <div className="flex items-center gap-2 text-[0.6875rem] text-stone-400">
          <span className="flex items-center gap-1"><RemixIcon name="robot-2-line" size={12} />{zh ? `AI 调用 ${aiCalls}` : `AI ×${aiCalls}`}</span>
          {!engineReady && <span className="flex items-center gap-1 text-amber-500"><RemixIcon name="loader-4-line" size={12} className="animate-spin" />{zh ? 'Python 引擎加载中…' : 'Loading Python…'}</span>}
        </div>
      </div>

      {/* Task card — compact banner */}
      <div className={`flex-none rounded-2xl bg-gradient-to-br ${meta.gradient} px-5 py-4 text-white`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider opacity-80">
            <RemixIcon name={meta.icon} size={13} />
            {zh ? meta.zh : meta.en}
          </span>
          <h3 className="text-lg font-bold tracking-tight">{session.task.title}</h3>
          {session.task.requires && <span className="rounded-lg bg-white/15 px-2.5 py-0.5 text-[0.7188rem] backdrop-blur-sm">{session.task.requires}</span>}
        </div>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed opacity-95">{session.task.description}</p>
        {(session.task.starterHint || session.task.bugHint) && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[0.7188rem] opacity-85">
            <RemixIcon name="lightbulb-flash-line" size={13} className="mt-0.5 flex-shrink-0" />
            {session.task.starterHint ?? (zh ? `提示：${session.task.bugHint}` : `Hint: ${session.task.bugHint}`)}
          </p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {/* Left: editor + terminal */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-1.5 flex flex-none items-center justify-between">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400">{zh ? '代码编辑器' : 'Editor'}</span>
              <div className="flex items-center gap-2">
                {session.task.testCode && (
                  <button onClick={() => setShowTests(s => !s)} className="text-[0.6875rem] text-stone-400 underline-offset-2 hover:underline">
                    {showTests ? (zh ? '隐藏测试代码' : 'Hide tests') : (zh ? '查看测试代码' : 'View tests')}
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <CodeEditor value={code} onChange={v => { setCode(v); setTestState('idle'); }} disabled={running} />
            </div>
            {showTests && session.task.testCode && (
              <pre className="mt-2 max-h-36 flex-none overflow-auto rounded-xl border border-dashed border-stone-300 bg-stone-50 p-3 font-mono text-[0.7188rem] leading-relaxed text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">{session.task.testCode}</pre>
            )}
          </div>

          <div className="flex flex-none gap-2">
            <button
              onClick={runCode}
              disabled={running || !engineReady || !code.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white py-2.5 text-sm font-semibold text-stone-700 transition-all hover:bg-stone-50 active:scale-[0.99] disabled:opacity-40 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              <RemixIcon name={running ? 'loader-4-line' : 'play-line'} size={15} className={running ? 'animate-spin' : ''} />
              {zh ? '运行' : 'Run'}
            </button>
            {session.task.testCode && (
              <button
                onClick={runTests}
                disabled={running || !engineReady || !code.trim()}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-white transition-all active:scale-[0.99] disabled:opacity-40 ${testState === 'passed' ? 'bg-emerald-600' : 'bg-[#000080] hover:bg-[#000080]/90 dark:bg-[#4169E1]'}`}
              >
                <RemixIcon name={testState === 'passed' ? 'checkbox-circle-fill' : 'flask-line'} size={15} />
                {testState === 'passed' ? (zh ? '测试全部通过！' : 'All tests passed!') : (zh ? '运行测试' : 'Run tests')}
              </button>
            )}
            {canSubmit && (
              <button
                onClick={submit}
                disabled={submitting}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-amber-600 active:scale-[0.99] animate-in zoom-in duration-300"
              >
                <RemixIcon name="flag-line" size={15} />
                {session.mode === 'sandbox' ? (zh ? '结束创作' : 'Wrap up') : (zh ? '提交过关！' : 'Submit!')}
              </button>
            )}
          </div>

          {/* Terminal */}
          <div className="flex h-44 flex-none flex-col overflow-hidden rounded-xl border border-stone-800 bg-[#0c0a09]">
            <div className="flex flex-none items-center gap-1.5 border-b border-stone-800 px-3 py-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
              <span className="ml-2 text-[0.6875rem] text-stone-500">{zh ? '输出' : 'Output'}</span>
              {testState === 'failed' && <span className="ml-auto text-[0.6875rem] font-semibold text-red-400">{zh ? '测试未通过' : 'Tests failed'}</span>}
              {testState === 'passed' && <span className="ml-auto text-[0.6875rem] font-semibold text-emerald-400">{zh ? '测试通过 ✓' : 'Passed ✓'}</span>}
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3.5 py-2.5 font-mono text-[0.75rem] leading-relaxed text-emerald-300/90">
              {output || (running ? (zh ? '运行中…' : 'Running…') : (zh ? '点击「运行」查看输出' : 'Hit Run to see output'))}
            </pre>
          </div>
        </div>

        {/* Right: AI copilot */}
        <div className="flex min-h-[480px] flex-col rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950 lg:min-h-0">
          <div className="flex flex-none items-center gap-2 border-b border-stone-100 px-4 py-3 dark:border-stone-800">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600">
              <RemixIcon name="robot-2-line" size={14} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{zh ? 'AI 副驾' : 'AI Copilot'}</span>
            {session.mode === 'bughunt' && (
              <span className="ml-auto rounded-full bg-rose-50 px-2 py-0.5 text-[0.5938rem] font-semibold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
                {zh ? '求助扣 30 分' : 'Help costs 30pts'}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {chat.length === 0 && (
              <div className="pt-6 text-center">
                <RemixIcon name="chat-smile-3-line" size={24} className="mx-auto text-stone-300 dark:text-stone-600" />
                <p className="mt-2 text-[0.75rem] leading-relaxed text-stone-400">
                  {session.mode === 'challenge'
                    ? (zh ? '用自然语言描述你要的代码，越具体越好。\n例：「写一个函数叫 grade，输入分数……」' : 'Describe what you want in plain language — be specific.')
                    : session.mode === 'bughunt'
                      ? (zh ? '先自己读代码、跑测试找线索。\n实在卡住再来问我（会扣分哦）。' : 'Read the code and run the tests first. Ask me only if stuck (costs points).')
                      : (zh ? '想做什么？我来帮你写。' : 'What shall we build?')}
                </p>
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'me' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
                <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[0.7812rem] leading-relaxed ${m.role === 'me'
                  ? 'rounded-br-sm bg-[#000080] text-white dark:bg-[#4169E1]'
                  : 'rounded-bl-sm bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200'}`}>
                  {m.text}
                </div>
              </div>
            ))}
            {aiBusy && (
              <div className="flex items-center gap-2 text-[0.75rem] text-stone-400">
                <RemixIcon name="loader-4-line" size={13} className="animate-spin" />
                {zh ? '副驾思考中…' : 'Thinking…'}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick actions + input */}
          <div className="flex-none border-t border-stone-100 p-3 dark:border-stone-800">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {([
                { action: 'explain' as const, icon: 'book-open-line', zh: '解释代码', en: 'Explain' },
                { action: 'fix' as const, icon: 'tools-line', zh: session.mode === 'bughunt' ? '给点提示' : '帮我修错', en: 'Fix' },
                { action: 'review' as const, icon: 'award-line', zh: '审查代码', en: 'Review' },
              ]).map(qa => (
                <button
                  key={qa.action}
                  onClick={() => askAi(qa.action)}
                  disabled={aiBusy || !code.trim()}
                  className="flex items-center gap-1 rounded-full border border-stone-200 px-2.5 py-1 text-[0.6875rem] font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-40 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
                >
                  <RemixIcon name={qa.icon} size={11} />
                  {zh ? qa.zh : qa.en}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && prompt.trim()) askAi('generate'); }}
                maxLength={1000}
                placeholder={zh ? '描述需求，让 AI 写代码…' : 'Describe what you want…'}
                className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[0.8125rem] text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              />
              <button
                onClick={() => askAi('generate')}
                disabled={aiBusy || !prompt.trim()}
                className="rounded-xl bg-[#000080] px-3.5 text-sm font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-95 disabled:opacity-40 dark:bg-[#4169E1]"
              >
                <RemixIcon name="send-plane-fill" size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Result screen ──────────────────────────────────────────────

const ResultScreen: React.FC<{ settle: any; mode: CodingMode; zh: boolean; onHome: () => void; onReplay: () => void }> = ({ settle, mode, zh, onHome, onReplay }) => {
  const meta = MODE_META[mode];
  return (
    <div className="mx-auto max-w-md space-y-4 pt-6 text-center animate-in zoom-in-95 fade-in duration-300">
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.gradient}`}>
        <RemixIcon name={meta.icon} size={30} className="text-white" />
      </div>
      <div>
        <div className="text-[0.6875rem] font-semibold uppercase tracking-widest text-stone-400">{zh ? meta.zh : meta.en} · {zh ? '本局得分' : 'Score'}</div>
        <div className="mt-1 text-5xl font-black tabular-nums tracking-tight text-stone-900 dark:text-stone-100">{settle.score}</div>
        {settle.isNewBest && settle.score > 0 && (
          <span className="mt-2 inline-block animate-bounce rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {zh ? '🏆 新纪录！' : '🏆 New best!'}
          </span>
        )}
      </div>
      <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5 text-left dark:border-stone-800 dark:bg-stone-950">
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-500">XP</span>
          <span className="text-sm font-bold text-emerald-600">+{settle.xpGain}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-500">{zh ? '等级' : 'Level'}</span>
          <span className="flex items-center gap-2 text-sm font-bold text-stone-900 dark:text-stone-100">
            Lv.{settle.level}
            {settle.leveledUp && <span className="animate-pulse rounded-full bg-sky-100 px-2 py-0.5 text-[0.6875rem] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">{zh ? '升级！' : 'LEVEL UP!'}</span>}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-500">{zh ? '连续训练' : 'Streak'}</span>
          <span className="flex items-center gap-1 text-sm font-bold text-stone-900 dark:text-stone-100">
            <RemixIcon name="fire-fill" size={14} className="text-orange-500" />
            {settle.streak} {zh ? '天' : 'days'}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onReplay} className="flex-1 rounded-xl bg-[#000080] py-3 text-sm font-bold text-white active:scale-[0.98] dark:bg-[#4169E1]">
          {zh ? '再来一局' : 'Play again'}
        </button>
        <button onClick={onHome} className="flex-1 rounded-xl border border-stone-200 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900">
          {zh ? '返回' : 'Back'}
        </button>
      </div>
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────

const CodingDojo: React.FC<Props> = ({ zh }) => {
  const [profile, setProfile] = useState<CodingProfile | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; mode: string; title: string; score: number; created_at: string }>>([]);
  const [session, setSession] = useState<GameSession | null>(null);
  const [starting, setStarting] = useState<CodingMode | null>(null);
  const [difficulty, setDifficulty] = useState(1);
  const [settle, setSettle] = useState<any>(null);

  const loadProfile = useCallback(() => {
    codingTrainer.profile()
      .then(res => { setProfile(res.profile); setRecent(res.recentSessions as any); })
      .catch(() => { /* noop */ });
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const startGame = useCallback(async (mode: CodingMode) => {
    if (starting) return;
    setStarting(mode);
    try {
      const res = await codingTrainer.start(mode, difficulty);
      setSession(res as GameSession);
      setSettle(null);
    } catch { /* noop */ } finally {
      setStarting(null);
    }
  }, [starting, difficulty]);

  const goHome = useCallback(() => {
    setSession(null);
    setSettle(null);
    loadProfile();
  }, [loadProfile]);

  const xpProgress = useMemo(() => {
    if (!profile) return 0;
    const prev = Math.pow(profile.level - 1, 2) * 40;
    const span = profile.nextLevelXp - prev;
    return span > 0 ? Math.min(((profile.totalXp - prev) / span) * 100, 100) : 0;
  }, [profile]);

  if (session && settle) {
    return <ResultScreen settle={settle} mode={session.mode} zh={zh} onHome={goHome} onReplay={() => { const m = session.mode; setSession(null); setSettle(null); startGame(m); }} />;
  }

  if (session) {
    return <PlayScreen session={session} zh={zh} onExit={goHome} onFinished={setSettle} />;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-indigo-600 text-white">
            <span className="text-lg font-black">Lv{profile?.level ?? 1}</span>
          </div>
          <div>
            <div className="text-sm font-bold text-stone-900 dark:text-stone-100">{zh ? '我的编程等级' : 'My Coding Level'}</div>
            <div className="mt-1 h-2 w-40 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
              <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-700" style={{ width: `${xpProgress}%` }} />
            </div>
            <div className="mt-0.5 text-[0.6875rem] tabular-nums text-stone-400">{profile?.totalXp ?? 0} / {profile?.nextLevelXp ?? 40} XP</div>
          </div>
        </div>
        <div className="flex items-center gap-5 sm:ml-auto">
          <div className="text-center">
            <div className="text-lg font-bold tabular-nums text-emerald-600">{profile?.challengesCompleted ?? 0}</div>
            <div className="text-[0.6875rem] text-stone-400">{zh ? '过关' : 'Cleared'}</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold tabular-nums text-rose-500">{profile?.bugsFixed ?? 0}</div>
            <div className="text-[0.6875rem] text-stone-400">{zh ? '捉虫' : 'Bugs fixed'}</div>
          </div>
          <div className="text-center">
            <div className="flex items-center gap-1 text-lg font-bold text-stone-900 dark:text-stone-100">
              <RemixIcon name="fire-fill" size={16} className="text-orange-500" />
              {profile?.streakDays ?? 0}
            </div>
            <div className="text-[0.6875rem] text-stone-400">{zh ? '连续天数' : 'Streak'}</div>
          </div>
          {/* Skill chips */}
          <div className="hidden flex-col gap-1 lg:flex">
            {Object.entries(CODING_SKILL_META).map(([k, m]) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="w-10 text-right text-[0.6875rem] text-stone-400">{zh ? m.zh : m.en}</span>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                  <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(((profile?.skills?.[k] ?? 0) / 40) * 100, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Difficulty */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{zh ? '难度' : 'Difficulty'}</span>
        {[1, 2, 3].map(d => (
          <button
            key={d}
            onClick={() => setDifficulty(d)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${difficulty === d ? 'bg-[#000080] text-white dark:bg-[#4169E1]' : 'bg-stone-100 text-stone-500 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400'}`}
          >
            {d === 1 ? (zh ? '新手' : 'Easy') : d === 2 ? (zh ? '进阶' : 'Medium') : (zh ? '大师' : 'Hard')}
          </button>
        ))}
        <span className="ml-2 text-[0.6875rem] text-stone-400">{zh ? '首次进入会下载 Python 引擎（约 10MB，之后有缓存）' : 'First load downloads the Python engine (~10MB, cached after)'}</span>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(Object.keys(MODE_META) as CodingMode[]).map(mode => {
          const meta = MODE_META[mode];
          const best = profile?.bestScores?.[mode] ?? 0;
          return (
            <button
              key={mode}
              onClick={() => startGame(mode)}
              disabled={!!starting}
              className="group relative overflow-hidden rounded-3xl border border-stone-200 bg-white p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-lg active:scale-[0.98] disabled:opacity-60 dark:border-stone-800 dark:bg-stone-950"
            >
              <div className={`absolute -right-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-br ${meta.gradient} opacity-[0.08] transition-transform duration-300 group-hover:scale-150`} />
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.gradient}`}>
                {starting === mode
                  ? <RemixIcon name="loader-4-line" size={22} className="animate-spin text-white" />
                  : <RemixIcon name={meta.icon} size={22} className="text-white" />}
              </div>
              <h3 className="mt-4 text-lg font-bold tracking-tight text-stone-900 dark:text-stone-100">{zh ? meta.zh : meta.en}</h3>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-stone-500 dark:text-stone-400">{zh ? meta.descZh : meta.descEn}</p>
              <p className="mt-2 flex items-center gap-1 text-[0.6875rem] text-stone-400">
                <RemixIcon name="gamepad-line" size={11} />
                {zh ? meta.howZh : meta.howEn}
              </p>
              <div className="mt-4 flex items-center justify-between">
                {best > 0 ? (
                  <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-amber-600 dark:text-amber-400">
                    <RemixIcon name="trophy-line" size={12} />
                    {zh ? `最高 ${best} 分` : `Best ${best}`}
                  </span>
                ) : <span className="text-[0.6875rem] text-stone-300 dark:text-stone-600">{zh ? '尚未挑战' : 'Not played'}</span>}
                <span className="flex items-center gap-1 text-xs font-bold text-[#000080] transition-transform group-hover:translate-x-1 dark:text-[#93AAFD]">
                  {starting === mode ? (zh ? '出题中…' : 'Preparing…') : (zh ? '开始' : 'Start')}
                  <RemixIcon name="arrow-right-line" size={13} />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Recent */}
      {recent.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
          <div className="mb-3 flex items-center gap-2">
            <RemixIcon name="history-line" size={14} className="text-[#000080] dark:text-[#93AAFD]" />
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{zh ? '最近战绩' : 'Recent'}</span>
          </div>
          <div className="space-y-1">
            {recent.slice(0, 6).map(s => {
              const meta = MODE_META[s.mode as CodingMode];
              return (
                <div key={s.id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-900">
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${meta?.gradient ?? 'from-stone-400 to-stone-500'}`}>
                    <RemixIcon name={meta?.icon ?? 'code-line'} size={14} className="text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.8125rem] font-medium text-stone-900 dark:text-stone-100">{s.title || (zh ? meta?.zh : meta?.en)}</div>
                    <div className="text-[0.6875rem] text-stone-400">{new Date(s.created_at).toLocaleDateString()}</div>
                  </div>
                  <span className="flex-shrink-0 text-sm font-bold tabular-nums text-stone-700 dark:text-stone-200">{s.score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Theory note */}
      <div className="flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3 dark:border-stone-800 dark:bg-stone-900/40">
        <RemixIcon name="book-2-line" size={13} className="mt-0.5 flex-shrink-0 text-stone-400" />
        <p className="text-[0.6875rem] leading-relaxed text-stone-500 dark:text-stone-400">
          {zh
            ? 'Vibe coding 时代的核心编程素养不是背语法，而是：把需求说清楚（提示力）、读懂 AI 生成的代码（读码）、发现并修正 AI 的错误（调试）、小步快跑地迭代。代码在你的浏览器里真实运行（Pyodide/WebAssembly），AI 是副驾，方向盘在你手上。'
            : "Vibe-coding literacy isn't memorizing syntax — it's stating intent clearly (prompting), reading AI-generated code, catching AI mistakes (debugging), and iterating in small steps. Code runs for real in your browser (Pyodide/WebAssembly); the AI is your copilot, but you hold the wheel."}
        </p>
      </div>
    </div>
  );
};

export default CodingDojo;
