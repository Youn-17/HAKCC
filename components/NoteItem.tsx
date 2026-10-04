
import React from 'react';
import {
  FileText, Video, Image as ImageIcon, Link2, PenTool, Layout, Layers,
  FileSpreadsheet, File, FileCode, Presentation, Table, Sparkles, Lightbulb, MessageCircle
} from 'lucide-react';
import { RiseAboveIcon, ViewIcon } from './icons/CustomIcons';
import type { Language, Note } from '../types';
import { RELATION_COLORS } from './relationColors';
import { MORANDI } from './morandiPalette';
import UserAvatar from './UserAvatar';
import NoteCornerBadges from './NoteCornerBadges';
import {
  STANDARD_NOTE_WIDTH, STANDARD_NOTE_HEIGHT,
  VIEW_NOTE_WIDTH, VIEW_NOTE_HEIGHT,
  RISEABOVE_NOTE_WIDTH, RISEABOVE_NOTE_HEIGHT,
  NOTE_FONT, NOTE_TITLE_LINE_HEIGHT, NOTE_TITLE_LINE_BOX,
} from './noteGeometry';

interface MoveCounts {
  extend?: number; clarify?: number; question?: number;
  challenge?: number; evidence?: number; synthesize?: number;
}

interface NoteItemProps {
  note: Note;
  lang?: Language;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  hasBuildOns?: boolean;
  moveCounts?: MoveCounts;
  synthesisDepth?: number;
  /** 别人发的、我还没打开过的笔记：左上角标红色 New */
  isNew?: boolean;
  /** 空间里被 Build-on 最多的笔记（至少两次）：左上角一团火，值是次数；0 表示不是 */
  hotCount?: number;
  className?: string;
  onMouseDown: (e: React.MouseEvent, note: Note) => void;
  onDoubleClick: (e: React.MouseEvent, note: Note) => void;
  onContextMenu: (e: React.MouseEvent, note: Note) => void;
  /** 拖右下角手柄改卡片大小；不传则该卡不可调整。 */
  onResizeStart?: (e: React.MouseEvent, note: Note) => void;
}

/**
 * 右下角的尺寸手柄。悬停即现，选中常驻 —— 不给它一个可见的抓取点，
 * 学生不会知道卡片能拉大。固定的卡片不显示。
 */
const ResizeGrip: React.FC<{ note: Note; onResizeStart?: (e: React.MouseEvent, note: Note) => void; visible?: boolean }> = ({
  note, onResizeStart, visible,
}) => {
  if (!onResizeStart || note.isFixed) return null;
  return (
    <span
      role="presentation"
      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onResizeStart(e, note); }}
      className={`absolute -bottom-0.5 -right-0.5 z-20 flex h-4 w-4 cursor-nwse-resize items-end justify-end rounded-br-lg transition-opacity duration-150 motion-reduce:transition-none ${
        visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
      title="拖动调整大小"
    >
      <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
        <path d="M10 3.5 L3.5 10 M10 7 L7 10" stroke="#94a3b8" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  );
};

// Compact colored dot strip showing received build-on move types
const MOVE_TYPE_KEYS: (keyof MoveCounts)[] = ['extend', 'clarify', 'question', 'challenge', 'evidence', 'synthesize'];
const MOVE_TYPE_LABELS: Record<string, Record<Language, string>> = {
  extend:     { zh: '延伸', en: 'Extend' },
  clarify:    { zh: '澄清', en: 'Clarify' },
  question:   { zh: '提问', en: 'Question' },
  challenge:  { zh: '质疑', en: 'Challenge' },
  evidence:   { zh: '证据', en: 'Evidence' },
  synthesize: { zh: '综合', en: 'Synthesize' },
};

const MoveTypeDots: React.FC<{ counts: MoveCounts; lang: Language }> = ({ counts, lang }) => {
  const dots = MOVE_TYPE_KEYS
    .map(key => ({ key, label: MOVE_TYPE_LABELS[key][lang], count: counts[key] ?? 0 }))
    .filter(d => d.count > 0);

  if (dots.length === 0) return null;
  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {dots.map(d => (
        <span
          key={d.key}
          className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none text-white ring-1 ring-white"
          style={{ backgroundColor: RELATION_COLORS[d.key] }}
          title={`${d.label} ×${d.count}`}
        >
          {d.count > 9 ? '9+' : d.count}
        </span>
      ))}
    </div>
  );
};

// Fixed notes stay selectable but signal "won't move" through the cursor alone —
// no badge, so a pinned card looks exactly like any other on the board.
const dragCursor = (note: Note) => note.isFixed ? 'cursor-default' : 'cursor-grab active:cursor-grabbing';

/**
 * 作者名 + 时间：卡片上认领自己想法的唯一线索，所以要够大够黑。
 * 年份始终显示 —— 课程跨学期复用同一个空间，只看月日会把去年的笔记
 * 误认成本周的。
 */
const formatStamp = (note: Note): string => {
  const iso = note.createdAt;
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return note.date ? note.date.split(' ')[0] : '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
};

/**
 * 卡片上的作者头像。真人一律走全站共用的 UserAvatar（同一个人在画布、
 * 成员管理、顶栏的回退色一致）；AI 伙伴例外 —— 它没有头像可设，
 * 用固定的深色底加星标，与真人一眼可分。
 */
const NoteAvatar: React.FC<{ note: Note; size?: number }> = ({ note, size = 20 }) => {
  if (note.author === 'AI Partner' && !note.authorAvatar) {
    return (
      <span
        style={{ width: size, height: size, backgroundColor: '#334155' }}
        className="flex flex-shrink-0 items-center justify-center rounded-full text-white ring-1 ring-black/5"
      >
        <Sparkles size={Math.round(size * 0.5)} />
      </span>
    );
  }
  return <UserAvatar name={note.author} avatar={note.authorAvatar} size={size} />;
};

/**
 * 卡片底部署名行：头像 + 姓名 + 时间。三处卡型共用，保证一致。
 * 姓名 15px —— 和标题同号但更粗：学生在几十张卡里找自己的笔记，
 * 认的就是这一行，比标题更需要一眼可读。
 */
const NoteByline: React.FC<{ note: Note; nameColor?: string; avatarSize?: number; nameSize?: number; stampSize?: number }> = ({
  note, nameColor, avatarSize = 24, nameSize = NOTE_FONT.author, stampSize = NOTE_FONT.meta,
}) => (
  // flex-wrap + 姓名的最小宽度：卡片够宽时姓名和时间同一行；
  // 窄卡上时间自动落到第二行，而不是把姓名截断成「李…」——
  // 姓名是学生认领自己笔记的依据，宁可挤掉时间也不能挤掉它。
  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
    <NoteAvatar note={note} size={avatarSize} />
    <span
      className="min-w-[4.5rem] flex-1 truncate font-semibold leading-tight text-slate-900"
      style={{ fontSize: nameSize, ...(nameColor ? { color: nameColor } : null) }}
      title={note.author}
    >
      {note.author}
    </span>
    {note.date && (
      <span
        className="ml-auto flex-shrink-0 font-medium tabular-nums text-slate-700"
        style={{ fontSize: stampSize }}
      >
        {formatStamp(note)}
      </span>
    )}
  </div>
);

const NoteItem: React.FC<NoteItemProps> = ({ note, lang = 'en', isSelected, isMultiSelected, hasBuildOns, moveCounts, synthesisDepth = 1, isNew, hotCount, className = '', onMouseDown, onDoubleClick, onContextMenu, onResizeStart }) => {
  const grip = <ResizeGrip note={note} onResizeStart={onResizeStart} visible={isSelected || isMultiSelected} />;
  const badges = <NoteCornerBadges isNew={isNew} hotCount={hotCount} lang={lang} />;
  const builtOnLabel = lang === 'zh' ? '已有 Build-on' : 'Built on';
  const builtOnTitle = lang === 'zh'
    ? '已有后续 Note 在这个想法基础上继续建构'
    : 'This idea has incoming build-on notes';
  
  // --- Custom Styled Notes ---
  if (note.customStyle) {
    return (
      <div
        className={`absolute flex items-center justify-center ${dragCursor(note)} group select-none transition-transform hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100 ${className} ${note.className || ''}`}
        style={{
          transform: `translate(${note.x}px, ${note.y}px)`,
          width: note.width,
          height: note.height,
          ...note.customStyle,
          zIndex: isSelected ? 50 : (note.customStyle.zIndex as number || 10),
        }}
        onMouseDown={(e) => onMouseDown(e, note)}
        onDoubleClick={(e) => onDoubleClick(e, note)}
        onContextMenu={(e) => onContextMenu(e, note)}
        title={note.title}
      >
        <span className="pointer-events-none text-center px-4">{note.title}</span>
      </div>
    );
  }

  // --- Drawing Note Render ---
  if (note.type === 'drawing' && note.drawingData) {
      return (
        <div
            className={`absolute flex flex-col ${dragCursor(note)} group select-none ${className}
                ${isMultiSelected ? 'ring-2 ring-orange-400 shadow-xl z-50' : isSelected ? 'ring-2 ring-blue-500 shadow-xl z-50' : 'shadow-md hover:shadow-lg z-20'}
                bg-white rounded-lg border border-gray-200
            `}
            style={{
                transform: `translate(${note.x}px, ${note.y}px)`,
                width: note.width || 200,
                height: note.height || 200,
            }}
            onMouseDown={(e) => onMouseDown(e, note)}
            onDoubleClick={(e) => onDoubleClick(e, note)}
            onContextMenu={(e) => onContextMenu(e, note)}
            title={note.title}
        >
            <div className="h-full w-full overflow-hidden rounded-lg bg-white relative p-2">
                <svg width="100%" height="100%" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet" className="pointer-events-none">
                    {note.drawingData.map((el: any) => {
                        const commonProps = { stroke: el.stroke, strokeWidth: 2, fill: el.fill };
                        switch(el.type) {
                            case 'rect': return <rect key={el.id} x={el.x} y={el.y} width={el.width} height={el.height} {...commonProps} />;
                            case 'circle': return <ellipse key={el.id} cx={el.x + el.width/2} cy={el.y + el.height/2} rx={el.width/2} ry={el.height/2} {...commonProps} />;
                            case 'diamond': 
                                const cx = el.x + el.width/2, cy = el.y + el.height/2;
                                return <polygon key={el.id} points={`${cx},${el.y} ${el.x+el.width},${cy} ${cx},${el.y+el.height} ${el.x},${cy}`} {...commonProps} />;
                            case 'line': return <line key={el.id} x1={el.x} y1={el.y} x2={el.x + el.width} y2={el.y + el.height} {...commonProps} />;
                            case 'text': return <text key={el.id} x={el.x+el.width/2} y={el.y+el.height/2} textAnchor="middle" fill={el.stroke} fontSize="14">{el.text}</text>;
                            default: return null;
                        }
                    })}
                </svg>
                <div className="absolute bottom-0 left-0 right-0 bg-black/5 text-xs p-1 text-center truncate font-medium text-gray-600">{note.title}</div>
            </div>
            {grip}
        {badges}
        </div>
      );
  }

  // --- In-Canvas Preview Mode (Images/Videos only — bare media, no card chrome) ---
  const isMediaFile = note.mimeType?.startsWith('image/') || note.mimeType?.startsWith('video/');
  if (note.isPreviewMode && note.fileUrl && isMediaFile) {
    const isImage = note.mimeType?.startsWith('image/');
    return (
      <div
        className={`absolute flex flex-col ${dragCursor(note)} group select-none rounded-md ${className}
            ${isMultiSelected ? 'ring-2 ring-orange-400 z-50' : isSelected ? 'ring-2 ring-blue-500 z-50' : 'hover:ring-1 hover:ring-slate-300/70 z-20'}
        `}
        style={{
            transform: `translate(${note.x}px, ${note.y}px)`,
            width: note.width || 320,
            height: note.height || 240,
        }}
        onMouseDown={(e) => onMouseDown(e, note)}
        onDoubleClick={(e) => onDoubleClick(e, note)} // Double click to zoom/open
        onContextMenu={(e) => onContextMenu(e, note)}
        title={note.title}
      >
        {note.mimeType?.startsWith('video/') ? (
          <video src={note.fileUrl} draggable={false} controls className="w-full h-full object-contain rounded-md bg-black" />
        ) : (
          <img
            src={note.fileUrl}
            alt={note.title}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            className="w-full h-full object-contain rounded-md"
          />
        )}

        {grip}
        {badges}
        {!isImage && (
          <div className="absolute bottom-0 left-0 right-0 rounded-b-md bg-black/50 text-white text-xs p-1 px-2 truncate">
            {note.title}
          </div>
        )}
      </div>
    );
  }

  // --- Icon Selection for Standard Notes ---
  /**
   * 文件类型看 MIME **和**扩展名两处。
   *
   * 原来最后一条是 `note.type === 'attachment' → 图片图标`，于是任何没被前面几条
   * 具体分支认出来的附件（.md 首当其冲：'text/markdown' 既不含 document 也不含 pdf）
   * 都被兜成了图片。只有真的是图片才该显示图片图标，其余退回通用文件图标。
   *
   * 颜色取自莫兰迪色板，和画布上其余部分同一套。
   */
  const getIcon = () => {
    const mt = note.mimeType || '';
    const fn = (note.fileName || '').toLowerCase();
    const ext = (re: RegExp) => re.test(fn);

    if (mt.includes('csv') || ext(/\.csv$/)) return <FileSpreadsheet size={16} style={{ color: MORANDI.sage }} />;
    if (mt.includes('sheet') || mt.includes('excel') || ext(/\.(xlsx?|ods)$/)) return <Table size={16} style={{ color: MORANDI.sage }} />;
    if (mt.includes('presentation') || mt.includes('powerpoint') || ext(/\.(pptx?|odp)$/)) return <Presentation size={16} style={{ color: MORANDI.ochre }} />;
    if (mt.includes('word') || mt.includes('officedocument.wordprocessing') || ext(/\.(docx?|odt|rtf)$/)) return <FileText size={16} style={{ color: MORANDI.dustyBlue }} />;
    if (mt.includes('pdf') || ext(/\.pdf$/)) return <FileText size={16} style={{ color: MORANDI.rose }} />;
    if (mt.includes('markdown') || ext(/\.(md|markdown)$/)) return <FileCode size={16} style={{ color: MORANDI.clay }} />;
    if (mt.startsWith('text/') || ext(/\.(txt|log|json|ya?ml)$/)) return <FileText size={16} style={{ color: MORANDI.clay }} />;
    if (note.type === 'video' || mt.startsWith('video/')) return <Video size={16} style={{ color: MORANDI.mauve }} />;
    if (mt.startsWith('audio/')) return <Layers size={16} style={{ color: MORANDI.mauve }} />;
    if (mt.startsWith('image/') || ext(/\.(png|jpe?g|gif|webp|svg|bmp|heic)$/)) return <ImageIcon size={16} style={{ color: MORANDI.lilac }} />;
    // 认不出来的附件用通用文件图标，不要假装它是图片
    if (note.type === 'attachment') return <File size={16} style={{ color: MORANDI.stone }} />;

    switch (note.type) {
      case 'view': return <span style={{ color: MORANDI.stone }}><ViewIcon size={18} /></span>;
      case 'link': return <Link2 size={16} style={{ color: MORANDI.dustyBlue }} />;
      case 'drawing': return <PenTool size={16} style={{ color: MORANDI.ochre }} />;
      case 'riseabove': return <span style={{ color: MORANDI.mauve }}><RiseAboveIcon size={18} /></span>;
      // 对话式笔记：点开是一段能继续问下去的对话，不是一段定稿的文字
      case 'ai_dialogue': return <MessageCircle size={16} style={{ color: MORANDI.dustyBlue }} strokeWidth={2.2} />;
      default: return <Lightbulb size={15} style={{ color: MORANDI.sage }} strokeWidth={2.4} />;
    }
  };

  // --- Compact File Entry (attachments/files/videos shown as a card) ---
  // Sizes to its own content: icon + file name + uploader/date. The 320×240
  // stored on upload is the media preview size and must not inflate the card.
  if (note.type === 'attachment' || note.type === 'video') {
    return (
      <div
        className={`absolute ${dragCursor(note)} group select-none ${className} ${isSelected || isMultiSelected ? 'z-50' : 'z-20'}`}
        style={{ transform: `translate(${note.x}px, ${note.y}px)`, width: 'max-content' }}
        onMouseDown={(e) => onMouseDown(e, note)}
        onDoubleClick={(e) => onDoubleClick(e, note)}
        onContextMenu={(e) => onContextMenu(e, note)}
        title={note.fileName || note.title}
      >
        <div className={`
          flex min-w-[168px] max-w-[248px] flex-col rounded-lg border bg-white px-3 py-2 transition-all duration-200 motion-reduce:transition-none
          ${isMultiSelected ? 'ring-2 ring-orange-400 shadow-lg border-orange-200' : isSelected ? 'ring-2 ring-blue-500 shadow-lg border-blue-200' : 'shadow-[0_1px_4px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:-translate-y-[1px] border-gray-200/80'}
        `}>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0">{getIcon()}</span>
            <span className="truncate text-[13px] font-medium text-slate-800">{note.title}</span>
          </div>
          <div className="mt-1.5">
            <NoteByline note={note} avatarSize={20} nameSize={14} />
          </div>
        </div>
      </div>
    );
  }

  const isView = note.type === 'view';
  const isRiseAbove = note.type === 'riseabove';
  
  const containerStyle: React.CSSProperties = {
    transform: `translate(${note.x}px, ${note.y}px)`,
    width: note.width ? `${note.width}px`
      : `${isView ? VIEW_NOTE_WIDTH : isRiseAbove ? RISEABOVE_NOTE_WIDTH : STANDARD_NOTE_WIDTH}px`,
    height: note.height ? `${note.height}px`
      : `${isView ? VIEW_NOTE_HEIGHT : isRiseAbove ? RISEABOVE_NOTE_HEIGHT : STANDARD_NOTE_HEIGHT}px`,
    zIndex: isView ? 10 : isRiseAbove ? 25 : 20, 
  };

  // --- Render View Type ---
  if (isView) {
    return (
      <div 
        className={`absolute flex flex-col ${dragCursor(note)} group select-none transition-shadow duration-200 ${className}
          ${isMultiSelected ? 'ring-2 ring-orange-400 shadow-xl' : isSelected ? 'ring-2 ring-blue-500 shadow-xl' : 'shadow-md hover:shadow-lg'}
        `}
        style={containerStyle}
        onMouseDown={(e) => onMouseDown(e, note)}
        onDoubleClick={(e) => onDoubleClick(e, note)}
        onContextMenu={(e) => onContextMenu(e, note)}
        title={note.title}
      >
        <div className="bg-blue-50 border border-blue-200 rounded-t-xl p-2.5 flex items-center gap-2">
          {getIcon()}
          <span className="font-bold text-sm text-blue-800 truncate">{note.title}</span>
        </div>
        {grip}
        {badges}
        <div className="bg-white border-x border-b border-blue-100 rounded-b-xl p-3 min-h-[60px]">
          <div className="flex flex-wrap gap-1">
             <div className="text-xs text-gray-500 font-medium">{note.author}</div>
          </div>
        </div>
      </div>
    );
  }

  // --- Render Rise Above Type (Canvas-native emergent design) ---
  if (isRiseAbove) {
    const depthLabel = synthesisDepth > 1
      ? (lang === 'zh' ? `${synthesisDepth}阶综合` : `${synthesisDepth}${synthesisDepth === 2 ? 'nd' : synthesisDepth === 3 ? 'rd' : 'th'}-order`)
      : null;
    const citedCount = note.citedNoteIds?.length ?? 0;

    return (
      <div
        className={`absolute flex flex-col ${dragCursor(note)} group select-none transition-shadow duration-200 ${className}
          ${isMultiSelected ? 'ring-2 ring-orange-400 shadow-2xl' : isSelected ? 'ring-2 ring-purple-500 shadow-2xl' : 'shadow-lg hover:shadow-xl'}
        `}
        style={containerStyle}
        onMouseDown={(e) => onMouseDown(e, note)}
        onDoubleClick={(e) => onDoubleClick(e, note)}
        onContextMenu={(e) => onContextMenu(e, note)}
        title={note.title}
      >
        {grip}
        {badges}
        <div className="relative z-10 bg-white border border-purple-200 rounded-xl flex flex-col h-full overflow-hidden">
           {/* Header — compact, canvas-native */}
           <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100 px-3 py-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers size={12} className="text-purple-600"/>
                <span className="text-[11px] font-bold text-purple-700 uppercase tracking-wide">Rise Above</span>
              </div>
              {depthLabel && (
                <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded">
                  {depthLabel}
                </span>
              )}
           </div>

           {/* Content */}
           <div className="px-3 py-2.5 flex-1 flex flex-col justify-center">
              <h3 className="font-bold text-gray-800 text-[14px] leading-snug line-clamp-2 mb-1.5">
                {note.title || <span className="text-gray-400 italic">{lang === 'zh' ? '未命名综合' : 'Untitled synthesis'}</span>}
              </h3>

              {citedCount > 0 && (
                 <div className="flex items-center gap-1 text-[11px] text-purple-600">
                    <span className="font-semibold">{citedCount}</span>
                    <span className="text-purple-500">{lang === 'zh' ? '个想法已综合' : 'ideas synthesized'}</span>
                 </div>
              )}
           </div>

           {/* Footer */}
           <div className="px-3 py-1.5 border-t border-purple-50 bg-gray-50/50">
              <NoteByline note={note} avatarSize={20} nameSize={14} />
           </div>
        </div>
      </div>
    );
  }

  // --- Render Standard Note/Video/Attachment (Index Card Style) ---
  const moveSegments = moveCounts
    ? MOVE_TYPE_KEYS.filter(k => (moveCounts[k] ?? 0) > 0)
    : [];

  /**
   * 标题能显示几行。卡片上只放标题，不放正文 —— 正文进画布会让每张卡
   * 变成一堵字墙，扫视整块画布时反而找不到东西；正文在双击打开的笔记页里看。
   * 调整卡片大小的意义就是让标题排得更合适，所以行数跟着高度走。
   */
  const titleLines = (() => {
    const h = note.height ?? STANDARD_NOTE_HEIGHT;
    const extras = (hasBuildOns || (moveCounts?.challenge ?? 0) > 0) ? 18 : 0;
    // 50 = 署名行最坏情况（窄卡上时间换到第二行占两行 44）+ 它与标题的间距 6
    const usable = h - 4 - 20 - 50 - extras;   // 色条 + 内边距 + 署名行
    return Math.max(1, Math.floor(usable / NOTE_TITLE_LINE_BOX));
  })();

  const dominantColor = (() => {
    if (!moveCounts) return '#94a3b8';
    let maxKey = '';
    let maxCount = 0;
    for (const key of MOVE_TYPE_KEYS) {
      const c = moveCounts[key] ?? 0;
      if (c > maxCount) { maxCount = c; maxKey = key; }
    }
    return maxKey ? RELATION_COLORS[maxKey] : '#94a3b8';
  })();

  return (
    <div
      className={`absolute flex flex-col ${dragCursor(note)} group select-none ${className}
        ${isSelected ? 'z-50' : 'z-20'}
      `}
      style={containerStyle}
      onMouseDown={(e) => onMouseDown(e, note)}
      onDoubleClick={(e) => onDoubleClick(e, note)}
      onContextMenu={(e) => onContextMenu(e, note)}
      title={note.title}
    >
      {note.unreadFeedback && (
        <span className="absolute -top-1 -left-1 z-10 flex h-3 w-3 pointer-events-none">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white" />
        </span>
      )}
      <div className={`
        h-full rounded-lg overflow-hidden transition-all duration-200 motion-reduce:transition-none bg-white border
        ${isMultiSelected ? 'ring-2 ring-orange-400 shadow-lg border-orange-200' : isSelected ? 'ring-2 ring-blue-500 shadow-lg border-blue-200' : 'shadow-[0_1px_4px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:-translate-y-[1px] border-gray-200/80'}
      `}>
        <div className="flex" style={{ height: '4px' }}>
          {moveSegments.length > 0
            ? moveSegments.map(key => (
                <div key={key} className="flex-1" style={{ backgroundColor: RELATION_COLORS[key] }} />
              ))
            : <div className="flex-1 bg-slate-200" />
          }
        </div>
        <div className="p-2.5 flex flex-col h-[calc(100%-4px)] min-h-0">
          {/* 行数跟着卡片高度走：拉高卡片就该看到更多正文，
              而写死的 line-clamp-3 无论多高都只显示三行。 */}
          <span
            className={`note-prose font-bold text-slate-900 break-words overflow-hidden ${note.type === 'link' ? 'text-blue-600 underline' : ''}`}
            style={{
              fontSize: NOTE_FONT.title,
              lineHeight: NOTE_TITLE_LINE_HEIGHT,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: titleLines,
            }}
          >
            {note.title}
          </span>
          {note.type === 'ai_dialogue' && (
            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ color: MORANDI.dustyBlue, backgroundColor: `${MORANDI.dustyBlue}1A` }}>
              <MessageCircle size={9} />{lang === 'zh' ? '可继续对话' : 'Open dialogue'}
            </span>
          )}
          <div className="mt-auto pt-1.5">
            <NoteByline note={note} />
          </div>
          {(hasBuildOns || (moveCounts?.challenge ?? 0) > 0) && (
            <div className="flex items-center gap-1 mt-1">
              {hasBuildOns && (
                <span className="text-[11px] font-medium text-emerald-600" title={builtOnTitle}>
                  {builtOnLabel}
                </span>
              )}
              {(moveCounts?.challenge ?? 0) > 0 && (
                <span className="ml-auto flex-shrink-0 rounded-full px-1.5 text-[11px] font-bold leading-4 text-white" style={{ backgroundColor: RELATION_COLORS.challenge }}>
                  ! {moveCounts!.challenge}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {grip}
        {badges}
    </div>
  );
};

/**
 * 拖一张卡时 notes 数组会整体换新，未被拖的卡对象引用不变 ——
 * memo 让它们跳过重渲染，一帧只重画被拖的那一张。
 * 课堂上一块画布常有几十上百张卡，这是拖动手感的关键。
 */
export default React.memo(NoteItem);
