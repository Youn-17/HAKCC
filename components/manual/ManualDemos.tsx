import React from 'react';

type DemoProps = { label: string; lang?: 'zh' | 'en' };

/**
 * 手册里的操作演示。
 *
 * 这些是手画的 SVG 动画，不是屏幕录像。这么做有几个实际理由：
 * 界面改版后录像立刻过时，而示意图画的是动作本身，不跟着改；
 * 一个 GIF 动辄几兆，这里每个两三 KB；深浅色主题各自成立，录像做不到。
 *
 * 代价是它不长得跟真实界面一模一样。所以每个演示旁边都配了真实截图，
 * 演示讲「怎么动」，截图讲「长什么样」。
 *
 * 所有动画都尊重 prefers-reduced-motion：关掉动效的人看到的是终态静图，
 * 而不是空白 —— 信息不能只存在于动画里。
 */

const PALETTE = {
  ink: 'var(--demo-ink)',
  muted: 'var(--demo-muted)',
  line: 'var(--demo-line)',
  card: 'var(--demo-card)',
  brand: 'var(--demo-brand)',
  accent: 'var(--demo-accent)',
};

/** 主题变量与动画关键帧。整个手册里只注入一次。 */
export const DemoStyles: React.FC = () => (
  <style>{`
    .hakcc-demo {
      --demo-ink: #18181b;
      --demo-muted: #a1a1aa;
      --demo-line: #d4d4d8;
      --demo-card: #ffffff;
      --demo-brand: #435f78;
      --demo-accent: #607e96;
      --demo-ground: #fafafa;
    }
    .dark .hakcc-demo {
      --demo-ink: #e4e4e7;
      --demo-muted: #71717a;
      --demo-line: #3f3f46;
      --demo-card: #18181b;
      --demo-brand: #afc8dc;
      --demo-accent: #89abc4;
      --demo-ground: #0c0c0e;
    }

    @keyframes hakcc-cursor-buildon {
      0%, 8%    { transform: translate(150px, 118px); }
      18%, 26%  { transform: translate(74px, 46px); }
      42%       { transform: translate(196px, 100px); }
      60%, 100% { transform: translate(196px, 100px); }
    }
    @keyframes hakcc-click {
      0%, 15%   { opacity: 0; transform: scale(0.3); }
      20%       { opacity: 0.85; transform: scale(1); }
      30%, 100% { opacity: 0; transform: scale(1.6); }
    }
    @keyframes hakcc-select {
      0%, 17%   { stroke-opacity: 0; }
      22%, 100% { stroke-opacity: 1; }
    }
    @keyframes hakcc-appear {
      0%, 44%   { opacity: 0; transform: translateY(6px); }
      56%, 100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes hakcc-draw {
      0%, 58%   { stroke-dashoffset: 150; }
      76%, 100% { stroke-dashoffset: 0; }
    }
    @keyframes hakcc-fade-in {
      0%, 72%   { opacity: 0; }
      84%, 100% { opacity: 1; }
    }

    @keyframes hakcc-scaffold-click {
      0%, 12%   { opacity: 0; transform: scale(0.3); }
      18%       { opacity: 0.85; transform: scale(1); }
      28%, 100% { opacity: 0; transform: scale(1.6); }
    }
    @keyframes hakcc-chip-lift {
      0%, 14%   { transform: translate(0,0); opacity: 1; }
      38%       { transform: translate(96px, 28px); opacity: 0.35; }
      40%, 100% { opacity: 0; }
    }
    @keyframes hakcc-token-in {
      0%, 38%   { opacity: 0; }
      48%, 100% { opacity: 1; }
    }
    @keyframes hakcc-caret {
      0%, 50%   { opacity: 0; }
      55%, 100% { opacity: 1; }
    }
    @keyframes hakcc-typed {
      0%, 60%   { transform: scaleX(0); }
      92%, 100% { transform: scaleX(1); }
    }

    @keyframes hakcc-merge-select {
      0%, 12%   { stroke-opacity: 0; }
      22%, 100% { stroke-opacity: 1; }
    }
    @keyframes hakcc-merge-pull {
      0%, 34%   { opacity: 0; stroke-dashoffset: 90; }
      50%, 100% { opacity: 1; stroke-dashoffset: 0; }
    }
    @keyframes hakcc-merge-rise {
      0%, 54%   { opacity: 0; transform: translateY(14px) scale(0.94); }
      70%, 100% { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes hakcc-pan {
      0%, 10%   { transform: translate(0,0); }
      35%, 48%  { transform: translate(-26px, -14px); }
      70%, 100% { transform: translate(-26px, -14px) scale(1.18); }
    }
    @keyframes hakcc-cursor-pan {
      0%, 10%   { transform: translate(120px, 84px); }
      35%, 55%  { transform: translate(94px, 70px); }
      70%, 100% { transform: translate(94px, 70px); }
    }

    [data-demo-playing="false"] .hakcc-demo * { animation-play-state: paused !important; }
    /* 关掉动效的人看终态，不是空白。信息不能只活在动画里。 */
    @media (prefers-reduced-motion: reduce) {
      .hakcc-demo * {
        animation: none !important;
        opacity: 1 !important;
        stroke-opacity: 1 !important;
        stroke-dashoffset: 0 !important;
      }
      .hakcc-demo .hakcc-cursor,
      .hakcc-demo .hakcc-ripple,
      .hakcc-demo .hakcc-transient { display: none; }
      .hakcc-demo .hakcc-typed { transform: scaleX(1) !important; }
    }
  `}</style>
);

const frame = (children: React.ReactNode, label: string) => (
  <svg viewBox="0 0 300 170" role="img" aria-label={label}
    className="hakcc-demo h-auto w-full">
    <rect x="0" y="0" width="300" height="170" rx="10" fill="var(--demo-ground)" stroke={PALETTE.line} />
    {children}
  </svg>
);

const Cursor: React.FC<{ animation: string }> = ({ animation }) => (
  <g className="hakcc-cursor" style={{ animation }}>
    <path d="M0 0 L0 13 L3.4 9.8 L5.8 14.6 L8 13.5 L5.6 8.9 L10 8.6 Z"
      fill={PALETTE.ink} stroke="var(--demo-card)" strokeWidth="0.8" />
  </g>
);

const noteCard = (x: number, y: number, w = 62, h = 34, opts: {
  bar?: string; title?: string; muted?: boolean;
} = {}) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx="4"
      fill={PALETTE.card} stroke={PALETTE.line} strokeWidth="1" />
    {opts.bar && <rect x={x} y={y} width={w} height="2.5" rx="1.2" fill={opts.bar} />}
    <rect x={x + 6} y={y + 10} width={w - 20} height="2.6" rx="1.3" fill={PALETTE.muted} opacity="0.75" />
    <rect x={x + 6} y={y + 17} width={w - 12} height="2.2" rx="1.1" fill={PALETTE.muted} opacity="0.45" />
    <rect x={x + 6} y={y + 23} width={w - 26} height="2.2" rx="1.1" fill={PALETTE.muted} opacity="0.45" />
  </g>
);

/** Build-on：选中一条 → 新建 → 连线自动出现。这门课最核心的动作。 */
export const BuildOnDemo: React.FC<DemoProps> = ({ label, lang = 'zh' }) => frame(
  <>
    {noteCard(40, 30, 68, 38, { bar: PALETTE.accent })}
    <rect x="38" y="28" width="72" height="42" rx="6" fill="none"
      stroke={PALETTE.brand} strokeWidth="2"
      style={{ animation: 'hakcc-select 6s ease-in-out infinite' }} />

    <circle className="hakcc-ripple" cx="74" cy="49" r="10" fill={PALETTE.brand}
      style={{ animation: 'hakcc-click 6s ease-in-out infinite', transformOrigin: '74px 49px' }} />

    <path d="M110 52 C 145 52, 150 108, 182 112" fill="none"
      stroke={PALETTE.brand} strokeWidth="2" strokeDasharray="150"
      style={{ animation: 'hakcc-draw 6s ease-in-out infinite' }} />

    <g style={{ animation: 'hakcc-appear 6s ease-in-out infinite' }}>
      {noteCard(182, 94, 68, 38, { bar: PALETTE.brand })}
    </g>

    <g style={{ animation: 'hakcc-fade-in 6s ease-in-out infinite' }}>
      <rect x="126" y="66" width="34" height="13" rx="6.5" fill={PALETTE.brand} opacity="0.12" />
      <text x="143" y="75.5" textAnchor="middle" fontSize="8" fill={PALETTE.brand} fontWeight="600">{lang === 'zh' ? '延伸' : 'Extend'}</text>
    </g>

    <Cursor animation="hakcc-cursor-buildon 6s ease-in-out infinite" />
  </>,
  label,
);

/** 支架：点一下半句话，它插进正文，光标停在方括号里。 */
export const ScaffoldDemo: React.FC<DemoProps> = ({ label, lang = 'zh' }) => frame(
  <>
    <rect x="14" y="20" width="74" height="130" rx="6" fill={PALETTE.card} stroke={PALETTE.line} />
    <text x="22" y="34" fontSize="8" fill={PALETTE.muted} fontWeight="600">{lang === 'zh' ? '支架' : 'Scaffolds'}</text>
    {[46, 66, 86].map((y, i) => (
      <g key={y}>
        <rect x="22" y={y} width="58" height="14" rx="7"
          fill={i === 0 ? PALETTE.brand : PALETTE.line} opacity={i === 0 ? 0.14 : 0.5} />
        <rect x="29" y={y + 6} width={i === 0 ? 40 : 34} height="2.4" rx="1.2"
          fill={i === 0 ? PALETTE.brand : PALETTE.muted} opacity={i === 0 ? 0.9 : 0.6} />
      </g>
    ))}

    <circle className="hakcc-ripple" cx="51" cy="53" r="9" fill={PALETTE.brand}
      style={{ animation: 'hakcc-scaffold-click 6s ease-in-out infinite', transformOrigin: '51px 53px' }} />

    <g className="hakcc-transient" style={{ animation: 'hakcc-chip-lift 6s ease-in-out infinite' }}>
      <rect x="22" y="46" width="58" height="14" rx="7" fill={PALETTE.brand} opacity="0.3" />
    </g>

    <rect x="100" y="20" width="186" height="130" rx="6" fill={PALETTE.card} stroke={PALETTE.line} />
    <text x="108" y="34" fontSize="8" fill={PALETTE.muted} fontWeight="600">{lang === 'zh' ? '正文' : 'Write'}</text>

    <g style={{ animation: 'hakcc-token-in 6s ease-in-out infinite' }}>
      <rect x="108" y="44" width="68" height="15" rx="3" fill={PALETTE.brand} opacity="0.1" />
      <text x="112" y="55" fontSize="9" fill={PALETTE.brand} fontWeight="600">{lang === 'zh' ? '我的想法是' : 'My theory is'}</text>
    </g>

    <foreignObject x="178" y="44" width="100" height="16">
      <div className="hakcc-typed"
        style={{
          width: 92, transformOrigin: 'left center', height: 4, marginTop: 6, borderRadius: 2, background: PALETTE.ink,
          opacity: 0.5, animation: 'hakcc-typed 6s ease-in-out infinite',
        }} />
    </foreignObject>

    <rect className="hakcc-transient" x="180" y="45" width="1.6" height="13" fill={PALETTE.ink}
      style={{ animation: 'hakcc-caret 6s steps(1) infinite' }} />

    <rect x="108" y="72" width="150" height="2.4" rx="1.2" fill={PALETTE.muted} opacity="0.3" />
    <rect x="108" y="82" width="128" height="2.4" rx="1.2" fill={PALETTE.muted} opacity="0.3" />
  </>,
  label,
);

/** 综合升华：框选几条互相打架的笔记，写出一条谁都没说过的。 */
export const RiseAboveDemo: React.FC<DemoProps> = ({ label, lang = 'zh' }) => frame(
  <>
    {noteCard(28, 96, 60, 34, { bar: PALETTE.muted })}
    {noteCard(102, 106, 60, 34, { bar: PALETTE.accent })}
    {noteCard(176, 98, 60, 34, { bar: PALETTE.line })}

    <rect x="22" y="90" width="220" height="48" rx="6" fill={PALETTE.brand} fillOpacity="0.05"
      stroke={PALETTE.brand} strokeWidth="1.6" strokeDasharray="4 3"
      style={{ animation: 'hakcc-merge-select 6.5s ease-in-out infinite' }} />

    {[[58, 96], [132, 106], [206, 98]].map(([x, y], i) => (
      <path key={i} d={`M${x} ${y} C ${x} ${y - 26}, 150 ${y - 30}, 150 58`}
        fill="none" stroke={PALETTE.brand} strokeWidth="1.4" strokeDasharray="90" opacity="0.5"
        style={{ animation: 'hakcc-merge-pull 6.5s ease-in-out infinite' }} />
    ))}

    <g style={{ animation: 'hakcc-merge-rise 6.5s ease-in-out infinite', transformOrigin: '150px 40px' }}>
      <rect x="86" y="20" width="128" height="38" rx="5"
        fill={PALETTE.card} stroke={PALETTE.brand} strokeWidth="1.8" />
      <rect x="86" y="20" width="128" height="3" rx="1.5" fill={PALETTE.brand} />
      <text x="94" y="38" fontSize="8.5" fill={PALETTE.brand} fontWeight="700">{lang === 'zh' ? '综合升华' : 'Rise-above'}</text>
      <rect x="94" y="44" width="88" height="2.4" rx="1.2" fill={PALETTE.muted} opacity="0.55" />
      <rect x="94" y="50" width="64" height="2.4" rx="1.2" fill={PALETTE.muted} opacity="0.35" />
    </g>
  </>,
  label,
);

/** 画布：空白处拖动平移，滚轮缩放。 */
export const CanvasNavDemo: React.FC<DemoProps> = ({ label, lang = 'zh' }) => frame(
  <>
    <g style={{ animation: 'hakcc-pan 6s ease-in-out infinite', transformOrigin: '150px 85px' }}>
      <g opacity="0.25">
        {[30, 70, 110, 150].map(y => (
          <line key={y} x1="10" y1={y} x2="290" y2={y} stroke={PALETTE.line} strokeWidth="0.6" />
        ))}
        {[40, 100, 160, 220, 280].map(x => (
          <line key={x} x1={x} y1="10" x2={x} y2="160" stroke={PALETTE.line} strokeWidth="0.6" />
        ))}
      </g>
      {noteCard(48, 34, 56, 32, { bar: PALETTE.accent })}
      {noteCard(140, 62, 56, 32, { bar: PALETTE.line })}
      {noteCard(84, 108, 56, 32, { bar: PALETTE.muted })}
      <path d="M104 50 C 124 50, 126 74, 140 78" fill="none" stroke={PALETTE.line} strokeWidth="1.4" />
      <path d="M112 66 C 112 88, 112 96, 112 108" fill="none" stroke={PALETTE.line} strokeWidth="1.4" />
    </g>

    <Cursor animation="hakcc-cursor-pan 6s ease-in-out infinite" />
  </>,
  label,
);

export type DemoId = 'buildon' | 'scaffold' | 'riseabove' | 'canvas';

export const DEMOS: Record<DemoId, React.FC<DemoProps>> = {
  buildon: BuildOnDemo,
  scaffold: ScaffoldDemo,
  riseabove: RiseAboveDemo,
  canvas: CanvasNavDemo,
};
