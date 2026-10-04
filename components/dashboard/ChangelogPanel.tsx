import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import RemixIcon from '../RemixIcon';
import { changelogFor, latestVersionFor, type ChangelogAudience } from './changelog';

/**
 * 更新日志。
 *
 * 放在侧栏底部一行，不占概览的主内容区 —— 平时它只是一行小字，
 * 有没读过的新版本时旁边点一个圆点。看过就不再提示。
 */

const SEEN_KEY = 'hakcc-changelog-seen';

function readSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

/** 平台角色 → 日志受众。管理员按教师看。 */
export function changelogAudienceFor(role: string | undefined): ChangelogAudience {
  return role === 'student' ? 'student' : 'teacher';
}

/** 有没有还没看过的版本。读不到存储（隐私模式）就当没有，别一直闪。 */
export function useUnseenRelease(audience: ChangelogAudience): [boolean, () => void] {
  const [unseen, setUnseen] = useState(false);
  const latest = latestVersionFor(audience);

  useEffect(() => {
    const seen = readSeen();
    setUnseen(seen !== null && seen !== latest);
    // 第一次用的人不该被「更新提示」迎面砸中，直接记成已读
    if (seen === null) {
      try { localStorage.setItem(SEEN_KEY, latest); } catch { /* 忽略 */ }
    }
  }, [latest]);

  const markSeen = () => {
    try { localStorage.setItem(SEEN_KEY, latest); } catch { /* 忽略 */ }
    setUnseen(false);
  };

  return [unseen, markSeen];
}

interface Props {
  lang: 'zh' | 'en';
  audience: ChangelogAudience;
  onClose: () => void;
}

const ChangelogPanel: React.FC<Props> = ({ lang, audience, onClose }) => {
  const zh = lang === 'zh';
  const entries = changelogFor(audience);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /*
    必须 portal 到 body。面板本来渲染在侧栏内部，而主内容区 gsap-dashboard-main
    被 GSAP 设了 transform，自成一个层叠上下文 —— 面板的 z-50 只在侧栏那棵子树里
    有意义，主内容里的元素（比如概览那个环形图）照样画在它上面，遮罩根本盖不住。
    上一轮我误判成模糊强度不够，加大模糊没有用，因为问题不在模糊。
  */
  return createPortal(
    <div className="fixed inset-0 z-[200] flex justify-end">
      {/*
        2px 模糊对文字够用，对大面积纯色和渐变几乎无效 —— 概览页那个环形图
        是整页对比度最强的元素，弱遮罩下反而更抢眼。加大模糊、加深压暗，
        再降一档饱和度，让背景整体退到后面去。
      */}
      <div
        className="absolute inset-0 bg-gray-950/45 backdrop-blur-md backdrop-saturate-[0.6]"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-label={zh ? '更新日志' : 'Changelog'}
        className="relative flex h-full w-full max-w-[26rem] flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-5 dark:border-gray-800">
          <div>
            <h2 className="text-base font-bold tracking-tight text-gray-900 dark:text-gray-100">
              {zh ? '更新日志' : "What's new"}
            </h2>
            <p className="mt-0.5 text-[0.6875rem] text-gray-500 dark:text-gray-400">
              {zh ? '平台从上线到现在的变化' : 'How the platform has changed since launch'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            aria-label={zh ? '关闭' : 'Close'}
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ol className="space-y-7">
            {entries.map((entry, i) => (
              <li key={entry.version} className="relative pl-5">
                {/* 时间轴：一条竖线串起所有版本，最后一条不再往下画 */}
                <span
                  className={`absolute left-[3px] top-2 w-px bg-gray-200 dark:bg-gray-800 ${
                    i === entries.length - 1 ? 'h-0' : 'h-[calc(100%+1.75rem)]'
                  }`}
                />
                <span
                  className={`absolute left-0 top-1.5 h-[7px] w-[7px] rounded-full ${
                    i === 0 ? 'bg-[#000080] dark:bg-blue-400' : 'bg-gray-300 dark:bg-gray-700'
                  }`}
                />

                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[0.8125rem] font-bold tracking-tight text-gray-900 dark:text-gray-100">
                    {entry.version}
                  </span>
                  <span className="text-[0.6875rem] text-gray-400">{entry.date}</span>
                  {i === 0 && (
                    <span className="rounded-full bg-[#000080]/[0.08] px-2 py-0.5 text-[0.625rem] font-semibold text-[#000080] dark:bg-blue-950/50 dark:text-blue-300">
                      {zh ? '最新' : 'Latest'}
                    </span>
                  )}
                </div>

                <p className="mt-0.5 text-[0.8125rem] font-semibold text-gray-800 dark:text-gray-200">
                  {zh ? entry.titleZh : entry.titleEn}
                </p>

                <ul className="mt-2 space-y-1.5">
                  {entry.items.map((item, j) => (
                    <li key={j} className="flex gap-2 text-[0.75rem] leading-6 text-gray-600 dark:text-gray-400">
                      <span className="mt-[9px] h-[3px] w-[3px] shrink-0 rounded-full bg-gray-300 dark:bg-gray-600" />
                      <span>{zh ? item.zh : item.en}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>,
    document.body,
  );
};

/** 侧栏底部那一行入口。 */
export const ChangelogTrigger: React.FC<{ lang: 'zh' | 'en'; audience: ChangelogAudience; unseen: boolean; onClick: () => void }> = ({
  lang, audience, unseen, onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="mb-1 flex w-full items-center gap-1 rounded-lg px-1.5 py-1.5 text-[0.6875rem] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-900 dark:hover:text-gray-300"
    title={lang === 'zh' ? '查看更新日志' : 'View changelog'}
  >
    <RemixIcon name="sparkling-line" size={13} className="flex-shrink-0" />
    <span className="truncate">{latestVersionFor(audience)} · {lang === 'zh' ? '更新日志' : "What's new"}</span>
    {unseen && <span className="ml-auto h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#000080] dark:bg-blue-400" />}
  </button>
);

export default ChangelogPanel;
