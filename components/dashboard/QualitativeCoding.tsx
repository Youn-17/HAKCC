import React, { useState, useEffect, useRef } from 'react';
import { type Language, type Course } from '../../types';
import {
  coding,
  type CodingScheme, type CodingCode, type CodingReference, type CodingNote, type CodingStats,
  type CodingMatrix, type CodingTimeline, type CodingKappa, type CodingMemo,
  type AiCodingSuggestion, type AiSimilarSegment,
} from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { htmlToPlainText } from '../noteText';

interface Props {
  lang: Language;
  courses: Course[];
}

type ViewTab = 'code' | 'matrix' | 'kappa' | 'memos' | 'export' | 'ai';

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#ef4444', '#06b6d4', '#84cc16'];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Codebook Panel ───────────────────────────────────────────

function CodebookPanel({ codes, onAdd, onDelete, onSelect, selectedCodeId, lang }: {
  codes: CodingCode[];
  onAdd: (name: string, color: string) => void;
  onDelete: (id: string) => void;
  onSelect: (code: CodingCode | null) => void;
  selectedCodeId: string | null;
  lang: Language;
}) {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLORS[0]);
  const zh = lang === 'zh';

  const rootCodes = codes.filter(c => !c.parent_id);
  const childMap = new Map<string, CodingCode[]>();
  for (const c of codes) {
    if (c.parent_id) {
      const arr = childMap.get(c.parent_id) ?? [];
      arr.push(c);
      childMap.set(c.parent_id, arr);
    }
  }

  const handleAdd = () => {
    if (!newName.trim()) return;
    onAdd(newName.trim(), newColor);
    setNewName('');
    setNewColor(COLORS[(codes.length + 1) % COLORS.length]);
  };

  const renderCode = (code: CodingCode, depth = 0) => {
    const children = childMap.get(code.id) ?? [];
    const isActive = selectedCodeId === code.id;
    return (
      <div key={code.id} className="group">
        <button
          onClick={() => onSelect(isActive ? null : code)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[0.8125rem] transition-colors ${
            isActive ? 'bg-gray-100 dark:bg-gray-800 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900'
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: code.color }} />
          <span className="truncate flex-1 text-gray-800 dark:text-gray-200">{code.name}</span>
          <span
            onClick={(e) => { e.stopPropagation(); onDelete(code.id); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 cursor-pointer"
          >
            <RemixIcon name="close-line" size={12} />
          </span>
        </button>
        {children.map(ch => renderCode(ch, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <h4 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">
          {zh ? '编码本' : 'Codebook'}
        </h4>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {rootCodes.map(c => renderCode(c))}
        {codes.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">{zh ? '暂无编码，添加一个' : 'No codes yet'}</p>
        )}
      </div>
      <div className="border-t border-gray-200 dark:border-gray-800 p-2 space-y-2">
        <div className="flex gap-1.5">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder={zh ? '新编码名称' : 'New code name'}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#000080]"
          />
          <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer border-0 p-0" />
        </div>
        <button
          onClick={handleAdd}
          disabled={!newName.trim()}
          className="w-full text-xs font-medium py-1.5 rounded-lg bg-[#000080] text-white hover:bg-[#000080]/90 disabled:opacity-40 transition-colors"
        >
          {zh ? '添加编码' : 'Add Code'}
        </button>
      </div>
    </div>
  );
}

// ── Note Content Viewer ──────────────────────────────────────

function NoteContentView({ note, references, selectedCodeId, onCodeText, lang }: {
  note: { id: string; title: string; content: string } | null;
  references: CodingReference[];
  selectedCodeId: string | null;
  onCodeText: (start: number, end: number, text: string) => void;
  lang: Language;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const zh = lang === 'zh';

  const handleMouseUp = () => {
    if (!note || !selectedCodeId) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !contentRef.current) return;
    const range = sel.getRangeAt(0);
    if (!contentRef.current.contains(range.startContainer)) return;
    const preRange = document.createRange();
    preRange.setStart(contentRef.current, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const endOffset = startOffset + range.toString().length;
    const codedText = range.toString();
    if (codedText.trim()) onCodeText(startOffset, endOffset, codedText);
    sel.removeAllRanges();
  };

  if (!note) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        {zh ? '选择一篇笔记开始编码' : 'Select a note to start coding'}
      </div>
    );
  }

  const plainText = htmlToPlainText(note.content);
  const sortedRefs = [...references].sort((a, b) => a.start_offset - b.start_offset);

  const renderHighlightedText = () => {
    if (sortedRefs.length === 0) return <span>{plainText}</span>;
    const segments: React.ReactNode[] = [];
    let lastEnd = 0;
    for (let i = 0; i < sortedRefs.length; i++) {
      const ref = sortedRefs[i];
      if (ref.start_offset > lastEnd) {
        segments.push(<span key={`gap-${i}`}>{plainText.slice(lastEnd, ref.start_offset)}</span>);
      }
      const color = ref.coding_codes?.color ?? '#3b82f6';
      segments.push(
        <mark key={ref.id} className="rounded-sm px-0.5 relative group/mark cursor-pointer"
          style={{ backgroundColor: `${color}25`, borderBottom: `2px solid ${color}` }}
          title={ref.coding_codes?.name ?? ''}>
          {plainText.slice(ref.start_offset, ref.end_offset)}
          <span className="absolute -top-6 left-0 hidden group-hover/mark:block text-[0.6875rem] px-1.5 py-0.5 rounded bg-gray-900 text-white whitespace-nowrap z-10">
            {ref.coding_codes?.name}
          </span>
        </mark>
      );
      lastEnd = Math.max(lastEnd, ref.end_offset);
    }
    if (lastEnd < plainText.length) segments.push(<span key="tail">{plainText.slice(lastEnd)}</span>);
    return <>{segments}</>;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{note.title || (zh ? '无标题' : 'Untitled')}</h3>
        {selectedCodeId && (
          <span className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-[#000080]/10 text-[#000080] dark:text-[#93AAFD] font-medium">
            {zh ? '选中文本即可编码' : 'Select text to code'}
          </span>
        )}
      </div>
      <div ref={contentRef} onMouseUp={handleMouseUp}
        className="flex-1 overflow-y-auto px-4 py-3 text-[0.8125rem] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap select-text cursor-text relative">
        {renderHighlightedText()}
        {sortedRefs.length > 0 && (
          <div className="absolute right-1 top-0 bottom-0 w-2">
            {sortedRefs.map(ref => {
              const top = (ref.start_offset / Math.max(plainText.length, 1)) * 100;
              const height = Math.max(((ref.end_offset - ref.start_offset) / Math.max(plainText.length, 1)) * 100, 1);
              return <div key={ref.id} className="absolute right-0 w-1.5 rounded-sm"
                style={{ backgroundColor: ref.coding_codes?.color ?? '#3b82f6', top: `${top}%`, height: `${height}%` }} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Matrix View ──────────────────────────────────────────────

function MatrixView({ schemeId, courseId, lang }: { schemeId: string; courseId: string; lang: Language }) {
  const zh = lang === 'zh';
  const [matrix, setMatrix] = useState<CodingMatrix | null>(null);
  const [timeline, setTimeline] = useState<CodingTimeline | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      coding.getMatrix(schemeId, courseId).then(r => setMatrix(r.matrix)),
      coding.getTimeline(schemeId).then(r => setTimeline(r.timeline)),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, [schemeId, courseId]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">{zh ? '加载中...' : 'Loading...'}</div>;

  const maxVal = matrix ? Math.max(1, ...matrix.codes.flatMap(c => matrix.authors.map(a => matrix.cells[c.id]?.[a.id] ?? 0))) : 1;

  return (
    <div className="p-6 space-y-8 overflow-y-auto max-h-full">
      {/* Code × Author Matrix */}
      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{zh ? '编码 × 作者 矩阵' : 'Code × Author Matrix'}</h3>
        {matrix && matrix.authors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">{zh ? '编码' : 'Code'}</th>
                  {matrix.authors.map(a => (
                    <th key={a.id} className="px-3 py-2 text-center text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700 min-w-[60px]">{a.name}</th>
                  ))}
                  <th className="px-3 py-2 text-center text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">{zh ? '合计' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                {matrix.codes.map(code => {
                  const rowTotal = matrix.authors.reduce((s, a) => s + (matrix.cells[code.id]?.[a.id] ?? 0), 0);
                  return (
                    <tr key={code.id}>
                      <td className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: code.color }} />
                          <span className="text-gray-700 dark:text-gray-300">{code.name}</span>
                        </div>
                      </td>
                      {matrix.authors.map(a => {
                        const val = matrix.cells[code.id]?.[a.id] ?? 0;
                        const intensity = val / maxVal;
                        return (
                          <td key={a.id} className="px-3 py-2 text-center border-b border-gray-100 dark:border-gray-800"
                            style={{ backgroundColor: val > 0 ? `${code.color}${Math.round(intensity * 40 + 10).toString(16).padStart(2, '0')}` : 'transparent' }}>
                            <span className="text-gray-700 dark:text-gray-300 font-medium">{val || ''}</span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-center border-b border-gray-100 dark:border-gray-800 font-semibold text-gray-800 dark:text-gray-200">{rowTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">{zh ? '暂无编码数据' : 'No coding data yet'}</p>
        )}
      </section>

      {/* Code × Time Heatmap */}
      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{zh ? '编码 × 时间 分布' : 'Code × Time Distribution'}</h3>
        {timeline && timeline.dates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">{zh ? '编码' : 'Code'}</th>
                  {timeline.dates.map(d => (
                    <th key={d} className="px-2 py-2 text-center text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700 text-[0.6875rem] whitespace-nowrap">
                      {d.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timeline.codes.map(code => (
                  <tr key={code.id}>
                    <td className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: code.color }} />
                        <span className="text-gray-700 dark:text-gray-300">{code.name}</span>
                      </div>
                    </td>
                    {timeline.dates.map(d => {
                      const val = timeline.cells[d]?.[code.id] ?? 0;
                      return (
                        <td key={d} className="px-2 py-2 text-center border-b border-gray-100 dark:border-gray-800"
                          style={{ backgroundColor: val > 0 ? `${code.color}${Math.min(Math.round(val * 25 + 15), 99).toString(16).padStart(2, '0')}` : 'transparent' }}>
                          <span className="text-gray-600 dark:text-gray-400">{val || ''}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">{zh ? '暂无时间分布数据' : 'No timeline data yet'}</p>
        )}
      </section>
    </div>
  );
}

// ── Kappa View ───────────────────────────────────────────────

function KappaView({ schemeId, lang }: { schemeId: string; lang: Language }) {
  const zh = lang === 'zh';
  const [kappa, setKappa] = useState<CodingKappa | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    coding.getKappa(schemeId).then(r => setKappa(r.kappa)).catch(() => {}).finally(() => setLoading(false));
  }, [schemeId]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">{zh ? '加载中...' : 'Loading...'}</div>;

  const kappaLabel = (k: number) => {
    if (k >= 0.81) return { text: zh ? '几乎完全一致' : 'Almost Perfect', color: 'text-green-600' };
    if (k >= 0.61) return { text: zh ? '高度一致' : 'Substantial', color: 'text-green-500' };
    if (k >= 0.41) return { text: zh ? '中度一致' : 'Moderate', color: 'text-yellow-500' };
    if (k >= 0.21) return { text: zh ? '一般一致' : 'Fair', color: 'text-orange-500' };
    return { text: zh ? '一致性差' : 'Slight/Poor', color: 'text-red-500' };
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto max-h-full">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{zh ? '编码者间信度 (Cohen\'s Kappa)' : 'Inter-Coder Reliability (Cohen\'s Kappa)'}</h3>

      {kappa?.message && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm">
          <RemixIcon name="information-line" size={16} />
          {kappa.message}
        </div>
      )}

      {kappa?.value !== null && kappa?.value !== undefined && (
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center px-6 py-4 rounded-2xl bg-gray-50 dark:bg-gray-900">
            <span className="text-3xl font-bold text-gray-800 dark:text-gray-200">{kappa.value.toFixed(3)}</span>
            <span className={`text-xs font-medium mt-1 ${kappaLabel(kappa.value).color}`}>{kappaLabel(kappa.value).text}</span>
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <p>0.81-1.00 = {zh ? '几乎完全一致' : 'Almost Perfect'}</p>
            <p>0.61-0.80 = {zh ? '高度一致' : 'Substantial'}</p>
            <p>0.41-0.60 = {zh ? '中度一致' : 'Moderate'}</p>
            <p>0.21-0.40 = {zh ? '一般一致' : 'Fair'}</p>
            <p>{'< 0.20'} = {zh ? '一致性差' : 'Slight/Poor'}</p>
          </div>
        </div>
      )}

      {kappa?.pairs && kappa.pairs.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{zh ? '配对结果' : 'Pairwise Results'}</h4>
          <table className="text-xs border-collapse w-full max-w-lg">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">{zh ? '编码者 1' : 'Coder 1'}</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">{zh ? '编码者 2' : 'Coder 2'}</th>
                <th className="px-3 py-2 text-center text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">Kappa</th>
                <th className="px-3 py-2 text-center text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">{zh ? '一致率' : 'Agreement'}</th>
                <th className="px-3 py-2 text-center text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">{zh ? '项目数' : 'Items'}</th>
              </tr>
            </thead>
            <tbody>
              {kappa.pairs.map((p, i) => {
                const label = kappaLabel(p.kappa);
                return (
                  <tr key={i}>
                    <td className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300">{p.coder1}</td>
                    <td className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300">{p.coder2}</td>
                    <td className={`px-3 py-2 text-center border-b border-gray-100 dark:border-gray-800 font-semibold ${label.color}`}>{p.kappa.toFixed(3)}</td>
                    <td className="px-3 py-2 text-center border-b border-gray-100 dark:border-gray-800 text-gray-600">{(p.agreement * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center border-b border-gray-100 dark:border-gray-800 text-gray-600">{p.items}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Memos View ───────────────────────────────────────────────

function MemosView({ schemeId, codes, lang }: { schemeId: string; codes: CodingCode[]; lang: Language }) {
  const zh = lang === 'zh';
  const [memos, setMemos] = useState<CodingMemo[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    setLoading(true);
    coding.listMemos(schemeId).then(r => setMemos(r.memos)).catch(() => {}).finally(() => setLoading(false));
  }, [schemeId]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      const r = await coding.createMemo(schemeId, { title: newTitle.trim(), content: newContent });
      setMemos(prev => [r.memo, ...prev]);
      setNewTitle('');
      setNewContent('');
      setCreating(false);
    } catch {}
  };

  const handleUpdate = async (id: string) => {
    try {
      const r = await coding.updateMemo(id, { content: editContent });
      setMemos(prev => prev.map(m => m.id === id ? r.memo : m));
      setEditingId(null);
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await coding.deleteMemo(id);
      setMemos(prev => prev.filter(m => m.id !== id));
    } catch {}
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">{zh ? '加载中...' : 'Loading...'}</div>;

  return (
    <div className="p-6 space-y-4 overflow-y-auto max-h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{zh ? '分析备忘录' : 'Analysis Memos'}</h3>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-[#000080] text-white hover:bg-[#000080]/90 transition-colors">
          <RemixIcon name="add-line" size={13} />
          {zh ? '新备忘' : 'New Memo'}
        </button>
      </div>

      {creating && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3 bg-white dark:bg-gray-900">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder={zh ? '备忘标题' : 'Memo title'}
            className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-[#000080]" />
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder={zh ? '分析笔记...' : 'Analysis notes...'}
            rows={4}
            className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-[#000080] resize-none" />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="text-xs px-3 py-1.5 rounded-lg bg-[#000080] text-white font-medium">{zh ? '保存' : 'Save'}</button>
            <button onClick={() => setCreating(false)} className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">{zh ? '取消' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {memos.length === 0 && !creating && (
        <p className="text-sm text-gray-400 text-center py-8">{zh ? '暂无备忘录。记录您的编码思路和发现。' : 'No memos yet. Record your coding insights and findings.'}</p>
      )}

      <div className="space-y-3">
        {memos.map(memo => (
          <div key={memo.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 group bg-white dark:bg-gray-900">
            <div className="flex items-start justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">{memo.title}</h4>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => { setEditingId(memo.id); setEditContent(memo.content); }}
                  className="p-1 text-gray-400 hover:text-[#000080]"><RemixIcon name="edit-line" size={13} /></button>
                <button onClick={() => handleDelete(memo.id)}
                  className="p-1 text-gray-400 hover:text-red-500"><RemixIcon name="delete-bin-line" size={13} /></button>
              </div>
            </div>
            {editingId === memo.id ? (
              <div className="space-y-2">
                <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={3}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-[#000080] resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => handleUpdate(memo.id)} className="text-xs px-3 py-1 rounded bg-[#000080] text-white font-medium">{zh ? '保存' : 'Save'}</button>
                  <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1 text-gray-500">{zh ? '取消' : 'Cancel'}</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">{memo.content}</p>
            )}
            <div className="mt-2 text-[0.6875rem] text-gray-400">{new Date(memo.created_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Export View ───────────────────────────────────────────────

function ExportView({ schemeId, schemeName, lang }: { schemeId: string; schemeName: string; lang: Language }) {
  const zh = lang === 'zh';
  const [exporting, setExporting] = useState(false);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const blob = await coding.exportData(schemeId, 'csv') as Blob;
      downloadBlob(blob, `coding_${schemeName}_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {} finally { setExporting(false); }
  };

  const handleExportJson = async () => {
    setExporting(true);
    try {
      const data = await coding.exportData(schemeId, 'json') as { export: any };
      const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `coding_${schemeName}_${new Date().toISOString().slice(0, 10)}.json`);
    } catch {} finally { setExporting(false); }
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto max-h-full">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{zh ? '编码数据导出' : 'Export Coded Data'}</h3>

      <div className="grid grid-cols-2 gap-4 max-w-lg">
        <button onClick={handleExportCsv} disabled={exporting}
          className="flex flex-col items-center gap-3 px-6 py-6 rounded-2xl border border-gray-200 dark:border-gray-700 hover:border-[#000080] hover:bg-[#000080]/[0.03] transition-all group">
          <RemixIcon name="file-text-line" size={28} className="text-gray-400 group-hover:text-[#000080] transition-colors" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">CSV</span>
          <span className="text-[0.6875rem] text-gray-400">{zh ? '编码引用表，可用 Excel/SPSS 打开' : 'References table for Excel/SPSS'}</span>
        </button>
        <button onClick={handleExportJson} disabled={exporting}
          className="flex flex-col items-center gap-3 px-6 py-6 rounded-2xl border border-gray-200 dark:border-gray-700 hover:border-[#000080] hover:bg-[#000080]/[0.03] transition-all group">
          <RemixIcon name="code-s-slash-line" size={28} className="text-gray-400 group-hover:text-[#000080] transition-colors" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">JSON</span>
          <span className="text-[0.6875rem] text-gray-400">{zh ? '完整数据包（方案+编码+引用+备忘）' : 'Full data pack (scheme+codes+refs+memos)'}</span>
        </button>
      </div>

      <div className="text-xs text-gray-400 space-y-1 pt-2">
        <p>{zh ? 'CSV 包含字段：编码名称、笔记标题、编码者、偏移量、编码文本、备注、时间' : 'CSV fields: code name, note title, coder, offsets, coded text, memo, timestamp'}</p>
        <p>{zh ? 'JSON 包含完整的编码方案结构、所有编码引用及备忘录' : 'JSON includes full scheme structure, all references, and memos'}</p>
      </div>
    </div>
  );
}

// ── AI Coding View ───────────────────────────────────────────

function AiCodingView({ schemeId, courseId, notes, codes, lang, onRefreshNotes }: {
  schemeId: string; courseId: string; notes: CodingNote[]; codes: CodingCode[]; lang: Language; onRefreshNotes: () => void;
}) {
  const zh = lang === 'zh';
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AiCodingSuggestion[]>([]);
  const [similar, setSimilar] = useState<AiSimilarSegment[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResult, setBatchResult] = useState<{ results: { note_id: string; created: number }[]; totalCreated: number } | null>(null);
  const [similarText, setSimilarText] = useState('');
  const [similarLoading, setSimilarLoading] = useState(false);
  const [acceptedIds, setAcceptedIds] = useState<Set<number>>(new Set());

  const handleSuggest = async (noteId: string) => {
    setSelectedNoteId(noteId);
    setSuggestions([]);
    setAcceptedIds(new Set());
    setSuggestLoading(true);
    try {
      const r = await coding.aiSuggest(schemeId, noteId, courseId);
      setSuggestions(r.suggestions);
    } catch {} finally { setSuggestLoading(false); }
  };

  const handleAcceptSuggestion = async (s: AiCodingSuggestion, idx: number) => {
    if (!selectedNoteId) return;
    try {
      await coding.createReference({
        code_id: s.code_id, note_id: selectedNoteId,
        start_offset: s.start, end_offset: s.end, coded_text: s.text, memo: `[AI suggested, confidence: ${s.confidence}]`,
      });
      setAcceptedIds(prev => new Set(prev).add(idx));
    } catch {}
  };

  const handleAcceptAll = async () => {
    if (!selectedNoteId) return;
    for (let i = 0; i < suggestions.length; i++) {
      if (acceptedIds.has(i)) continue;
      const s = suggestions[i];
      if (s.confidence >= 0.6) {
        try {
          await coding.createReference({
            code_id: s.code_id, note_id: selectedNoteId,
            start_offset: s.start, end_offset: s.end, coded_text: s.text, memo: `[AI suggested, confidence: ${s.confidence}]`,
          });
          setAcceptedIds(prev => new Set(prev).add(i));
        } catch {}
      }
    }
  };

  const handleBatch = async () => {
    const uncodedIds = notes.filter(n => !n.is_coded).map(n => n.id);
    if (uncodedIds.length === 0) return;
    setBatchLoading(true);
    setBatchResult(null);
    try {
      const r = await coding.aiBatch(schemeId, uncodedIds.slice(0, 20), courseId);
      setBatchResult(r);
      onRefreshNotes();
    } catch {} finally { setBatchLoading(false); }
  };

  const handleFindSimilar = async () => {
    if (!similarText.trim()) return;
    setSimilarLoading(true);
    setSimilar([]);
    try {
      const r = await coding.aiSimilar(schemeId, similarText.trim(), courseId);
      setSimilar(r.similar);
    } catch {} finally { setSimilarLoading(false); }
  };

  const uncodedCount = notes.filter(n => !n.is_coded).length;
  const confidenceColor = (c: number) => c >= 0.8 ? 'text-green-600' : c >= 0.5 ? 'text-yellow-600' : 'text-red-500';

  return (
    <div className="p-6 space-y-8 overflow-y-auto max-h-full">
      {/* AI Suggest for single note */}
      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <RemixIcon name="sparkling-2-line" size={16} className="text-[#000080]" />
          {zh ? 'AI 编码建议' : 'AI Code Suggestions'}
        </h3>
        <p className="text-xs text-gray-500 mb-3">{zh ? '选择一篇笔记，AI 将基于编码本自动识别可编码的文本片段。' : 'Select a note — AI will identify codable text segments based on your codebook.'}</p>

        <div className="flex gap-3 items-start">
          <select value={selectedNoteId ?? ''} onChange={e => e.target.value && handleSuggest(e.target.value)}
            className="text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 max-w-xs focus:outline-none focus:ring-1 focus:ring-[#000080]">
            <option value="">{zh ? '选择笔记...' : 'Select note...'}</option>
            {notes.map(n => <option key={n.id} value={n.id}>{n.title || (zh ? '无标题' : 'Untitled')}{n.is_coded ? ' ✓' : ''}</option>)}
          </select>
          {suggestLoading && <span className="text-xs text-gray-400 py-2">{zh ? 'AI 分析中...' : 'AI analyzing...'}</span>}
        </div>

        {suggestions.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">{suggestions.length} {zh ? '个建议' : 'suggestions'}</span>
              <button onClick={handleAcceptAll}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#000080] text-white hover:bg-[#000080]/90 transition-colors">
                {zh ? '接受全部高置信度' : 'Accept All (≥0.6)'}
              </button>
            </div>
            {suggestions.map((s, i) => (
              <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                acceptedIds.has(i) ? 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
              }`}>
                <span className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: s.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{s.code_name}</span>
                    <span className={`text-[0.6875rem] font-semibold ${confidenceColor(s.confidence)}`}>{Math.round(s.confidence * 100)}%</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-1">"{s.text}"</p>
                  {s.reason && <p className="text-[0.6875rem] text-gray-400 italic">{s.reason}</p>}
                </div>
                {acceptedIds.has(i) ? (
                  <span className="text-green-500 flex-shrink-0"><RemixIcon name="check-line" size={16} /></span>
                ) : (
                  <button onClick={() => handleAcceptSuggestion(s, i)}
                    className="flex-shrink-0 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 hover:bg-[#000080]/5 hover:text-[#000080] hover:border-[#000080]/30 transition-colors">
                    {zh ? '接受' : 'Accept'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Batch Pre-coding */}
      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <RemixIcon name="stack-line" size={16} className="text-[#000080]" />
          {zh ? 'AI 批量预编码' : 'AI Batch Pre-Coding'}
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          {zh
            ? `AI 将自动对所有未编码的笔记（${uncodedCount} 篇）进行初始编码。编码结果标记为 [AI pre-coded]，可在编码视图中审查和修正。`
            : `AI will auto-code all uncoded notes (${uncodedCount}). Results are marked [AI pre-coded] for your review.`}
        </p>
        <button onClick={handleBatch} disabled={batchLoading || uncodedCount === 0}
          className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-[#000080] text-white hover:bg-[#000080]/90 disabled:opacity-40 transition-colors">
          {batchLoading ? <RemixIcon name="loader-4-line" size={14} className="animate-spin" /> : <RemixIcon name="robot-2-line" size={14} />}
          {batchLoading ? (zh ? '批量编码中...' : 'Batch coding...') : (zh ? `批量编码 ${uncodedCount} 篇笔记` : `Batch code ${uncodedCount} notes`)}
        </button>
        {batchResult && (
          <div className="mt-3 p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <p className="text-sm text-green-700 dark:text-green-400 font-medium">
              {zh ? `完成！共创建 ${batchResult.totalCreated} 个编码引用` : `Done! Created ${batchResult.totalCreated} coding references`}
            </p>
            <div className="mt-2 space-y-1">
              {batchResult.results.map(r => (
                <p key={r.note_id} className="text-xs text-green-600 dark:text-green-500">
                  {notes.find(n => n.id === r.note_id)?.title ?? r.note_id.slice(0, 8)}: {r.created} {zh ? '个引用' : 'refs'}
                </p>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Semantic Similarity */}
      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <RemixIcon name="search-eye-line" size={16} className="text-[#000080]" />
          {zh ? '语义相似片段' : 'Semantic Similarity Search'}
        </h3>
        <p className="text-xs text-gray-500 mb-3">{zh ? '输入一段文本，AI 将在已编码的片段中查找语义相似的内容。' : 'Enter text to find semantically similar coded segments.'}</p>
        <div className="flex gap-2">
          <input value={similarText} onChange={e => setSimilarText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleFindSimilar()}
            placeholder={zh ? '输入文本片段...' : 'Enter text fragment...'}
            className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-[#000080] max-w-md" />
          <button onClick={handleFindSimilar} disabled={similarLoading || !similarText.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-[#000080] text-white hover:bg-[#000080]/90 disabled:opacity-40 transition-colors">
            {similarLoading ? (zh ? '搜索中...' : 'Searching...') : (zh ? '查找' : 'Find')}
          </button>
        </div>
        {similar.length > 0 && (
          <div className="mt-3 space-y-2">
            {similar.map((s, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{s.code_name}</span>
                    <span className="text-[0.6875rem] text-[#000080] dark:text-[#93AAFD] font-semibold">{Math.round(s.similarity * 100)}%</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">"{s.coded_text}"</p>
                  {s.reason && <p className="text-[0.6875rem] text-gray-400 italic mt-1">{s.reason}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

const QualitativeCoding: React.FC<Props> = ({ lang, courses }) => {
  const zh = lang === 'zh';
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [schemes, setSchemes] = useState<CodingScheme[]>([]);
  const [activeScheme, setActiveScheme] = useState<CodingScheme | null>(null);
  const [codes, setCodes] = useState<CodingCode[]>([]);
  const [notes, setNotes] = useState<CodingNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<{ id: string; title: string; content: string } | null>(null);
  const [references, setReferences] = useState<CodingReference[]>([]);
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const [stats, setStats] = useState<CodingStats | null>(null);
  const [noteFilter, setNoteFilter] = useState<'all' | 'coded' | 'uncoded'>('all');
  const [creatingScheme, setCreatingScheme] = useState(false);
  const [newSchemeName, setNewSchemeName] = useState('');
  const [viewTab, setViewTab] = useState<ViewTab>('code');

  useEffect(() => {
    if (!courseId) return;
    coding.listSchemes(courseId).then(r => {
      setSchemes(r.schemes);
      if (r.schemes.length > 0 && !activeScheme) setActiveScheme(r.schemes[0]);
    }).catch(() => {});
  }, [courseId]);

  useEffect(() => {
    if (!courseId) return;
    coding.listNotes(courseId, activeScheme?.id).then(r => setNotes(r.notes)).catch(() => {});
    if (!activeScheme) { setCodes([]); setStats(null); return; }
    coding.listCodes(activeScheme.id).then(r => setCodes(r.codes)).catch(() => {});
    coding.getStats(activeScheme.id, courseId).then(r => setStats(r.stats)).catch(() => {});
  }, [activeScheme?.id, courseId]);

  useEffect(() => {
    if (!activeScheme || !selectedNote) { setReferences([]); return; }
    coding.listReferences(activeScheme.id, { note_id: selectedNote.id })
      .then(r => setReferences(r.references)).catch(() => {});
  }, [selectedNote?.id, activeScheme?.id]);

  const handleSelectNote = async (noteId: string) => {
    try {
      const r = await coding.getNoteContent(noteId);
      setSelectedNote({ id: r.note.id, title: r.note.title, content: r.note.content });
    } catch {}
  };

  const handleAddCode = async (name: string, color: string) => {
    if (!activeScheme) return;
    try {
      const r = await coding.createCode(activeScheme.id, { name, color, sort_order: codes.length });
      setCodes(prev => [...prev, r.code]);
    } catch {}
  };

  const handleDeleteCode = async (codeId: string) => {
    try {
      await coding.deleteCode(codeId);
      setCodes(prev => prev.filter(c => c.id !== codeId));
      if (selectedCodeId === codeId) setSelectedCodeId(null);
    } catch {}
  };

  const handleCodeText = async (startOffset: number, endOffset: number, codedText: string) => {
    if (!selectedCodeId || !selectedNote) return;
    try {
      const r = await coding.createReference({
        code_id: selectedCodeId, note_id: selectedNote.id,
        start_offset: startOffset, end_offset: endOffset, coded_text: codedText,
      });
      setReferences(prev => [...prev, r.reference]);
      setNotes(prev => prev.map(n => n.id === selectedNote.id ? { ...n, is_coded: true } : n));
    } catch {}
  };

  const handleDeleteReference = async (refId: string) => {
    try {
      await coding.deleteReference(refId);
      setReferences(prev => prev.filter(r => r.id !== refId));
    } catch {}
  };

  const handleCreateScheme = async () => {
    if (!newSchemeName.trim() || !courseId) return;
    try {
      const r = await coding.createScheme(courseId, { name: newSchemeName.trim() });
      setSchemes(prev => [r.scheme, ...prev]);
      setActiveScheme(r.scheme);
      setNewSchemeName('');
      setCreatingScheme(false);
    } catch {}
  };

  const filteredNotes = notes.filter(n => {
    if (noteFilter === 'coded') return n.is_coded;
    if (noteFilter === 'uncoded') return !n.is_coded;
    return true;
  });

  const refreshNotes = () => {
    if (activeScheme) {
      coding.listNotes(courseId, activeScheme.id).then(r => setNotes(r.notes)).catch(() => {});
      coding.getStats(activeScheme.id, courseId).then(r => setStats(r.stats)).catch(() => {});
    }
  };

  const tabs: { id: ViewTab; icon: string; label: string }[] = [
    { id: 'code', icon: 'highlight', label: zh ? '编码' : 'Code' },
    { id: 'ai', icon: 'sparkling-2-line', label: zh ? 'AI' : 'AI' },
    { id: 'matrix', icon: 'grid-line', label: zh ? '矩阵' : 'Matrix' },
    { id: 'kappa', icon: 'group-line', label: zh ? '信度' : 'Kappa' },
    { id: 'memos', icon: 'sticky-note-line', label: zh ? '备忘' : 'Memos' },
    { id: 'export', icon: 'download-2-line', label: zh ? '导出' : 'Export' },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0">
        <select value={courseId}
          onChange={e => { setCourseId(e.target.value); setActiveScheme(null); setSelectedNote(null); }}
          className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#000080]">
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>

        <div className="flex items-center gap-2">
          <RemixIcon name="book-2-line" size={14} className="text-gray-400" />
          <select value={activeScheme?.id ?? ''}
            onChange={e => { const s = schemes.find(s => s.id === e.target.value); setActiveScheme(s ?? null); setSelectedNote(null); }}
            className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#000080]">
            {schemes.length === 0 && <option value="">{zh ? '无编码方案' : 'No scheme'}</option>}
            {schemes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {creatingScheme ? (
            <div className="flex items-center gap-1.5">
              <input autoFocus value={newSchemeName} onChange={e => setNewSchemeName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateScheme()}
                placeholder={zh ? '方案名称' : 'Scheme name'}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 w-36 focus:outline-none focus:ring-1 focus:ring-[#000080]" />
              <button onClick={handleCreateScheme} className="text-xs px-2 py-1 rounded bg-[#000080] text-white font-medium">{zh ? '创建' : 'Create'}</button>
              <button onClick={() => setCreatingScheme(false)} className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100">{zh ? '取消' : 'Cancel'}</button>
            </div>
          ) : (
            <button onClick={() => setCreatingScheme(true)} className="flex items-center gap-1 text-xs text-[#000080] dark:text-[#93AAFD] hover:underline">
              <RemixIcon name="add-line" size={13} />{zh ? '新方案' : 'New'}
            </button>
          )}
        </div>

        {/* View tabs */}
        <div className="flex items-center gap-0.5 ml-auto bg-gray-100 dark:bg-gray-900 rounded-lg p-0.5">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setViewTab(tab.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[0.6875rem] font-medium transition-colors ${
                viewTab === tab.id
                  ? 'bg-white dark:bg-gray-800 text-[#000080] dark:text-[#93AAFD] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}>
              <RemixIcon name={tab.icon} size={12} />
              {tab.label}
            </button>
          ))}
        </div>

        {stats && (
          <div className="flex items-center gap-3 text-[0.6875rem] text-gray-500">
            <span>{stats.codedNotes}/{stats.totalNotes} {zh ? '已编码' : 'coded'}</span>
            <span>{stats.totalReferences} {zh ? '引用' : 'refs'}</span>
          </div>
        )}
      </div>

      {/* View content */}
      {viewTab === 'code' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Note list */}
          <div className="w-[220px] flex-shrink-0 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50/50 dark:bg-gray-950">
            <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
              <h4 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-gray-400 flex-1">{zh ? '笔记列表' : 'Notes'}</h4>
              <div className="flex gap-0.5 text-[0.6875rem]">
                {(['all', 'uncoded', 'coded'] as const).map(f => (
                  <button key={f} onClick={() => setNoteFilter(f)}
                    className={`px-1.5 py-0.5 rounded ${noteFilter === f ? 'bg-[#000080]/10 text-[#000080] font-medium' : 'text-gray-400 hover:text-gray-600'}`}>
                    {f === 'all' ? (zh ? '全部' : 'All') : f === 'coded' ? (zh ? '已码' : 'Done') : (zh ? '未码' : 'Todo')}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-0.5">
              {filteredNotes.map(n => (
                <button key={n.id} onClick={() => handleSelectNote(n.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors text-[0.75rem] ${
                    selectedNote?.id === n.id
                      ? 'bg-[#000080]/[0.07] text-[#000080] dark:text-[#93AAFD] font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900'
                  }`}>
                  <div className="flex items-center gap-1.5">
                    {n.is_coded && <RemixIcon name="check-line" size={11} className="text-green-500 flex-shrink-0" />}
                    <span className="truncate">{n.title || (zh ? '无标题' : 'Untitled')}</span>
                  </div>
                </button>
              ))}
              {filteredNotes.length === 0 && <p className="text-xs text-gray-400 text-center py-6">{zh ? '无笔记' : 'No notes'}</p>}
            </div>
          </div>

          {/* Center: Note content */}
          <div className="flex-1 relative overflow-hidden">
            <NoteContentView note={selectedNote} references={references} selectedCodeId={selectedCodeId} onCodeText={handleCodeText} lang={lang} />
          </div>

          {/* Right: Codebook + References */}
          <div className="w-[200px] flex-shrink-0 border-l border-gray-200 dark:border-gray-800 flex flex-col">
            <div className="flex-1 overflow-hidden">
              <CodebookPanel codes={codes} onAdd={handleAddCode} onDelete={handleDeleteCode}
                onSelect={(code) => setSelectedCodeId(code?.id ?? null)} selectedCodeId={selectedCodeId} lang={lang} />
            </div>
            {references.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-800 max-h-[200px] overflow-y-auto">
                <div className="px-3 py-1.5">
                  <h4 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-gray-400">{zh ? '本篇引用' : 'References'} ({references.length})</h4>
                </div>
                <div className="px-2 pb-2 space-y-1">
                  {references.map(ref => (
                    <div key={ref.id} className="flex items-start gap-1.5 px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-900 group">
                      <span className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: ref.coding_codes?.color ?? '#3b82f6' }} />
                      <span className="text-[0.6875rem] text-gray-600 dark:text-gray-400 line-clamp-1 flex-1">{ref.coded_text}</span>
                      <button onClick={() => handleDeleteReference(ref.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 flex-shrink-0">
                        <RemixIcon name="close-line" size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : viewTab === 'ai' && activeScheme ? (
        <div className="flex-1 overflow-hidden">
          <AiCodingView schemeId={activeScheme.id} courseId={courseId} notes={notes} codes={codes} lang={lang} onRefreshNotes={refreshNotes} />
        </div>
      ) : viewTab === 'matrix' && activeScheme ? (
        <div className="flex-1 overflow-hidden">
          <MatrixView schemeId={activeScheme.id} courseId={courseId} lang={lang} />
        </div>
      ) : viewTab === 'kappa' && activeScheme ? (
        <div className="flex-1 overflow-hidden">
          <KappaView schemeId={activeScheme.id} lang={lang} />
        </div>
      ) : viewTab === 'memos' && activeScheme ? (
        <div className="flex-1 overflow-hidden">
          <MemosView schemeId={activeScheme.id} codes={codes} lang={lang} />
        </div>
      ) : viewTab === 'export' && activeScheme ? (
        <div className="flex-1 overflow-hidden">
          <ExportView schemeId={activeScheme.id} schemeName={activeScheme.name} lang={lang} />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          {zh ? '请先选择或创建编码方案' : 'Select or create a coding scheme first'}
        </div>
      )}
    </div>
  );
};

export default QualitativeCoding;
