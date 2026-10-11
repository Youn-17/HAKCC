import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import RemixIcon from '../RemixIcon';
import { MORANDI } from '../morandiPalette';
import { apiUrl, artifacts as artifactsApi, type AgentArtifactDetail } from '../../services/apiClient';
import {
  answeredLabel, artifactFileName, formatBytes, formatChars, sandboxedDocument,
  type AgentArtifactRef, type AgentExtras, type AgentPlan, type AgentQuestion, type AgentQuestionOption, type ArtifactProgress,
} from './agentTurn';

/**
 * 智能体一轮里文字以外的东西（2026-10-11）：计划清单、写网页的进度、做好的网页、选项卡、网页查看窗口。
 * 笔记 AI 助手和知识空间智能体都用这几个。
 *
 * 网页查看窗口：iframe 只给 allow-scripts，不给同源（网页拿不到平台的登录和本地存储），
 * 不给弹窗、表单、跳转顶层页面；网页里还写着不能联网的内容安全策略（后端存的时候加了一份，这里再加一份）。
 */

type Lang = 'zh' | 'en';

function StepIcon({ status }: { status: AgentPlan['steps'][number]['status'] }) {
  if (status === 'done') return <RemixIcon name="checkbox-circle-fill" size={14} className="mt-[3px] shrink-0" style={{ color: MORANDI.sage }} />;
  if (status === 'in_progress') return <RemixIcon name="loader-4-line" size={14} className="mt-[3px] shrink-0 animate-spin text-[#000080] dark:text-[#93AAFD]" />;
  return <RemixIcon name="checkbox-blank-circle-line" size={14} className="mt-[3px] shrink-0 text-zinc-300 dark:text-zinc-600" />;
}

function ProgressLine({ progress, lang }: { progress: ArtifactProgress; lang: Lang }) {
  const zh = lang === 'zh';
  if (progress.stage === 'failed') {
    return (
      <p className="mt-1.5 rounded-lg px-2 py-1 text-[0.6875rem] leading-5" style={{ backgroundColor: '#C27C7C1A', color: '#8A4B4B' }}>
        {zh ? `网页《${progress.title}》没做成：${progress.error ?? ''}` : `"${progress.title}" was not built: ${progress.error ?? ''}`}
      </p>
    );
  }
  return (
    <div className="mt-1.5" data-artifact-progress>
      <p className="flex items-center gap-1.5 text-[0.6875rem] text-zinc-600 dark:text-zinc-300">
        <RemixIcon name="pages-line" size={12} className="shrink-0 text-[#000080] dark:text-[#93AAFD]" />
        <span className="min-w-0 truncate">
          {zh
            ? `${progress.revising ? '正在改' : '正在做'}网页《${progress.title}》${progress.chars > 0 ? ` · 已写 ${formatChars(progress.chars, 'zh')}` : ''}`
            : `${progress.revising ? 'Revising' : 'Building'} "${progress.title}"${progress.chars > 0 ? ` · ${formatChars(progress.chars, 'en')} written` : ''}`}
        </span>
      </p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-200/70 dark:bg-gray-800">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-[#000080]/50 dark:bg-[#93AAFD]/60" />
      </div>
    </div>
  );
}

/** 计划清单（和写网页的进度）：放在回答正文上面 */
export function AgentPlanBlock({ plan, progress, lang }: { plan?: AgentPlan; progress?: ArtifactProgress; lang: Lang }) {
  if (!plan && !progress) return null;
  const zh = lang === 'zh';
  const done = plan ? plan.steps.filter(s => s.status === 'done').length : 0;
  return (
    <div className="mb-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/60" data-agent-plan>
      {plan && (
        <>
          <div className="mb-1 flex items-center justify-between text-[0.6875rem] font-semibold text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1"><RemixIcon name="list-check-3" size={12} />{zh ? '计划' : 'Plan'}</span>
            <span className="tabular-nums">{done}/{plan.steps.length}</span>
          </div>
          <ol className="space-y-0.5">
            {plan.steps.map((step, i) => (
              <li key={`${i}-${step.title}`} className="flex items-start gap-2 text-[0.75rem] leading-5">
                <StepIcon status={step.status} />
                <span className={step.status === 'done'
                  ? 'text-zinc-400 dark:text-zinc-500'
                  : step.status === 'in_progress' ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-300'}
                >
                  {step.title}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {progress && <ProgressLine progress={progress} lang={lang} />}
    </div>
  );
}

/** 选项卡：学生点一个，就当作他说了「我选：……」；答过以后按钮锁住，标出选了哪个 */
export function AgentChoiceCard({ question, answered, disabled, onChoose, onOther, lang, showQuestion = true }: {
  question: AgentQuestion;
  /** null：还没答；''：答了但不是点的选项；其余：点的那个选项 */
  answered: string | null;
  disabled?: boolean;
  onChoose: (option: AgentQuestionOption) => void;
  onOther?: () => void;
  lang: Lang;
  showQuestion?: boolean;
}) {
  const zh = lang === 'zh';
  const locked = answered !== null;
  return (
    <div className="mt-2.5 rounded-xl border border-[#000080]/15 bg-[#000080]/[0.03] p-2.5 dark:border-[#93AAFD]/20 dark:bg-[#93AAFD]/[0.05]" data-agent-question>
      {showQuestion && <p className="mb-2 text-[0.75rem] font-semibold leading-5 text-zinc-800 dark:text-zinc-100">{question.question}</p>}
      <div className="grid gap-1.5">
        {question.options.map(option => {
          const chosen = locked && answered === option.label;
          return (
            <button
              key={option.label}
              type="button"
              disabled={disabled || locked}
              onClick={() => onChoose(option)}
              aria-pressed={chosen}
              className={`min-h-11 rounded-lg border px-2.5 py-1.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 enabled:active:scale-[0.98] ${chosen
                ? 'border-[#000080] bg-white dark:border-[#93AAFD] dark:bg-gray-950'
                : 'border-zinc-200 bg-white enabled:hover:border-[#000080]/40 enabled:hover:bg-[#000080]/[0.04] disabled:opacity-55 dark:border-gray-700 dark:bg-gray-950 dark:enabled:hover:border-[#93AAFD]/50'}`}
            >
              <span className="flex items-center gap-1 text-[0.75rem] font-semibold text-zinc-900 dark:text-zinc-100">
                {option.label}
                {chosen && <RemixIcon name="check-line" size={13} className="text-[#000080] dark:text-[#93AAFD]" />}
              </span>
              {option.detail && <span className="mt-0.5 block text-[0.6875rem] leading-4 text-zinc-500 dark:text-zinc-400">{option.detail}</span>}
            </button>
          );
        })}
      </div>
      {!locked && question.allowOther && onOther && (
        <button
          type="button"
          disabled={disabled}
          onClick={onOther}
          className="mt-1.5 min-h-8 rounded-md px-1 text-[0.6875rem] font-medium text-zinc-500 transition-colors hover:text-[#000080] disabled:opacity-50 dark:text-zinc-400 dark:hover:text-[#93AAFD]"
        >
          {zh ? '都不是，我自己说' : 'None of these, let me say'}
        </button>
      )}
      {answered === '' && <p className="mt-1.5 text-[0.6875rem] text-zinc-400">{zh ? '你已经回复了' : 'You replied'}</p>}
    </div>
  );
}

/**
 * 做好的网页：一张卡片一个网页，放在回答正文上面（模型说的是「点上面的卡片」）。
 * 侧栏只有两百多像素宽（根字号 19px），标题占一整行，版本和按钮放第二行，放不下时按钮自己换行。
 * 给了 onImport 才有「导入笔记」（知识空间智能体；笔记面板里本来就在笔记里，不给）。
 */
export function ArtifactCards({ artifacts, onOpen, onImport, lang }: {
  artifacts: AgentArtifactRef[];
  onOpen: (id: string) => void;
  onImport?: (artifact: AgentArtifactRef) => void;
  lang: Lang;
}) {
  if (artifacts.length === 0) return null;
  const zh = lang === 'zh';
  return (
    <div className="mb-2.5 space-y-1.5" data-agent-artifacts>
      {artifacts.map(a => (
        <div key={a.groupId} className="flex gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(30,58,138,0.05)] dark:border-gray-800 dark:bg-gray-950">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#000080]/[0.06] text-[#000080] dark:bg-[#93AAFD]/10 dark:text-[#93AAFD]">
            <RemixIcon name="pages-line" size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[0.8125rem] font-semibold leading-5 text-zinc-900 dark:text-zinc-100">{a.title}</p>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
              <p className="min-w-0 max-w-full truncate text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
                {zh ? `网页 · 第 ${a.version} 版${a.bytes ? ` · ${formatBytes(a.bytes)}` : ''}` : `Web page · v${a.version}${a.bytes ? ` · ${formatBytes(a.bytes)}` : ''}`}
              </p>
              <div className="flex shrink-0 gap-1.5">
                {onImport && (
                  <button
                    type="button"
                    onClick={() => onImport(a)}
                    className="min-h-8 rounded-lg border border-zinc-200 px-2.5 text-[0.75rem] font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 dark:border-gray-700 dark:text-zinc-200 dark:hover:bg-gray-800"
                  >
                    {zh ? '导入笔记' : 'Import'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpen(a.id)}
                  className="min-h-8 rounded-lg bg-[#000080] px-3 text-[0.75rem] font-semibold text-white transition-all duration-200 hover:bg-[#000080]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 active:scale-[0.98] dark:bg-[#93AAFD] dark:text-gray-950"
                >
                  {zh ? '打开' : 'Open'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 回答正文下面：选项卡（网页卡片在正文上面，见 ArtifactCards） */
export function AgentDeliverables({ extras, laterUserText, choiceLabel, disabled, onChoose, onOther, lang, contentShowsQuestion }: {
  extras: AgentExtras;
  /** 这条回答之后学生说的第一句话（没有就是 null） */
  laterUserText: string | null;
  choiceLabel?: string | null;
  disabled?: boolean;
  onChoose: (question: AgentQuestion, option: AgentQuestionOption) => void;
  onOther?: () => void;
  lang: Lang;
  /** 回答正文就是问题本身：卡片上不再重复写一遍 */
  contentShowsQuestion?: boolean;
}) {
  const question = extras.question;
  return (
    <>
      {question && (
        <AgentChoiceCard
          question={question}
          answered={answeredLabel(question, laterUserText, choiceLabel)}
          disabled={disabled}
          onChoose={option => onChoose(question, option)}
          onOther={onOther}
          lang={lang}
          showQuestion={!contentShowsQuestion}
        />
      )}
    </>
  );
}

export function downloadArtifactHtml(artifact: Pick<AgentArtifactDetail, 'title' | 'version' | 'html'>): void {
  const blob = new Blob([artifact.html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = artifactFileName(artifact.title, artifact.version);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** 网页查看窗口：全屏（手机）/ 大弹窗（电脑），可切版本、下载 */
export function ArtifactViewer({ artifactId, onClose, lang }: { artifactId: string; onClose: () => void; lang: Lang }) {
  const zh = lang === 'zh';
  const [currentId, setCurrentId] = useState(artifactId);
  const [data, setData] = useState<{ artifact: AgentArtifactDetail; versions: Array<{ id: string; version: number }> } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { setCurrentId(artifactId); }, [artifactId]);
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    artifactsApi.get(currentId)
      .then(result => { if (live) setData(result); })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [currentId]);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const title = data?.artifact.title ?? (zh ? '网页' : 'Web page');
  return createPortal(
    <div
      className="fixed inset-0 z-[160] flex items-stretch justify-center bg-zinc-950/40 backdrop-blur-[2px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={close}
    >
      <div
        className="flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-white shadow-[0_20px_60px_rgba(30,58,138,0.18)] sm:h-[86vh] sm:rounded-2xl dark:bg-gray-950"
        onClick={e => e.stopPropagation()}
        data-artifact-viewer
      >
        <header className="safe-area-top border-b border-zinc-200 dark:border-gray-800">
          <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
          <RemixIcon name="pages-line" size={16} className="shrink-0 text-[#000080] dark:text-[#93AAFD]" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
          {data && data.versions.length > 1 && (
            <select
              value={currentId}
              onChange={e => setCurrentId(e.target.value)}
              aria-label={zh ? '版本' : 'Version'}
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-700 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-200"
            >
              {data.versions.map(v => <option key={v.id} value={v.id}>{zh ? `第 ${v.version} 版` : `Version ${v.version}`}</option>)}
            </select>
          )}
          {data?.artifact.viewPath && (
            // 新标签页：后端凭签名链接给这一个网页，响应头把页面关进匿名源（routes/artifacts.ts），拿不到平台的登录信息
            <a
              href={apiUrl(data.artifact.viewPath)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-gray-700 dark:text-zinc-200 dark:hover:bg-gray-900"
            >
              <RemixIcon name="external-link-line" size={14} />{zh ? '新窗口打开' : 'New tab'}
            </a>
          )}
          {data && (
            <button
              type="button"
              onClick={() => downloadArtifactHtml(data.artifact)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-gray-700 dark:text-zinc-200 dark:hover:bg-gray-900"
            >
              <RemixIcon name="download-2-line" size={14} />{zh ? '下载' : 'Download'}
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label={zh ? '关闭' : 'Close'}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-gray-900 dark:hover:text-zinc-100"
          >
            <RemixIcon name="close-line" size={18} />
          </button>
          </div>
        </header>
        <div className="relative min-h-0 flex-1 bg-zinc-50 dark:bg-gray-900">
          {data ? (
            <iframe
              key={data.artifact.id}
              title={title}
              sandbox="allow-scripts"
              srcDoc={sandboxedDocument(data.artifact.html)}
              referrerPolicy="no-referrer"
              className="h-full w-full border-0 bg-white"
            />
          ) : error ? (
            <p className="p-6 text-sm text-zinc-500">{zh ? `打不开这个网页：${error}` : `Could not open this page: ${error}`}</p>
          ) : (
            <div className="space-y-3 p-6" aria-busy="true">
              <div className="h-6 w-1/3 animate-pulse rounded-lg bg-zinc-200/80 dark:bg-gray-800" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-200/70 dark:bg-gray-800" />
              <div className="h-40 w-full animate-pulse rounded-xl bg-zinc-200/60 dark:bg-gray-800" />
            </div>
          )}
        </div>
        <footer className="safe-area-bottom border-t border-zinc-200 dark:border-gray-800">
          <p className="px-4 py-1.5 text-[0.6875rem] leading-5 text-zinc-400">
            {zh ? '网页在隔离窗口里打开，不能联网，也碰不到平台的登录和数据。内容由 AI 根据笔记生成，请核对。' : 'The page runs in an isolated frame with no network access and no access to your account. AI-generated from notes; please check it.'}
          </p>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
