import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import RemixIcon from './RemixIcon';
import CTPanel from './CTTool/CTPanel';

const CTToolPage: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white dark:bg-gray-950">
      {/* Top bar */}
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-gray-950">
        <button
          onClick={() => navigate(`/workspace/${courseId}`)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-[#000080] transition-colors"
        >
          <RemixIcon name="arrow-left-s-line" size={16} />
          <span className="hidden sm:inline">{courseId ? '返回社区' : 'Back'}</span>
        </button>
        <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <div className="flex items-center gap-2">
          <RemixIcon name="flow-chart" size={14} className="text-violet-600" />
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 tracking-tight">
            计算思维工具
          </span>
        </div>
      </header>

      {/* CT Panel fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <CTPanel
          courseId={courseId ?? ''}
          lang="zh"
          onClose={() => navigate(`/workspace/${courseId}`)}
        />
      </div>
    </div>
  );
};

export default CTToolPage;
