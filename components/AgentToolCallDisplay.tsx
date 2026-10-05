import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import RemixIcon from './RemixIcon';

export interface ToolCallInfo {
  name: string;
  status: 'running' | 'done' | 'error';
  args?: string;
  result?: string;
  duration?: number;
}

export interface AgentToolCallDisplayProps {
  tools: ToolCallInfo[];
  lang: 'en' | 'zh';
  compact?: boolean;
}

export const TOOL_META: Record<string, { icon: string; zh: string; en: string }> = {
  search_notes: { icon: 'search-line', zh: '搜索相关笔记', en: 'Search related notes' },
  read_note: { icon: 'file-text-line', zh: '读取笔记内容', en: 'Read note content' },
  get_note_context: { icon: 'node-tree', zh: '查看 Build-on 关系', en: 'Look up Build-on links' },
  analyze_argument: { icon: 'mind-map', zh: '分析论证结构', en: 'Analyze argument structure' },
  compare_notes: { icon: 'git-merge-line', zh: '对比笔记内容', en: 'Compare notes' },
  web_search: { icon: 'global-line', zh: '网络搜索', en: 'Web search' },
  find_sources: { icon: 'book-open-line', zh: '查找学术来源', en: 'Find academic sources' },
  lesson_scaffold: { icon: 'stack-line', zh: '生成课程脚手架', en: 'Generate lesson scaffold' },
  class_analytics: { icon: 'bar-chart-grouped-line', zh: '课堂数据分析', en: 'Class analytics' },
  suggest_triggers: { icon: 'lightbulb-line', zh: '建议触发策略', en: 'Suggest trigger strategies' },
  list_note_discussions: { icon: 'discuss-line', zh: '列出讨论记录', en: 'List discussions' },
  get_workspace_summary: { icon: 'layout-3-line', zh: '获取工作区摘要', en: 'Get workspace summary' },
  get_personal_history: { icon: 'history-line', zh: '获取学习历史', en: 'Get learning history' },
  generate_summary_doc: { icon: 'file-chart-line', zh: '生成学情分析报告', en: 'Generate analytics report' },
  export_notes: { icon: 'download-line', zh: '导出笔记', en: 'Export notes' },
  analyze_engagement: { icon: 'line-chart-line', zh: '分析学习参与度', en: 'Analyze engagement' },
  compare_periods: { icon: 'time-line', zh: '对比时间段数据', en: 'Compare time periods' },
  save_reflection: { icon: 'quill-pen-line', zh: '保存教学反思', en: 'Save reflection' },
  detect_triggers: { icon: 'radar-line', zh: '检测触发信号', en: 'Detect triggers' },
  build_embeddings: { icon: 'database-2-line', zh: '构建语义索引', en: 'Build embeddings' },
  get_learner_insights: { icon: 'user-search-line', zh: '获取学生洞察', en: 'Get learner insights' },
  save_teaching_insight: { icon: 'save-line', zh: '保存教学洞察', en: 'Save teaching insight' },
  generate_image: { icon: 'image-ai-line', zh: '生成配图', en: 'Generate image' },
  search_course_materials: { icon: 'book-2-line', zh: '检索课程材料', en: 'Search course materials' },
  // 笔记页「自由提问」那条路：联网搜索、回答前先找相关内容
  tavily_search: { icon: 'global-line', zh: '联网搜索', en: 'Web search' },
  prepare_context: { icon: 'search-eye-line', zh: '查找相关内容', en: 'Look for related material' },
  search_space_notes: { icon: 'search-line', zh: '搜索空间里的笔记', en: 'Search notes in this space' },
  list_related_notes: { icon: 'links-line', zh: '找相关的笔记', en: 'Find related notes' },
};

const PIPELINE_STEPS = {
  zh: [
    { icon: 'search-eye-line', title: '解析请求', desc: '识别意图与参数' },
    { icon: 'settings-4-line', title: '调用工具', desc: '' },
    { icon: 'bar-chart-box-line', title: '处理结果', desc: '汇总分析结果' },
    { icon: 'send-plane-line', title: '返回结果', desc: '结果已生成' },
  ],
  en: [
    { icon: 'search-eye-line', title: 'Parse request', desc: 'Identify intent & params' },
    { icon: 'settings-4-line', title: 'Call tools', desc: '' },
    { icon: 'bar-chart-box-line', title: 'Process results', desc: 'Aggregate analysis' },
    { icon: 'send-plane-line', title: 'Return results', desc: 'Results ready' },
  ],
} as const;

function formatArgs(argsJson: string): string[] {
  try {
    const parsed = JSON.parse(argsJson);
    if (typeof parsed !== 'object' || parsed === null) return [];
    return Object.entries(parsed).map(
      ([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`,
    );
  } catch {
    return [];
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ToolCard({ tool, lang }: { tool: ToolCallInfo; lang: 'zh' | 'en' }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[tool.name];
  const icon = meta?.icon ?? 'tools-line';
  const desc = meta ? meta[lang] : tool.name;
  const argLines = tool.args ? formatArgs(tool.args) : [];
  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';

  return (
    <div className="rounded-xl border border-zinc-200 bg-white transition-shadow hover:shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
          isRunning ? 'bg-blue-50 dark:bg-blue-900/20' :
          isError ? 'bg-red-50 dark:bg-red-900/20' :
          'bg-emerald-50 dark:bg-emerald-900/20'
        }`}>
          {isRunning ? (
            <Loader2 size={14} className="animate-spin text-blue-500 dark:text-blue-400" />
          ) : isError ? (
            <RemixIcon name="error-warning-fill" size={14} className="text-red-500 dark:text-red-400" />
          ) : (
            <RemixIcon name="checkbox-circle-fill" size={14} className="text-emerald-500 dark:text-emerald-400" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-semibold text-zinc-800 dark:text-zinc-200">{tool.name}</span>
          <span className="block text-[0.6875rem] text-zinc-400 dark:text-zinc-500">{desc}</span>
        </span>
        <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium ${
          isRunning ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
          isError ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
          'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
        }`}>
          {isRunning ? (lang === 'zh' ? '运行中' : 'Running') :
           isError ? (lang === 'zh' ? '错误' : 'Error') :
           (lang === 'zh' ? '已完成' : 'Done')}
        </span>
        {tool.duration !== undefined && (
          <span className="flex-shrink-0 text-[0.6875rem] tabular-nums text-zinc-400 dark:text-zinc-500">
            {formatDuration(tool.duration)}
          </span>
        )}
        <span className="flex-shrink-0 text-zinc-300 dark:text-zinc-600">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (argLines.length > 0 || tool.result) && (
        <div className="border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
          {argLines.length > 0 && (
            <div className="space-y-0.5">
              {argLines.map((line, i) => (
                <p key={i} className="truncate font-mono text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{line}</p>
              ))}
            </div>
          )}
          {tool.result && (
            <p className="mt-1 truncate text-[0.6875rem] italic text-zinc-500 dark:text-zinc-400">&rarr; {tool.result}</p>
          )}
        </div>
      )}
    </div>
  );
}

function PipelineView({ tools, lang }: { tools: ToolCallInfo[]; lang: 'zh' | 'en' }) {
  const steps = PIPELINE_STEPS[lang];
  const allDone = tools.every(t => t.status === 'done');
  const anyRunning = tools.some(t => t.status === 'running');
  const toolChain = tools.map(t => t.name).join(' → ');

  const stepStatus = (idx: number): 'done' | 'running' | 'pending' => {
    if (allDone) return 'done';
    if (idx === 0) return 'done';
    if (idx === 1) return anyRunning ? 'running' : 'done';
    if (idx === 2) return anyRunning ? 'pending' : allDone ? 'done' : 'running';
    return allDone ? 'done' : 'pending';
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <RemixIcon name="git-branch-line" size={15} className="text-[#000080] dark:text-[#93AAFD]" />
          <span className="text-[0.8125rem] font-semibold text-zinc-800 dark:text-zinc-200">
            {lang === 'zh' ? '工具调用流程' : 'Tool Pipeline'}
          </span>
        </div>
        <span className={`flex items-center gap-1 text-[0.6875rem] font-medium ${
          allDone ? 'text-emerald-600 dark:text-emerald-400' :
          'text-blue-500 dark:text-blue-400'
        }`}>
          {allDone ? (
            <><RemixIcon name="checkbox-circle-fill" size={12} /> {lang === 'zh' ? '全部完成' : 'All done'}</>
          ) : (
            <><Loader2 size={12} className="animate-spin" /> {lang === 'zh' ? '执行中' : 'Running'}</>
          )}
        </span>
      </div>

      <div className="px-4 pb-4">
        <div className="relative">
          {steps.map((step, i) => {
            const st = stepStatus(i);
            const isLast = i === steps.length - 1;
            const desc = i === 1 ? toolChain : step.desc;

            return (
              <div key={i} className="relative flex gap-3 pb-1">
                {!isLast && (
                  <div className="absolute left-[15px] top-[32px] h-[calc(100%-16px)] w-px border-l border-dashed border-zinc-200 dark:border-zinc-700" />
                )}
                <div className="relative z-10 flex flex-col items-center">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    st === 'done' ? 'bg-[#000080]/[0.08] dark:bg-[#4169E1]/[0.15]' :
                    st === 'running' ? 'bg-blue-50 dark:bg-blue-900/20' :
                    'bg-zinc-100 dark:bg-zinc-800'
                  }`}>
                    <RemixIcon name={step.icon} size={15} className={
                      st === 'done' ? 'text-[#000080] dark:text-[#93AAFD]' :
                      st === 'running' ? 'text-blue-500 dark:text-blue-400' :
                      'text-zinc-400 dark:text-zinc-500'
                    } />
                  </span>
                  {st === 'done' && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white dark:bg-zinc-900">
                      <RemixIcon name="checkbox-circle-fill" size={12} className="text-emerald-500" />
                    </span>
                  )}
                </div>
                <div className="flex flex-1 items-center justify-between pb-4 pt-1">
                  <div>
                    <span className="block text-[0.8125rem] font-semibold text-zinc-800 dark:text-zinc-200">{step.title}</span>
                    <span className="block text-[0.6875rem] text-zinc-400 dark:text-zinc-500">{desc}</span>
                  </div>
                  <span className={`flex-shrink-0 text-[0.6875rem] font-medium ${
                    st === 'done' ? 'text-emerald-500' :
                    st === 'running' ? 'text-blue-500' :
                    'text-zinc-300 dark:text-zinc-600'
                  }`}>
                    {st === 'done' ? (
                      <span className="flex items-center gap-1">
                        {lang === 'zh' ? '已完成' : 'Done'} <RemixIcon name="checkbox-circle-line" size={12} />
                      </span>
                    ) : st === 'running' ? (
                      <span className="flex items-center gap-1">
                        <Loader2 size={11} className="animate-spin" />
                        {lang === 'zh' ? '执行中' : 'Running'}
                      </span>
                    ) : (
                      lang === 'zh' ? '等待中' : 'Pending'
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function AgentToolCallDisplay({
  tools,
  lang,
  compact = false,
}: AgentToolCallDisplayProps) {
  if (tools.length === 0) return null;

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {tools.map((tool, i) => {
          const meta = TOOL_META[tool.name];
          const icon = meta?.icon ?? 'tools-line';
          const isRunning = tool.status === 'running';
          return (
            <span
              key={`${tool.name}-${i}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium ${
                isRunning
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                  : tool.status === 'error'
                  ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
              }`}
            >
              {isRunning ? (
                <Loader2 size={10} className="animate-spin" />
              ) : tool.status === 'error' ? (
                <RemixIcon name="error-warning-fill" size={10} />
              ) : (
                <RemixIcon name="checkbox-circle-fill" size={10} />
              )}
              <RemixIcon name={icon} size={10} />
              {/* 用本地化标签而不是 search_notes 这种技术标识符 —— 学生看不懂后者 */}
              {meta ? (lang === 'zh' ? meta.zh : meta.en) : tool.name}
              {/* 结果摘要直接显示，不藏在展开态里：等待期间界面上要有东西在动，
                  「搜索相关笔记 → 找到 12 条」比一个对勾有用得多 */}
              {tool.status === 'done' && tool.result && (
                <span className="opacity-70">&rarr; {tool.result}</span>
              )}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tools.map((tool, i) => (
        <ToolCard key={`${tool.name}-${i}`} tool={tool} lang={lang === 'zh' ? 'zh' : 'en'} />
      ))}
      <PipelineView tools={tools} lang={lang === 'zh' ? 'zh' : 'en'} />
    </div>
  );
}
