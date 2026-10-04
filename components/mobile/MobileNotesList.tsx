import React, { useState, useMemo } from 'react';
import RemixIcon from '../RemixIcon';
import type { Note, Language } from '../../types';
import { htmlToPlainText, noteSearchText } from '../noteText';
import NoteCornerBadges from '../NoteCornerBadges';
import { isNoteNew, useNoteSeenVersion } from '../noteBadges';

type SortMode = 'newest' | 'author' | 'type';
type FilterType = 'all' | 'note' | 'riseabove' | 'drawing' | 'attachment';

interface MobileNotesListProps {
  notes: Note[];
  lang: Language;
  onNoteOpen: (note: Note) => void;
  onCreateNote: () => void;
  currentUserId?: string;
  /** 被 Build-on 最多的笔记 → 次数（hotBuildOnCounts），和画布同一个口径 */
  hotCounts?: Map<string, number>;
}

const TYPE_LABELS: Record<string, { zh: string; en: string; icon: string; color: string }> = {
  note:       { zh: '笔记',   en: 'Note',       icon: 'sticky-note-2-line', color: 'bg-blue-50 text-blue-600' },
  riseabove:  { zh: '综合',   en: 'Rise Above', icon: 'mind-map',           color: 'bg-purple-50 text-purple-600' },
  drawing:    { zh: '绘图',   en: 'Drawing',    icon: 'draw-line',          color: 'bg-amber-50 text-amber-600' },
  attachment: { zh: '附件',   en: 'Attachment',  icon: 'attachment-2',       color: 'bg-green-50 text-green-600' },
};

const FILTER_OPTIONS: { id: FilterType; zh: string; en: string }[] = [
  { id: 'all',        zh: '全部',   en: 'All' },
  { id: 'note',       zh: '笔记',   en: 'Notes' },
  { id: 'riseabove',  zh: '综合',   en: 'Rise Above' },
  { id: 'drawing',    zh: '绘图',   en: 'Drawings' },
  { id: 'attachment', zh: '附件',   en: 'Files' },
];

const MobileNotesList: React.FC<MobileNotesListProps> = ({ notes, lang, onNoteOpen, onCreateNote, currentUserId, hotCounts }) => {
  // 点开一条后它的 New 要马上摘掉
  useNoteSeenVersion();
  const lbl = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [sort, setSort] = useState<SortMode>('newest');
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = notes;
    if (filter !== 'all') list = list.filter(n => n.type === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(n => n.title?.toLowerCase().includes(q) || noteSearchText(n.content).includes(q) || n.author?.toLowerCase().includes(q));
    }
    switch (sort) {
      case 'newest': return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      case 'author': return [...list].sort((a, b) => (a.author || '').localeCompare(b.author || ''));
      case 'type':   return [...list].sort((a, b) => a.type.localeCompare(b.type));
      default: return list;
    }
  }, [notes, filter, search, sort]);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Search bar */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-lg border-b border-gray-100 px-4 pt-3 pb-2 space-y-2">
        <div className="relative">
          <RemixIcon name="search-line" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={lbl('搜索笔记...', 'Search notes...')}
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-gray-100 text-sm border-none outline-none focus:ring-2 focus:ring-[#000080]/20"
          />
        </div>
        {/* Filter chips */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 px-3 h-7 rounded-full text-xs font-medium transition-colors ${
                filter === f.id
                  ? 'bg-[#000080] text-white'
                  : 'bg-gray-100 text-gray-600 active:bg-gray-200'
              }`}
            >
              {lbl(f.zh, f.en)}
            </button>
          ))}
          <div className="shrink-0 w-1" />
        </div>
      </div>

      {/* Sort bar */}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-500">
        <span>{filtered.length} {lbl('条笔记', 'notes')}</span>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortMode)}
          className="text-xs bg-transparent border-none outline-none text-gray-500 cursor-pointer"
        >
          <option value="newest">{lbl('最新优先', 'Newest first')}</option>
          <option value="author">{lbl('按作者', 'By author')}</option>
          <option value="type">{lbl('按类型', 'By type')}</option>
        </select>
      </div>

      {/* Notes list */}
      {/* 顶上留出角标的位置：New / 火骑在卡片上沿，滚动容器会把第一张卡的角标裁掉 */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-20 space-y-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <RemixIcon name="inbox-line" size={40} />
            <p className="mt-3 text-sm">{lbl('暂无笔记', 'No notes yet')}</p>
            <button onClick={onCreateNote} className="mt-4 px-4 h-9 rounded-lg bg-[#000080] text-white text-sm font-medium active:scale-95 transition-transform">
              {lbl('创建第一条笔记', 'Create first note')}
            </button>
          </div>
        ) : (
          filtered.map(note => {
            const meta = TYPE_LABELS[note.type] || TYPE_LABELS.note;
            const preview = note.content ? htmlToPlainText(note.content).slice(0, 120) : '';
            const isMine = note.authorId === currentUserId;
            return (
              <button
                key={note.id}
                onClick={() => onNoteOpen(note)}
                className="relative w-full text-left bg-white rounded-xl p-3.5 border border-gray-100 active:scale-[0.98] transition-transform shadow-sm"
              >
                <NoteCornerBadges
                  isNew={isNoteNew(note, currentUserId)}
                  hotCount={hotCounts?.get(note.id) ?? 0}
                  lang={lang}
                  className="-top-2 left-3"
                />
                <div className="flex items-start gap-3">
                  <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${meta.color}`}>
                    <RemixIcon name={meta.icon} size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900 truncate flex-1">
                        {note.title || lbl('无标题', 'Untitled')}
                      </h3>
                      {note.type === 'riseabove' && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[0.6875rem] font-bold bg-purple-100 text-purple-700">RA</span>
                      )}
                    </div>
                    {preview && (
                      <p className="mt-1 text-xs text-gray-500 line-clamp-2 leading-relaxed">{preview}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-[0.6875rem] text-gray-400">
                      <span className={isMine ? 'text-[#000080] font-medium' : ''}>{note.author}</span>
                      <span>·</span>
                      <span>{new Date(note.date).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}</span>
                      {note.metrics && note.metrics.buildOnCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-0.5">
                            <RemixIcon name="chat-3-line" size={10} />
                            {note.metrics.buildOnCount}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* FAB - Create note */}
      <button
        onClick={onCreateNote}
        className="fixed bottom-20 right-5 z-40 w-14 h-14 rounded-full bg-[#000080] text-white shadow-lg shadow-[#000080]/30 flex items-center justify-center active:scale-90 transition-transform"
      >
        <RemixIcon name="add-line" size={26} />
      </button>
    </div>
  );
};

export default MobileNotesList;
