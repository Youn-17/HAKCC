/**
 * AISidePanel — Slide-in right panel for AI-assisted teaching & research
 *
 * Tabs:
 *  1. Monitor  — real-time View stats (note count, connections)
 *  2. Inspector — selected Note details + AI feedback workflow
 *
 * Teacher flow: Generate AI Feedback → preview KB evaluation + student summary
 *               → optionally edit student summary → Publish to student
 * Student flow: Read AI feedback + teacher notes → red dot clears on open
 */

import React, { useState, useEffect } from 'react';
import {
  X, BarChart2, FileText, Sparkles, Send, CheckCircle,
  Edit3, Eye, ChevronDown, ChevronUp, Activity, Link2,
  MessageSquare, User, Clock, Layers, BookOpen, Loader2,
  Brain, ArrowRight,
} from 'lucide-react';
import { Note, Edge, Language } from '../types';
import { feedback as feedbackApi, NoteFeedbackApi } from '../services/apiClient';
import { noteWordCount } from './noteText';

interface AISidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  edges: Edge[];
  selectedNote?: Note | null;
  /**
   * 课程教职（创建者、课程管理员、平台管理员），按课内身份算：生成、发布教师反馈后端只放行他们。
   * 在这门课里只是普通成员的教师账号是这门课的学生，看学生那一侧（自己收到的反馈，打开即已读）。
   */
  isStaff: boolean;
  lang: Language;
  spaceId?: string;
  courseId: string;
  userId: string;
  /** Called when a feedback is published so NoteItem red-dot can refresh */
  onFeedbackPublished?: (noteId: string) => void;
  /** Called when user reads feedback so red-dot can clear */
  onFeedbackRead?: (noteId: string, feedbackId: string) => void;
  /** Select and focus a note from panel-driven feedback lists */
  onSelectNote?: (noteId: string) => void;
}

type PanelTab = 'monitor' | 'inspector';

interface GeneratedFeedback {
  id: string;
  aiEvaluation: string;
  studentSummary: string;
}

const AISidePanel: React.FC<AISidePanelProps> = ({
  isOpen,
  onClose,
  notes,
  edges,
  selectedNote,
  isStaff,
  lang,
  spaceId,
  courseId,
  userId,
  onFeedbackPublished,
  onFeedbackRead,
  onSelectNote,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('monitor');
  const [publishedFeedbacks, setPublishedFeedbacks] = useState<NoteFeedbackApi[]>([]);
  const [loadingFeedbacks, setLoadingFeedbacks] = useState(false);

  // Teacher feedback generation flow
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedFeedback | null>(null);
  const [editedSummary, setEditedSummary] = useState('');
  const [teacherNote, setTeacherNote] = useState('');
  const [isEditingFeedback, setIsEditingFeedback] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [showAIEval, setShowAIEval] = useState(false);

  const t = {
    title: lang === 'zh' ? 'AI 研究助手' : 'AI Research Panel',
    monitor: lang === 'zh' ? '实时监控' : 'Monitor',
    inspector: lang === 'zh' ? '笔记检查' : 'Inspector',
    totalNotes: lang === 'zh' ? '笔记总数' : 'Total Notes',
    connections: lang === 'zh' ? '连接数' : 'Connections',
    authors: lang === 'zh' ? '参与者' : 'Contributors',
    noteTypes: lang === 'zh' ? '类型分布' : 'Note Types',
    selectNote: lang === 'zh' ? '请点击画布中的笔记查看详情' : 'Click a note on the canvas to inspect',
    wordCount: lang === 'zh' ? '字数' : 'Words',
    buildOns: lang === 'zh' ? 'Build-ons' : 'Build-ons',
    generateFeedback: lang === 'zh' ? 'AI 生成反馈' : 'Generate AI Feedback',
    generating: lang === 'zh' ? '正在分析...' : 'Analyzing…',
    aiEvaluation: lang === 'zh' ? 'AI 知识建构评估（仅教师可见）' : 'AI KB Evaluation (Teacher Only)',
    studentSummary: lang === 'zh' ? '学生反馈摘要' : 'Student Feedback Summary',
    editSummary: lang === 'zh' ? '编辑摘要' : 'Edit Summary',
    teacherNoteLabel: lang === 'zh' ? '教师补充意见（可选）' : 'Teacher Note (optional)',
    publish: lang === 'zh' ? '发布给学生' : 'Publish to Student',
    publishing: lang === 'zh' ? '发布中...' : 'Publishing…',
    published: lang === 'zh' ? '已发布 ✓' : 'Published ✓',
    publishedFeedbacks: lang === 'zh' ? '已发布的反馈' : 'Published Feedbacks',
    noFeedback: lang === 'zh' ? '暂无反馈' : 'No feedback yet',
    feedbackFrom: lang === 'zh' ? '来自' : 'From',
    teacherFeedback: lang === 'zh' ? '教师反馈' : 'Teacher Feedback',
    unread: lang === 'zh' ? '未读' : 'Unread',
    readFeedback: lang === 'zh' ? '查看反馈' : 'Review',
    regenerate: lang === 'zh' ? '重新生成' : 'Regenerate',
    close: lang === 'zh' ? '关闭' : 'Close',
    riseAboves: lang === 'zh' ? 'Rise-above' : 'Rise Aboves',
  };

  // Reset when note changes
  useEffect(() => {
    if (selectedNote) {
      setGenerated(null);
      setEditedSummary('');
      setTeacherNote('');
      setIsEditingFeedback(false);
      setPublishSuccess(false);
      setShowAIEval(false);
      setActiveTab('inspector');
      loadFeedbacks(selectedNote.id);
    }
  }, [selectedNote?.id]);

  // Mark feedbacks as read when student opens inspector on a note with unread feedback
  useEffect(() => {
    if (activeTab === 'inspector' && selectedNote?.unreadFeedback && !isStaff) {
      publishedFeedbacks
        .filter(f => !f.isRead)
        .forEach(f => {
          feedbackApi.markRead(selectedNote.id, f.id).catch(() => {});
          onFeedbackRead?.(selectedNote.id, f.id);
        });
    }
  }, [activeTab, selectedNote?.id, publishedFeedbacks, isStaff]);

  async function loadFeedbacks(noteId: string) {
    setLoadingFeedbacks(true);
    try {
      const res = await feedbackApi.list(noteId);
      setPublishedFeedbacks(res.feedbacks);
    } catch {
      setPublishedFeedbacks([]);
    } finally {
      setLoadingFeedbacks(false);
    }
  }

  async function handleGenerate() {
    if (!selectedNote) return;
    setGenerating(true);
    setGenerated(null);
    setPublishSuccess(false);
    try {
      const res = await feedbackApi.generate(selectedNote.id);
      const f = res.feedback;
      setGenerated({ id: f.id, aiEvaluation: f.aiEvaluation ?? '', studentSummary: f.studentSummary });
      setEditedSummary(f.studentSummary);
    } catch {
      setGenerated({ id: '', aiEvaluation: 'Generation failed.', studentSummary: 'Unable to generate feedback at this time.' });
      setEditedSummary('Unable to generate feedback at this time.');
    } finally {
      setGenerating(false);
    }
  }

  async function handlePublish() {
    if (!selectedNote || !generated) return;
    setPublishing(true);
    try {
      await feedbackApi.publish(selectedNote.id, {
        feedbackId: generated.id,
        studentSummary: editedSummary,
        teacherNote: teacherNote.trim() || undefined,
      });
      setPublishSuccess(true);
      setGenerated(null);
      onFeedbackPublished?.(selectedNote.id);
      await loadFeedbacks(selectedNote.id);
    } catch {
      // fail silently
    } finally {
      setPublishing(false);
    }
  }

  // ── Stats for Monitor tab ────────────────────────────────────
  const noteCount = notes.length;
  const edgeCount = edges.length;
  const authorSet = new Set(notes.map(n => n.author));
  const authorCount = authorSet.size;

  const typeCounts = notes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  const notesWithTeacherFeedback = notes
    .filter(n => (n.feedbacks?.length ?? 0) > 0)
    .sort((a, b) => Number(Boolean(b.unreadFeedback)) - Number(Boolean(a.unreadFeedback)));

  const typeColors: Record<string, string> = {
    note: 'bg-teal-400',
    riseabove: 'bg-purple-400',
    view: 'bg-blue-400',
    drawing: 'bg-orange-400',
    attachment: 'bg-green-400',
    video: 'bg-pink-400',
  };

  // ── Inspector stats ──────────────────────────────────────────
  const buildOnCount = selectedNote
    ? edges.filter(e => e.target === selectedNote.id).length
    : 0;
  const wordCount = noteWordCount(selectedNote?.content);

  if (!isOpen) return null;

  return (
    <div
      className="fixed right-0 top-10 bottom-0 z-[55] flex"
      style={{ width: '340px' }}
    >
      {/* Backdrop click to close */}
      <div className="absolute inset-0 -left-full" onClick={onClose} />

      <div className="relative flex flex-col w-full bg-white dark:bg-[#1a1f2e] border-l border-gray-200 dark:border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/10 bg-gradient-to-r from-blue-600 to-violet-600 text-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-white/80" />
            <span className="font-bold text-sm tracking-tight">{t.title}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-white/10 flex-shrink-0">
          {(['monitor', 'inspector'] as PanelTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5
                ${activeTab === tab
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                }`}
            >
              {tab === 'monitor'
                ? <><Activity size={13} /> {t.monitor}</>
                : <><FileText size={13} /> {t.inspector}</>
              }
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Monitor Tab ────────────────────────────────── */}
          {activeTab === 'monitor' && (
            <div className="p-4 space-y-4">
              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: t.totalNotes, value: noteCount, icon: FileText, color: 'text-teal-500', bg: 'bg-teal-50 dark:bg-teal-500/10' },
                  { label: t.connections, value: edgeCount, icon: Link2, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
                  { label: t.authors, value: authorCount, icon: User, color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-500/10' },
                ].map(stat => (
                  <div key={stat.label} className={`${stat.bg} rounded-xl p-3 flex flex-col items-center gap-1`}>
                    <stat.icon size={16} className={stat.color} />
                    <span className="text-xl font-bold text-gray-800 dark:text-white leading-none">{stat.value}</span>
                    <span className="text-[0.6875rem] text-gray-500 dark:text-slate-400 text-center leading-tight">{stat.label}</span>
                  </div>
                ))}
              </div>

              {/* Note type distribution */}
              {!isStaff && notesWithTeacherFeedback.length > 0 && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                      <MessageSquare size={13} />
                      {t.teacherFeedback}
                    </div>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-700 dark:bg-white/10 dark:text-amber-200">
                      {notesWithTeacherFeedback.reduce((sum, note) => sum + (note.feedbacks?.length ?? 0), 0)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {notesWithTeacherFeedback.slice(0, 5).map(note => (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => {
                          onSelectNote?.(note.id);
                          setActiveTab('inspector');
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/85 px-2.5 py-2 text-left text-xs text-gray-700 transition-colors hover:bg-white dark:bg-white/8 dark:text-slate-200 dark:hover:bg-white/12"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{note.title}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${
                          note.unreadFeedback
                            ? 'bg-amber-500 text-white'
                            : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-300'
                        }`}>
                          {note.unreadFeedback ? t.unread : t.readFeedback}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Note type distribution */}
              {Object.keys(typeCounts).length > 0 && (
                <div>
                  <div className="text-[0.6875rem] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                    {t.noteTypes}
                  </div>
                  <div className="space-y-1.5">
                    {Object.entries(typeCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => (
                        <div key={type} className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${typeColors[type] ?? 'bg-gray-400'}`} />
                          <span className="text-xs text-gray-600 dark:text-slate-300 capitalize flex-1">{type}</span>
                          <div className="flex items-center gap-1.5 flex-1">
                            <div className="flex-1 bg-gray-100 dark:bg-white/10 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${typeColors[type] ?? 'bg-gray-400'}`}
                                style={{ width: `${(count / noteCount) * 100}%` }}
                              />
                            </div>
                            <span className="text-[0.6875rem] font-bold text-gray-700 dark:text-slate-300 w-5 text-right">{count}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Live pulse indicator */}
              <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500 pt-2 border-t border-gray-100 dark:border-white/10">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                {lang === 'zh' ? '实时更新中' : 'Live updates'}
              </div>
            </div>
          )}

          {/* ── Inspector Tab ───────────────────────────────── */}
          {activeTab === 'inspector' && (
            <div className="p-4 space-y-4">
              {!selectedNote ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-white/5 flex items-center justify-center mb-3">
                    <MousePointerIcon />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-slate-400 max-w-[200px] leading-relaxed">
                    {t.selectNote}
                  </p>
                </div>
              ) : (
                <>
                  {/* Note header */}
                  <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <BookOpen size={14} className="text-teal-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm font-semibold text-gray-800 dark:text-white leading-snug line-clamp-2">
                        {selectedNote.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                      <span className="flex items-center gap-1"><User size={11} /> {selectedNote.author}</span>
                      <span className="flex items-center gap-1"><Clock size={11} /> {selectedNote.date?.split(' ')[0]}</span>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: t.wordCount, value: wordCount, color: 'text-blue-500' },
                      { label: t.buildOns, value: buildOnCount, color: 'text-green-500' },
                      { label: t.connections, value: edges.filter(e => e.source === selectedNote.id || e.target === selectedNote.id).length, color: 'text-violet-500' },
                    ].map(s => (
                      <div key={s.label} className="bg-gray-50 dark:bg-white/5 rounded-lg p-2.5 text-center">
                        <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                        <div className="text-[0.6875rem] text-gray-400 dark:text-slate-500">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* ── TEACHER FLOW ── */}
                  {isStaff && (
                    <div className="space-y-3">
                      <div className="text-[0.6875rem] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                        {lang === 'zh' ? 'AI 教学助手' : 'AI Teaching Assistant'}
                      </div>

                      {/* Not yet generated */}
                      {!generated && !publishSuccess && (
                        <button
                          onClick={handleGenerate}
                          disabled={generating}
                          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white text-sm font-semibold rounded-xl transition-all disabled:opacity-60 shadow-sm"
                        >
                          {generating ? (
                            <><Loader2 size={14} className="animate-spin" /> {t.generating}</>
                          ) : (
                            <><Sparkles size={14} /> {t.generateFeedback}</>
                          )}
                        </button>
                      )}

                      {/* Generated preview */}
                      {generated && !publishSuccess && (
                        <div className="space-y-3">
                          {/* AI Evaluation (collapsible) */}
                          <div className="border border-amber-200 dark:border-amber-500/20 rounded-xl overflow-hidden">
                            <button
                              onClick={() => setShowAIEval(!showAIEval)}
                              className="w-full flex items-center justify-between px-3 py-2.5 bg-amber-50 dark:bg-amber-500/10 text-xs font-semibold text-amber-700 dark:text-amber-400"
                            >
                              <span className="flex items-center gap-1.5">
                                <Eye size={12} /> {t.aiEvaluation}
                              </span>
                              {showAIEval ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                            {showAIEval && (
                              <div className="px-3 py-2.5 text-xs text-gray-700 dark:text-slate-300 bg-amber-50/50 dark:bg-amber-500/5 leading-relaxed whitespace-pre-wrap">
                                {generated.aiEvaluation}
                              </div>
                            )}
                          </div>

                          {/* Student Summary (editable) */}
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold text-gray-600 dark:text-slate-300">{t.studentSummary}</span>
                              <button
                                onClick={() => setIsEditingFeedback(!isEditingFeedback)}
                                className="text-[0.6875rem] text-blue-500 hover:text-blue-600 flex items-center gap-1"
                              >
                                <Edit3 size={11} /> {t.editSummary}
                              </button>
                            </div>
                            {isEditingFeedback ? (
                              <textarea
                                value={editedSummary}
                                onChange={e => setEditedSummary(e.target.value)}
                                className="w-full text-xs bg-white dark:bg-white/5 border border-blue-200 dark:border-blue-500/30 rounded-lg p-2.5 resize-none h-28 text-gray-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            ) : (
                              <div className="text-xs text-gray-700 dark:text-slate-300 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-lg p-2.5 leading-relaxed">
                                {editedSummary}
                              </div>
                            )}
                          </div>

                          {/* Teacher note */}
                          <div>
                            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300 block mb-1.5">
                              {t.teacherNoteLabel}
                            </label>
                            <textarea
                              value={teacherNote}
                              onChange={e => setTeacherNote(e.target.value)}
                              placeholder={lang === 'zh' ? '添加您的个人意见...' : 'Add your personal note…'}
                              className="w-full text-xs bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg p-2.5 resize-none h-16 text-gray-700 dark:text-slate-200 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </div>

                          {/* Actions */}
                          <div className="flex gap-2">
                            <button
                              onClick={handleGenerate}
                              disabled={generating}
                              className="flex-1 py-2 text-xs font-medium text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center justify-center gap-1.5"
                            >
                              <ArrowRight size={12} /> {t.regenerate}
                            </button>
                            <button
                              onClick={handlePublish}
                              disabled={publishing || !editedSummary.trim()}
                              className="flex-1 py-2 text-xs font-bold text-white bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-1.5 shadow-sm"
                            >
                              {publishing
                                ? <><Loader2 size={12} className="animate-spin" /> {t.publishing}</>
                                : <><Send size={12} /> {t.publish}</>
                              }
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Publish success */}
                      {publishSuccess && (
                        <div className="flex items-center gap-2 py-2.5 px-3 bg-green-50 dark:bg-green-500/10 rounded-xl text-green-600 dark:text-green-400 text-sm font-medium">
                          <CheckCircle size={16} /> {t.published}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── STUDENT FLOW ── */}
                  {!isStaff && (
                    <div className="space-y-3">
                      <div className="text-[0.6875rem] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                        {t.publishedFeedbacks}
                      </div>

                      {loadingFeedbacks ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 size={20} className="animate-spin text-blue-500" />
                        </div>
                      ) : publishedFeedbacks.length === 0 ? (
                        <div className="text-center py-8 text-sm text-gray-400 dark:text-slate-500 italic">
                          {t.noFeedback}
                        </div>
                      ) : (
                        publishedFeedbacks.map(fb => (
                          <div key={fb.id} className="border border-blue-100 dark:border-blue-500/20 rounded-xl overflow-hidden">
                            <div className="px-3 py-2 bg-blue-50 dark:bg-blue-500/10 flex items-center justify-between">
                              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                                <Sparkles size={12} /> AI + {t.feedbackFrom} {fb.publishedBy ?? (lang === 'zh' ? '教师' : 'Teacher')}
                              </span>
                              <span className="text-[0.6875rem] text-gray-400">{fb.publishedAt?.split('T')[0]}</span>
                            </div>
                            <div className="p-3 space-y-2">
                              <p className="text-xs text-gray-700 dark:text-slate-300 leading-relaxed">{fb.studentSummary}</p>
                              {fb.teacherNote && (
                                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/10">
                                  <p className="text-[0.6875rem] text-gray-500 dark:text-slate-400 italic">
                                    <MessageSquare size={11} className="inline mr-1" />
                                    {fb.teacherNote}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Published feedbacks for teacher too */}
                  {isStaff && publishedFeedbacks.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[0.6875rem] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                        {t.publishedFeedbacks}
                      </div>
                      {publishedFeedbacks.map(fb => (
                        <div key={fb.id} className="text-xs bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-lg p-2.5">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-gray-600 dark:text-slate-300">{fb.publishedBy}</span>
                            <span className="text-gray-400 text-[0.6875rem]">{fb.publishedAt?.split('T')[0]}</span>
                          </div>
                          <p className="text-gray-600 dark:text-slate-400 leading-relaxed line-clamp-3">{fb.studentSummary}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Tiny inline icon to avoid extra imports
const MousePointerIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-slate-600">
    <path d="M5 3l14 9-7 1-3 7z" />
  </svg>
);

export default AISidePanel;
