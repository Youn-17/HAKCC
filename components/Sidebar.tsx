import React, { useCallback, useEffect, useRef, useState } from 'react';
import { uiScale } from './uiScale';
import RemixIcon from './RemixIcon';
import { Language } from '../types';
import { RELATION_COLORS } from './relationColors';
import { useDismissible } from '../hooks/useDismissible';

interface SidebarProps {
  activeTool: string;
  onToolSelect: (id: string) => void;
  onToolOpen: (id: string) => void;
  onFileUpload?: (file: File) => void;
  onOpenAttachmentModal: () => void;
  /** 课程教职（按课内身份）才有「成员」：在这门课里只是普通成员的教师账号和学生一样看不到 */
  isStaff: boolean;
  lang: Language;
  width: number;
  onWidthChange: (w: number) => void;
  onOpenMap?: () => void;
  onOpenTimeline?: () => void;
  onOpenGroups?: () => void;
  onOpenIdeaGraph?: () => void;
  onOpenMembers?: () => void;
}

interface ToolDef {
  id: string;
  iconName: string;
  labelZh: string;
  labelEn: string;
  descZh: string;
  descEn: string;
}

// 以 16px 根字号设计的像素尺寸，按当前根字号等比放大（见 uiScale）。
const UI = uiScale();
const MIN_W = Math.round(54 * UI);
const MAX_W = Math.round(230 * UI);
const EXPAND_THRESHOLD = Math.round(100 * UI);
/**
 * 展开时的默认宽度。按语言分开：标签左边固定占 50px（内边距 + 图标 + 间距），
 * 右边还有 12px 内边距，所以够用的宽度 = 最宽标签 + 约 70px。
 * 中文最长「Build-on 网络」85px，英文最长「Build-on Network」109px ——
 * 用一个宽度迁就英文，中文那边会空出一大片。
 */
export function sidebarDefaultWidth(lang: string): number {
  return Math.round((lang === 'zh' ? 132 : 160) * UI);
}
export const SIDEBAR_MIN_W = MIN_W;
export const SIDEBAR_MAX_W = MAX_W;

const SIDEBAR_NAVY_TEXT = 'text-slate-600 dark:text-slate-300';
const SIDEBAR_ACTIVE = 'border-[#000080] bg-[#000080] text-white shadow-sm dark:border-indigo-400/30 dark:bg-indigo-400/20 dark:text-indigo-100';
const SIDEBAR_INACTIVE = `border-transparent bg-transparent ${SIDEBAR_NAVY_TEXT} hover:border-slate-200 hover:bg-white hover:text-[#000080] dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-indigo-200`;

const TOOL_DEFS: Record<string, ToolDef> = {
  note: {
    id: 'note', iconName: 'sticky-note-add-line',
    labelZh: 'Note 创建', labelEn: 'Create Note',
    descZh: '创建新的观点笔记，或在他人观点之上进行 Build-on 建构',
    descEn: 'Create an idea note, or build on an existing idea.',
  },
  drawing: {
    id: 'drawing', iconName: 'draw-line',
    labelZh: '绘图', labelEn: 'Drawing',
    descZh: '以图形表达观点的结构与关系，作为论述的补充',
    descEn: 'Express the structure and relations among ideas graphically.',
  },
  attachment: {
    id: 'attachment', iconName: 'attachment-line',
    labelZh: '附件', labelEn: 'Attachment',
    descZh: '向知识社区上传资料与佐证材料',
    descEn: 'Upload resources and supporting material to the community.',
  },
  inquiry: {
    id: 'inquiry', iconName: 'compass-3-line',
    labelZh: '探究', labelEn: 'Inquiry',
    descZh: '专题探究工具：图灵测试、计算思维等',
    descEn: 'Inquiry activities: Turing Test, computational thinking, and more.',
  },
  riseabove: {
    id: 'riseabove', iconName: 'git-merge-line',
    labelZh: '综合升华', labelEn: 'Rise Above',
    descZh: '综合多条观点，形成更具解释力的高阶理解（Rise Above）',
    descEn: 'Synthesise several ideas into a higher-order account (Rise Above).',
  },
  scaffold: {
    id: 'scaffold', iconName: 'chat-quote-line',
    labelZh: 'Scaffold', labelEn: 'Scaffolds',
    descZh: '查阅知识社区内可用的认知支架',
    descEn: 'Browse the epistemic scaffolds available in this community.',
  },
  view: {
    id: 'view', iconName: 'layout-grid-line',
    labelZh: '视图', labelEn: 'Views',
    descZh: '视图是独立的画布，用于按主题组织观点；视图卡片可放置于任意画布，互为导航入口',
    descEn: 'Views are separate canvases for organising ideas by theme; a view card can sit on any canvas as the way in.',
  },
  map: {
    id: 'map', iconName: 'mind-map',
    labelZh: 'Build-on 网络', labelEn: 'Build-on Network',
    descZh: '以关系网络呈现观点间的 Build-on 结构：谁延伸了你的观点、你建构于谁的观点之上、哪些观点尚无人回应',
    descEn: 'The Build-on structure as a network: who extended your ideas, whose ideas you built on, and which ideas remain unanswered.',
  },
  timeline: {
    id: 'timeline', iconName: 'history-line',
    labelZh: '时间线', labelEn: 'Timeline',
    descZh: '按时间顺序回溯知识社区的建构活动',
    descEn: 'Trace the community\u2019s knowledge building activity in chronological order.',
  },
  groups: {
    id: 'groups', iconName: 'group-line',
    labelZh: '小组', labelEn: 'Groups',
    descZh: '查看与管理知识社区中的小组',
    descEn: 'View and manage the groups in this community.',
  },
  ideagraph: {
    id: 'ideagraph', iconName: 'node-tree',
    labelZh: '观点图谱', labelEn: 'Idea Graph',
    descZh: '本期小组的观点分布：涌现了哪些观点、哪些问题尚未得到回应',
    descEn: 'This period\u2019s ideas across the group: what emerged, and which questions remain unanswered.',
  },
  members: {
    id: 'members', iconName: 'contacts-book-2-line',
    labelZh: '成员', labelEn: 'Members',
    descZh: '管理知识社区的成员与角色',
    descEn: 'Manage community members and their roles.',
  },
  exit: {
    id: 'exit', iconName: 'logout-box-r-line',
    labelZh: '退出', labelEn: 'Exit',
    descZh: '退出当前知识社区，返回主界面',
    descEn: 'Leave this community and return to the dashboard.',
  },
};

const CREATE_TOOLS = ['note', 'drawing', 'attachment'];
// 计算思维工具在「探究」面板里，侧栏不再单列
const BUILD_TOOLS = ['inquiry', 'riseabove', 'scaffold'];
const COMMUNITY_TOOLS = ['view', 'map', 'timeline', 'ideagraph', 'groups', 'members'];
const OPEN_TOOLS = new Set(['note', 'drawing', 'attachment', 'inquiry', 'riseabove', 'scaffold', 'exit', 'view', 'map', 'timeline', 'ideagraph', 'groups', 'members']);

const RELATION_ITEMS = [
  { key: 'extend',    zh: '延伸',  en: 'Extend' },
  { key: 'clarify',   zh: '澄清',  en: 'Clarify' },
  { key: 'question',  zh: '提问',  en: 'Question' },
  { key: 'challenge', zh: '质疑',  en: 'Challenge' },
  { key: 'evidence',  zh: '证据',  en: 'Evidence' },
  { key: 'synthesize',zh: '综合',  en: 'Synthesize' },
];

const LINE_ITEMS: { zh: string; en: string; w: number; dash: string; opacity: number }[] = [
  { zh: '人工创建', en: 'Human',        w: 2,   dash: 'none', opacity: 1 },
  { zh: 'AI 建议',  en: 'AI Suggested',  w: 1.5, dash: '4 3',  opacity: 0.7 },
  { zh: 'AI 采纳',  en: 'AI Accepted',   w: 3,   dash: '6 3',  opacity: 1 },
];

const BADGE_ITEMS = [
  { zh: '已有 Build-on', en: 'Built on',       borderColor: '#34d399', bgColor: '#ecfdf5' },
  { zh: '有潜力',        en: 'Promising',      borderColor: '#38bdf8', bgColor: '#f0f9ff' },
  { zh: '权威',          en: 'Authoritative',   borderColor: '#fbbf24', bgColor: '#fffbeb' },
];

const Sidebar: React.FC<SidebarProps> = ({
  activeTool, onToolSelect, onToolOpen, onOpenAttachmentModal,
  isStaff, lang, width, onWidthChange,
  onOpenMap, onOpenTimeline, onOpenGroups, onOpenMembers, onOpenIdeaGraph,
}) => {
  const lbl = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const expanded = width >= EXPAND_THRESHOLD;

  const [tooltip, setTooltip] = useState<{ label: string; desc?: string; top: number; left: number } | null>(null);
  const showTooltip = useCallback((e: React.MouseEvent | React.FocusEvent, label: string, desc?: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ label, desc, top: rect.top + rect.height / 2, left: rect.right + 12 });
  }, []);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  // 悬停提示按坐标定位，页面一滚它就悬在错的地方，所以滚动也要收掉
  useDismissible({ open: !!tooltip, onDismiss: hideTooltip, dismissOnScroll: true });

  const dragRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = true;
    startXRef.current = e.clientX;
    startWRef.current = width;
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientX - startXRef.current;
      const next = Math.min(MAX_W, Math.max(MIN_W, startWRef.current + delta));
      onWidthChange(next);
    };
    const onUp = () => { dragRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onWidthChange]);

  const communityHandlers: Record<string, (() => void) | undefined> = {
    map: onOpenMap, timeline: onOpenTimeline, ideagraph: onOpenIdeaGraph, groups: onOpenGroups, members: onOpenMembers,
  };

  const handleClick = (id: string) => {
    hideTooltip();
    if (id === 'attachment') { onToolOpen(id); onOpenAttachmentModal(); return; }
    if (communityHandlers[id]) { communityHandlers[id]!(); return; }
    if (OPEN_TOOLS.has(id)) { onToolOpen(id); return; }
    onToolSelect(id);
  };

  const renderToolButton = (id: string) => {
    const def = TOOL_DEFS[id];
    if (!def) return null;
    const isActive = activeTool === id;

    return (
      <div key={id} className="flex w-full shrink-0 justify-center">
        <button
          type="button"
          onClick={() => handleClick(id)}
          onMouseEnter={!expanded ? (e) => showTooltip(e, lbl(def.labelZh, def.labelEn), lbl(def.descZh, def.descEn)) : undefined}
          onMouseLeave={!expanded ? hideTooltip : undefined}
          onFocus={!expanded ? (e) => showTooltip(e, lbl(def.labelZh, def.labelEn), lbl(def.descZh, def.descEn)) : undefined}
          onBlur={hideTooltip}
          className={`relative flex min-h-[38px] shrink-0 cursor-pointer items-center justify-center rounded-xl border transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${
            isActive ? SIDEBAR_ACTIVE : SIDEBAR_INACTIVE
          } ${expanded ? 'w-full gap-2 px-2.5' : 'w-11'}`}
          aria-label={lbl(def.labelZh, def.labelEn)}
          aria-describedby={tooltip?.label === lbl(def.labelZh, def.labelEn) && !expanded ? 'workspace-tool-tooltip' : undefined}
          title={expanded ? lbl(def.descZh, def.descEn) : undefined}
        >
          <RemixIcon name={def.iconName} size={20} className="shrink-0" />
          {expanded && <span className="text-xs font-medium flex-1 text-left leading-tight">{lbl(def.labelZh, def.labelEn)}</span>}
        </button>
      </div>
    );
  };

  const Separator = () => <div className="my-1 h-px shrink-0 bg-slate-200 dark:bg-slate-700" style={{ width: expanded ? '100%' : 30 }} />;
  const SectionLabel: React.FC<{ text: string }> = ({ text }) => (
    <span className="shrink-0 max-w-full truncate text-[0.625rem] tracking-wide text-slate-500 dark:text-slate-400 font-medium select-none" style={{ fontVariant: 'small-caps' }}>{text}</span>
  );

  return (
    <aside
      className="shrink-0 border-r border-gray-200 dark:border-gray-800 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-xl py-2.5 select-none overflow-visible relative z-20"
      style={{ width, flexBasis: width, minWidth: MIN_W }}
    >
      <div className="flex h-full flex-col items-center" style={{ padding: expanded ? '0 8px' : '0 3px' }}>
        <div className="flex flex-1 flex-col items-center gap-0.5 min-h-0 overflow-y-auto py-1 w-full sidebar-scroll">
          <SectionLabel text={lbl('创建', 'create')} />
          {CREATE_TOOLS.map(renderToolButton)}
          <Separator />
          <SectionLabel text={lbl('建构', 'build')} />
          {BUILD_TOOLS.map(renderToolButton)}
          <Separator />
          <SectionLabel text={lbl('社区', 'community')} />
          {COMMUNITY_TOOLS
            .filter(id => id !== 'members' || isStaff)
            .map(renderToolButton)}
          <Separator />
          <SectionLabel text={lbl('图例', 'legend')} />

          {/* ── Legend: compact (dots + group-hover tooltips) ── */}
          {!expanded && (
            <div className="flex flex-col items-center gap-1.5">
              <div className="grid grid-cols-2 gap-[5px]" style={{ width: 36 }}>
                {RELATION_ITEMS.map(r => (
                  <div key={r.key} className="flex justify-center">
                    <div
                      className="w-[14px] h-[14px] rounded-sm cursor-default transition-transform hover:scale-125"
                      style={{ backgroundColor: RELATION_COLORS[r.key] }}
                      onMouseEnter={(e) => showTooltip(e, lbl(r.zh, r.en))}
                      onMouseLeave={hideTooltip}
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-[4px]" style={{ width: 36 }}>
                {BADGE_ITEMS.map((b, i) => (
                  <div key={i} className="flex justify-center">
                    <div
                      className="w-[9px] h-[9px] rounded-sm border-[1.5px] cursor-default transition-transform hover:scale-125"
                      style={{ borderColor: b.borderColor, backgroundColor: b.bgColor }}
                      onMouseEnter={(e) => showTooltip(e, lbl(b.zh, b.en))}
                      onMouseLeave={hideTooltip}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Legend: expanded (full labels) ── */}
          {expanded && (
            <div className="w-full px-1 space-y-1.5">
              {RELATION_ITEMS.map(r => (
                <div key={r.key} className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <div className="w-4 h-[2px]" style={{ backgroundColor: RELATION_COLORS[r.key] }} />
                    <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[4px] border-t-transparent border-b-transparent" style={{ borderLeftColor: RELATION_COLORS[r.key] }} />
                  </div>
                  <span className="text-[0.6875rem] text-gray-600 leading-tight">{lbl(r.zh, r.en)}</span>
                </div>
              ))}
              <div className="h-px bg-gray-300 dark:bg-gray-700 my-1" />
              <SectionLabel text={lbl('线型', 'lines')} />
              {LINE_ITEMS.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <svg width="20" height="8" className="flex-shrink-0">
                    <line x1="0" y1="4" x2="20" y2="4" stroke="#64748b"
                      strokeWidth={l.w}
                      strokeDasharray={l.dash}
                      strokeOpacity={l.opacity}
                    />
                  </svg>
                  <span className="text-[0.6875rem] text-gray-500 leading-tight">{lbl(l.zh, l.en)}</span>
                </div>
              ))}
              <div className="h-px bg-gray-300 dark:bg-gray-700 my-1" />
              <SectionLabel text={lbl('标记', 'badges')} />
              {BADGE_ITEMS.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm border-2 flex-shrink-0" style={{ borderColor: b.borderColor, backgroundColor: b.bgColor }} />
                  <span className="text-[0.6875rem] text-gray-600 leading-tight">{lbl(b.zh, b.en)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-2 w-full">
          {renderToolButton('exit')}
        </div>
      </div>

      {/* Fixed-position tooltip (outside scroll container to avoid clipping) */}
      {tooltip && !expanded && (
        <div
          id="workspace-tool-tooltip"
          role="tooltip"
          className="fixed z-[120] pointer-events-none"
          style={{ top: tooltip.top, left: tooltip.left, transform: 'translateY(-50%)' }}
        >
          <div className="relative rounded-xl bg-slate-900/96 px-3 py-2 text-xs text-white shadow-2xl w-64">
            <div className="absolute -left-[7px] top-1/2 -translate-y-1/2 border-y-[6px] border-r-[7px] border-y-transparent border-r-slate-900/96" />
            <div className="mb-0.5 font-semibold text-[#DDE6FF]">{tooltip.label}</div>
            {tooltip.desc && <div className="text-[0.6875rem] leading-5 text-slate-300">{tooltip.desc}</div>}
          </div>
        </div>
      )}

      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize z-30 group/handle"
        onMouseDown={onResizeStart}
      >
        <div className="absolute top-1/2 -translate-y-1/2 right-0 w-[3px] h-8 rounded-full bg-gray-400/0 group-hover/handle:bg-gray-400/40 transition-colors" />
      </div>
    </aside>
  );
};

export default Sidebar;
