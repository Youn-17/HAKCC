import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import RemixIcon from './RemixIcon';
import { AiThinkingDots, SHOW_SECONDS_AFTER_MS, SLOW_HINT_AFTER_MS } from './AiThinking';
import { TOOL_META, type ToolCallInfo } from './AgentToolCallDisplay';
import { formatSeconds } from './agentProcessSteps';

/**
 * AI 回答时一步步显示它在做什么。
 *
 * - 还没开始写（waiting）：每一步一行，先转圈，做完打勾、写一句结果和用时；
 *   最后一行是「正在思考」或「正在组织回答」，带已经等了几秒。
 * - 开始写了（writing）/ 写完了（done）：收成一行「用了 3 步 · 6 秒」，点开还能看每一步。
 *   没用工具的回答这一行不出现。
 * 不显示模型原始的思考内容：太长、中英夹杂，学生不会看。
 */

export interface AgentProcessProps {
  steps: readonly ToolCallInfo[];
  phase: 'waiting' | 'writing' | 'done';
  lang: 'zh' | 'en';
  /** 这一轮开始的时刻（毫秒时间戳），等待时算秒数 */
  startedAt?: number;
  /** 写完以后的总用时（毫秒）；没有就不显示秒数 */
  elapsedMs?: number;
  /** 模型正在想（DeepSeek 先推理）：最后一行写「正在思考」 */
  thinking?: boolean;
}

const COPY = {
  zh: {
    thinking: '正在思考',
    composing: '正在组织回答',
    slow: '想得久一点，回答会更完整',
    seconds: (s: string) => `${s} 秒`,
    used: (n: number) => `用了 ${n} 步`,
    show: '看每一步',
    hide: '收起',
  },
  en: {
    thinking: 'Thinking',
    composing: 'Putting the answer together',
    slow: 'Taking a little longer to get it right',
    seconds: (s: string) => `${s}s`,
    used: (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`,
    show: 'Show steps',
    hide: 'Hide',
  },
};

function label(name: string, lang: 'zh' | 'en'): { text: string; icon: string } {
  const meta = TOOL_META[name];
  return { text: meta ? meta[lang] : name, icon: meta?.icon ?? 'tools-line' };
}

const StepRow: React.FC<{ step: ToolCallInfo; lang: 'zh' | 'en' }> = ({ step, lang }) => {
  const t = COPY[lang];
  const { text, icon } = label(step.name, lang);
  return (
    <li className="agent-step-enter flex min-w-0 items-center gap-2 text-[0.75rem] leading-5">
      <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
        {step.status === 'running'
          ? <Loader2 size={13} className="animate-spin text-[#000080] dark:text-blue-300" />
          : step.status === 'error'
            ? <RemixIcon name="error-warning-fill" size={14} className="text-rose-500" />
            : <RemixIcon name="checkbox-circle-fill" size={14} className="text-emerald-500" />}
      </span>
      <RemixIcon name={icon} size={13} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <span className={`shrink-0 font-medium ${step.status === 'running' ? 'text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}`}>{text}</span>
      {step.result && <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">· {step.result}</span>}
      {step.duration != null && step.status !== 'running' && (
        <span className="ml-auto shrink-0 pl-2 tabular-nums text-gray-400 dark:text-gray-500">{t.seconds(formatSeconds(step.duration))}</span>
      )}
    </li>
  );
};

const AgentProcess: React.FC<AgentProcessProps> = ({ steps, phase, lang, startedAt, elapsedMs, thinking }) => {
  const t = COPY[lang];
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  if (phase === 'waiting') {
    const waited = startedAt ? Math.max(0, now - startedAt) : 0;
    const anyRunning = steps.some(s => s.status === 'running');
    return (
      <div role="status" aria-live="polite" data-ai-busy className="space-y-1.5" data-agent-process="waiting">
        {steps.length > 0 && (
          <ul className="space-y-1">
            {steps.map((step, i) => <StepRow key={`${step.name}-${i}`} step={step} lang={lang} />)}
          </ul>
        )}
        {!anyRunning && (
          <div className="agent-step-enter flex items-center gap-2 text-[0.75rem] leading-5">
            <AiThinkingDots />
            <span className="ai-shimmer font-medium">{thinking || steps.length === 0 ? t.thinking : t.composing}</span>
            {waited >= SHOW_SECONDS_AFTER_MS && (
              <span className="tabular-nums text-gray-400 dark:text-gray-500">{t.seconds(String(Math.floor(waited / 1000)))}</span>
            )}
          </div>
        )}
        {waited >= SLOW_HINT_AFTER_MS && !anyRunning && (
          <p className="pl-6 text-[0.6875rem] text-gray-400 dark:text-gray-500">{t.slow}</p>
        )}
      </div>
    );
  }

  if (steps.length === 0) return null;
  const summary = [t.used(steps.length), elapsedMs != null ? t.seconds(formatSeconds(elapsedMs)) : null].filter(Boolean).join(' · ');
  return (
    <div className="mb-2" data-agent-process={phase}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        title={open ? t.hide : t.show}
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950"
      >
        <RemixIcon name="checkbox-circle-fill" size={12} />
        {summary}
        <RemixIcon name={open ? 'arrow-up-s-line' : 'arrow-down-s-line'} size={13} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 rounded-lg border border-gray-200/80 bg-white/70 px-2.5 py-2 dark:border-gray-700 dark:bg-gray-900/40">
          {steps.map((step, i) => <StepRow key={`${step.name}-${i}`} step={step} lang={lang} />)}
        </ul>
      )}
    </div>
  );
};

export default AgentProcess;
