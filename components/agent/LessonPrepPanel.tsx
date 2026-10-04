import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import RemixIcon from '../RemixIcon';
import {
  lessonPlans,
  type LessonPlanContentType,
  type LessonPlanStreamEvent,
  type ClassroomContextType,
  type LessonPlanSummary,
  apiFileUrl,
} from '../../services/apiClient';
import AgentRunTrace from './AgentRunTrace';

// ---------------------------------------------------------------------------
// Types & Props
// ---------------------------------------------------------------------------

interface LessonPrepPanelProps {
  lang: 'zh' | 'en';
  courses: { id: string; title: string }[];
  selectedCourseId: string;
  onCourseChange: (id: string) => void;
  onSwitchToChat: () => void;
  providerId: string;
  model: string;
}

type PlanType = 'full_plan' | 'resources' | 'activities' | 'analysis';
type Phase = 'form' | 'generating' | 'result';
type SectionKey = 'objectives' | 'activities' | 'discussion_prompts' | 'assessment' | 'ai_triggers' | 'resources' | 'reflection';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KB_PRINCIPLES = [
  { id: 'real-ideas', zh: '真实想法', en: 'Real ideas' },
  { id: 'improvable', zh: '可改进的想法', en: 'Improvable ideas' },
  { id: 'diversity', zh: '想法多样性', en: 'Idea diversity' },
  { id: 'rise-above', zh: '升华综合', en: 'Rise above' },
  { id: 'agency', zh: '认知责任', en: 'Epistemic agency' },
  { id: 'community', zh: '社区知识', en: 'Community knowledge' },
];

const PLAN_TYPE_CONFIG: Record<PlanType, { icon: string; bg: string; iconColor: string; zh: string; en: string; descZh: string; descEn: string }> = {
  full_plan: {
    icon: 'file-text-line', bg: 'bg-[#000080]/[0.06] dark:bg-[#4169E1]/[0.1]',
    iconColor: 'text-[#000080] dark:text-[#93AAFD]',
    zh: '完整教案', en: 'Full plan', descZh: '教学目标、活动、量规', descEn: 'Objectives, activities, rubric',
  },
  resources: {
    icon: 'book-2-line', bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    zh: '教学资源', en: 'Resources', descZh: '工作表、提示卡、量规', descEn: 'Worksheets, prompts, rubrics',
  },
  activities: {
    icon: 'lightbulb-line', bg: 'bg-amber-50 dark:bg-amber-900/20',
    iconColor: 'text-amber-600 dark:text-amber-400',
    zh: '探究活动', en: 'Activities', descZh: '探究任务、小组协作', descEn: 'Inquiry tasks, group work',
  },
  analysis: {
    icon: 'search-eye-line', bg: 'bg-violet-50 dark:bg-violet-900/20',
    iconColor: 'text-violet-600 dark:text-violet-400',
    zh: '分析讨论', en: 'Analysis', descZh: '分析讨论、优化设计', descEn: 'Analyze & optimize',
  },
};

const inputCls = 'h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:border-[#000080] focus:outline-none focus:ring-1 focus:ring-[#000080]/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 transition-colors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

async function readSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: LessonPlanStreamEvent | '[DONE]') => void,
) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') { onEvent('[DONE]'); continue; }
      try { onEvent(JSON.parse(data) as LessonPlanStreamEvent); } catch { /* skip */ }
    }
  }
}

// Editable text field used throughout canvas
const EditField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
}> = ({ value, onChange, multiline, placeholder, className = '' }) => {
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className={`w-full rounded-lg border border-zinc-200 bg-zinc-50/50 px-2.5 py-1.5 text-sm leading-relaxed text-zinc-700 focus:border-[#000080] focus:outline-none focus:ring-1 focus:ring-[#000080]/20 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300 transition-colors resize-y ${className}`}
      />
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-lg border border-zinc-200 bg-zinc-50/50 px-2.5 py-1.5 text-sm text-zinc-700 focus:border-[#000080] focus:outline-none focus:ring-1 focus:ring-[#000080]/20 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300 transition-colors ${className}`}
    />
  );
};

// List editor: items with add/remove
const ListEditor: React.FC<{
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  zh: boolean;
}> = ({ items, onChange, placeholder, zh }) => (
  <div className="space-y-1.5">
    {items.map((item, i) => (
      <div key={i} className="flex items-center gap-1.5">
        <input
          value={item}
          onChange={(e) => { const next = [...items]; next[i] = e.target.value; onChange(next); }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50/50 px-2.5 py-1 text-sm text-zinc-700 focus:border-[#000080] focus:outline-none dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300 transition-colors"
        />
        <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors">
          <RemixIcon name="close-line" size={12} />
        </button>
      </div>
    ))}
    <button
      onClick={() => onChange([...items, ''])}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium text-[#000080] hover:bg-[#000080]/[0.04] dark:text-[#93AAFD] dark:hover:bg-[#4169E1]/[0.08] transition-colors"
    >
      <RemixIcon name="add-line" size={12} />
      {zh ? '添加' : 'Add'}
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LessonPrepPanel: React.FC<LessonPrepPanelProps> = ({
  lang, courses, selectedCourseId, onCourseChange, onSwitchToChat,
  providerId, model,
}) => {
  const zh = lang === 'zh';

  // Form state
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState('45');
  const [context, setContext] = useState('');
  const [selectedPrinciples, setSelectedPrinciples] = useState<Set<string>>(new Set(['real-ideas', 'improvable']));
  const [planType, setPlanType] = useState<PlanType>('full_plan');

  // Generation state
  const [phase, setPhase] = useState<Phase>('form');
  const [streamingText, setStreamingText] = useState('');
  const [classroomCtx, setClassroomCtx] = useState<ClassroomContextType | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<LessonPlanContentType | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const abortRef = useRef(false);

  // Canvas editing state
  const [editedPlan, setEditedPlan] = useState<LessonPlanContentType | null>(null);
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<LessonPlanSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Export state
  const [exporting, setExporting] = useState(false);

  const courseTitle = courses.find((c) => c.id === selectedCourseId)?.title || '';

  // Sync editedPlan when generatedPlan changes
  useEffect(() => {
    if (generatedPlan) {
      setEditedPlan(deepClone(generatedPlan));
      setIsDirty(false);
    }
  }, [generatedPlan]);

  const togglePrinciple = (id: string) => {
    setSelectedPrinciples((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Update a section in the edited plan
  const updateSection = useCallback(<K extends SectionKey>(key: K, value: LessonPlanContentType[K]) => {
    setEditedPlan((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
    setIsDirty(true);
  }, []);

  // ── Save ─────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!selectedCourseId || !planId || !editedPlan) return;
    setSaving(true);
    setSaveMsg('');
    try {
      await lessonPlans.update(selectedCourseId, planId, { content: editedPlan });
      setGeneratedPlan(deepClone(editedPlan));
      setIsDirty(false);
      setSaveMsg(zh ? '已保存' : 'Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch {
      setSaveMsg(zh ? '保存失败' : 'Save failed');
    }
    setSaving(false);
  }, [selectedCourseId, planId, editedPlan, zh]);

  // ── Generate ────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!selectedCourseId || !providerId || !model) return;
    abortRef.current = false;
    setPhase('generating');
    setStreamingText('');
    setGeneratedPlan(null);
    setEditedPlan(null);
    setGenError(null);
    setRunId(null);
    setClassroomCtx(null);
    setEditingSection(null);
    setIsDirty(false);
    setStatusMsg(zh ? '正在收集课堂数据...' : 'Gathering classroom data...');

    try {
      const reader = await lessonPlans.generate(selectedCourseId, {
        plan_type: planType,
        topic: topic || undefined,
        duration_minutes: parseInt(duration, 10),
        kb_principles: [...selectedPrinciples],
        context_notes: context || undefined,
        provider_id: providerId,
        model,
        course_title: courseTitle,
      });

      await readSSE(reader, (event) => {
        if (abortRef.current) return;
        if (event === '[DONE]') return;
        switch (event.type) {
          case 'plan_created': setPlanId(event.planId); if (event.runId) setRunId(event.runId); break;
          case 'context_ready':
            setClassroomCtx(event.context);
            setStatusMsg(zh ? '课堂数据已加载，正在生成教案...' : 'Data loaded, generating plan...');
            break;
          case 'token': setStreamingText((prev) => prev + event.content); break;
          case 'done':
            setGeneratedPlan(event.plan);
            setPlanId(event.planId);
            if (event.runId) setRunId(event.runId);
            setPhase('result');
            break;
          case 'error':
            setGenError(event.error);
            setPhase('result');
            break;
        }
      });
      if (!abortRef.current && phase !== 'result') setPhase('result');
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : 'Network error');
      setPhase('result');
    }
  }, [selectedCourseId, providerId, model, planType, topic, duration, context, selectedPrinciples, courseTitle, zh]);

  // ── History ──────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!selectedCourseId) return;
    setHistoryLoading(true);
    try {
      const { plans } = await lessonPlans.list(selectedCourseId);
      setHistoryList(plans);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, [selectedCourseId]);

  const loadPlan = useCallback(async (id: string) => {
    if (!selectedCourseId) return;
    try {
      const { plan } = await lessonPlans.get(selectedCourseId, id);
      setGeneratedPlan(plan.content);
      setPlanId(plan.id);
      setShowHistory(false);
      setPhase('result');
    } catch { /* ignore */ }
  }, [selectedCourseId]);

  const handleExport = useCallback(async () => {
    if (!selectedCourseId || !planId) return;
    setExporting(true);
    try {
      const result = await lessonPlans.export(selectedCourseId, planId, lang);
      // 用 <a> 而不是 window.open：await 之后再 open 会被拦截弹窗；
      // 地址必须指向后端域并带 token，相对路径会落到前端首页。
      const a = document.createElement('a');
      a.href = apiFileUrl(result.downloadUrl);
      a.download = result.fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch { /* ignore */ }
    setExporting(false);
  }, [selectedCourseId, planId, lang]);

  const handleBack = () => {
    setPhase('form');
    setStreamingText('');
    setGeneratedPlan(null);
    setEditedPlan(null);
    setGenError(null);
    setPlanId(null);
    setEditingSection(null);
    setIsDirty(false);
  };

  const toggleEdit = (section: SectionKey) => {
    setEditingSection((prev) => prev === section ? null : section);
  };

  // ── Render ──────────────────────────────────────────────────

  // === Generating phase ===
  if (phase === 'generating') {
    return (
      <div className="flex h-full flex-col px-5 py-5 sm:px-7">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-2 w-2 animate-pulse rounded-full bg-[#000080] dark:bg-[#4169E1]" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{statusMsg}</span>
        </div>
        {runId && (
          <div className="mb-4">
            <AgentRunTrace runId={runId} lang={lang} compact />
          </div>
        )}
        {classroomCtx && (
          <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-2 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              {zh ? '课堂数据概览' : 'Classroom data'}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
              <span>{zh ? '笔记' : 'Notes'}: {classroomCtx.participation.totalNotes}</span>
              <span>{zh ? '参与者' : 'Contributors'}: {classroomCtx.participation.uniqueAuthors}</span>
              {classroomCtx.triggers.length > 0 && <span>{zh ? '触发器' : 'Triggers'}: {classroomCtx.triggers.length}</span>}
              {classroomCtx.learnerProfiles.total > 0 && <span>{zh ? '学生' : 'Students'}: {classroomCtx.learnerProfiles.total}</span>}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {streamingText || (zh ? '等待生成...' : 'Waiting...')}
            <span className="animate-pulse">|</span>
          </pre>
        </div>
      </div>
    );
  }

  // === Result phase — Canvas mode ===
  if (phase === 'result' && editedPlan) {
    return (
      <div className="flex h-full flex-col">
        {/* Canvas toolbar */}
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button onClick={handleBack} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <RemixIcon name="arrow-left-line" size={16} className="text-zinc-500" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {topic || courseTitle} — {PLAN_TYPE_CONFIG[planType][zh ? 'zh' : 'en']}
          </h2>

          {/* Save indicator */}
          {saveMsg && (
            <span className={`text-xs font-medium ${saveMsg.includes('失败') || saveMsg.includes('failed') ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {saveMsg}
            </span>
          )}

          {isDirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-[#000080] px-3 text-xs font-medium text-white transition-colors hover:bg-[#000080]/90 disabled:opacity-50 dark:bg-[#4169E1] dark:hover:bg-[#4169E1]/90"
            >
              <RemixIcon name={saving ? 'loader-4-line' : 'save-line'} size={13} className={saving ? 'animate-spin' : ''} />
              {saving ? (zh ? '保存中...' : 'Saving...') : (zh ? '保存' : 'Save')}
            </button>
          )}

          <button
            onClick={handleExport}
            disabled={!planId || exporting}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <RemixIcon name="file-word-line" size={13} />
            {zh ? '导出' : 'Export'}
          </button>
          <button
            onClick={handleGenerate}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <RemixIcon name="refresh-line" size={13} />
            {zh ? '重新生成' : 'Regen'}
          </button>
        </div>

        {runId && (
          <div className="mx-5 mt-3">
            <AgentRunTrace runId={runId} lang={lang} />
          </div>
        )}

        {genError && (
          <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {genError}
          </div>
        )}

        {/* Canvas content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="mx-auto max-w-3xl space-y-4">
            <CanvasObjectives data={editedPlan.objectives} editing={editingSection === 'objectives'} onToggle={() => toggleEdit('objectives')} onChange={(v) => updateSection('objectives', v)} zh={zh} />
            <CanvasActivities data={editedPlan.activities} editing={editingSection === 'activities'} onToggle={() => toggleEdit('activities')} onChange={(v) => updateSection('activities', v)} zh={zh} />
            <CanvasDiscussion data={editedPlan.discussion_prompts} editing={editingSection === 'discussion_prompts'} onToggle={() => toggleEdit('discussion_prompts')} onChange={(v) => updateSection('discussion_prompts', v)} zh={zh} />
            <CanvasAssessment data={editedPlan.assessment} editing={editingSection === 'assessment'} onToggle={() => toggleEdit('assessment')} onChange={(v) => updateSection('assessment', v)} zh={zh} />
            <CanvasTriggers data={editedPlan.ai_triggers} editing={editingSection === 'ai_triggers'} onToggle={() => toggleEdit('ai_triggers')} onChange={(v) => updateSection('ai_triggers', v)} zh={zh} />
            <CanvasResources data={editedPlan.resources} editing={editingSection === 'resources'} onToggle={() => toggleEdit('resources')} onChange={(v) => updateSection('resources', v)} zh={zh} />
            <CanvasReflection data={editedPlan.reflection} editing={editingSection === 'reflection'} onToggle={() => toggleEdit('reflection')} onChange={(v) => updateSection('reflection', v)} zh={zh} />
          </div>
        </div>

        {/* Floating unsaved indicator */}
        {isDirty && (
          <div className="flex items-center justify-center gap-3 border-t border-amber-200 bg-amber-50 px-5 py-2 dark:border-amber-900/30 dark:bg-amber-950/20">
            <RemixIcon name="error-warning-line" size={14} className="text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{zh ? '有未保存的修改' : 'Unsaved changes'}</span>
            <button onClick={handleSave} disabled={saving} className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
              {zh ? '保存' : 'Save'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Result phase with error but no plan
  if (phase === 'result') {
    return (
      <div className="flex h-full flex-col px-5 py-5 sm:px-7">
        <div className="mb-4 flex items-center gap-2">
          <button onClick={handleBack} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <RemixIcon name="arrow-left-line" size={16} className="text-zinc-500" />
          </button>
          <h2 className="flex-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">{zh ? '生成结果' : 'Result'}</h2>
          <button onClick={handleGenerate} className="flex h-8 items-center gap-1.5 rounded-lg bg-[#000080] px-3 text-xs font-medium text-white dark:bg-[#4169E1]">
            <RemixIcon name="refresh-line" size={13} />
            {zh ? '重试' : 'Retry'}
          </button>
        </div>
        {genError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{genError}</div>
        )}
        {streamingText && !genError && (
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <pre className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{streamingText}</pre>
          </div>
        )}
      </div>
    );
  }

  // === Form phase (default) ===
  const smartPrompts = [
    { icon: 'question-line', label: zh ? '生成问题链' : 'Question chain', prompt: zh ? '为本节课设计一条探究问题链' : 'Design an inquiry question chain' },
    { icon: 'stack-line', label: zh ? '加入分层任务' : 'Tiered tasks', prompt: zh ? '设计分层探究任务，适配不同水平学生' : 'Design tiered tasks for different levels' },
    { icon: 'robot-2-line', label: zh ? '融入 AI 支架' : 'AI scaffolds', prompt: zh ? '在教学设计中融入 AI 辅助脚手架' : 'Integrate AI scaffolding in the design' },
  ];

  return (
    <div className="flex h-full flex-col px-8 py-6 lg:px-12">
      {/* ── Title + mascot ──────────────────────────────── */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {zh ? '备课助手' : 'Lesson Prep'}
          </h1>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-gray-500 dark:text-gray-400">
            {zh ? 'AI 智能体辅助生成高质量教学设计与课堂活动方案' : 'AI-powered lesson design and classroom activity planning'}
          </p>
        </div>
        <img src="/assets/Preparation Assistant.png" alt="" className="hidden h-28 w-auto self-end object-contain lg:block" />
      </div>

      {/* ── Plan type cards ─────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {(Object.entries(PLAN_TYPE_CONFIG) as [PlanType, typeof PLAN_TYPE_CONFIG['full_plan']][]).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setPlanType(key)}
            className={`group relative flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all active:scale-[0.98] ${
              planType === key
                ? 'border-[#000080]/40 bg-[#000080]/[0.03] shadow-sm dark:border-[#4169E1]/40 dark:bg-[#4169E1]/[0.06]'
                : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700'
            }`}
          >
            {planType === key && (
              <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                <RemixIcon name="check-line" size={12} />
              </div>
            )}
            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${cfg.bg}`}>
              <RemixIcon name={cfg.icon} size={18} className={cfg.iconColor} />
            </div>
            <div className="min-w-0">
              <div className="text-[0.8125rem] font-semibold text-zinc-800 dark:text-zinc-200">{zh ? cfg.zh : cfg.en}</div>
              <div className="truncate text-[0.6875rem] text-zinc-400 dark:text-zinc-500">{zh ? cfg.descZh : cfg.descEn}</div>
            </div>
          </button>
        ))}
      </div>

      {/* ── Form + Preview split ───────────────────────── */}
      <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* Left: Form */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[0.8125rem] font-medium text-zinc-600 dark:text-zinc-400">{zh ? '课程' : 'Course'}</span>
              <select value={selectedCourseId} onChange={(e) => onCourseChange(e.target.value)} className={inputCls}>
                <option value="">{zh ? '选择课程' : 'Select course'}</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[0.8125rem] font-medium text-zinc-600 dark:text-zinc-400">{zh ? '时长' : 'Duration'}</span>
              <select value={duration} onChange={(e) => setDuration(e.target.value)} className={inputCls}>
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">60 min</option>
                <option value="90">90 min</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium text-zinc-600 dark:text-zinc-400">{zh ? '探究主题' : 'Inquiry topic'}</span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={zh ? '例如：生态系统如何维持平衡？' : 'e.g. How do ecosystems maintain balance?'} className={`${inputCls} placeholder:text-zinc-400 dark:placeholder:text-zinc-600`} />
          </label>
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-[0.8125rem] font-medium text-zinc-600 dark:text-zinc-400">{zh ? 'KB 原则' : 'KB principles'}</span>
              <RemixIcon name="information-line" size={13} className="text-zinc-300 dark:text-zinc-600" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {KB_PRINCIPLES.map((p) => (
                <button key={p.id} onClick={() => togglePrinciple(p.id)} className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[0.75rem] font-medium transition-all active:scale-[0.97] ${
                  selectedPrinciples.has(p.id)
                    ? 'bg-[#000080]/[0.08] text-[#000080] dark:bg-[#4169E1]/[0.15] dark:text-[#93AAFD]'
                    : 'border border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'
                }`}>
                  {selectedPrinciples.has(p.id) && <RemixIcon name="check-line" size={12} />}
                  {zh ? p.zh : p.en}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-1 min-h-0 flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium text-zinc-600 dark:text-zinc-400">{zh ? '补充说明' : 'Context'}</span>
            <div className="relative flex-1 min-h-0 flex flex-col">
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder={zh ? '学生基础、学习目标、前置知识...' : 'Student levels, goals, prior knowledge...'}
                maxLength={1000}
                className="flex-1 min-h-[60px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-zinc-700 placeholder:text-zinc-400 focus:border-[#000080] focus:outline-none focus:ring-1 focus:ring-[#000080]/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:placeholder:text-zinc-600 transition-colors"
              />
              <span className="absolute bottom-2 right-3 text-[0.6875rem] text-zinc-300 dark:text-zinc-600">{context.length}/1000</span>
            </div>
          </label>
          {/* Smart prompts */}
          <div className="rounded-xl border border-zinc-200/60 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="mb-2 flex items-center gap-2">
              <RemixIcon name="sparkling-2-fill" size={13} className="text-[#000080] dark:text-[#93AAFD]" />
              <span className="text-[0.75rem] font-semibold text-zinc-700 dark:text-zinc-300">{zh ? '智能提示' : 'Smart prompts'}</span>
              <span className="text-[0.6875rem] text-zinc-400 dark:text-zinc-500">{zh ? '让 AI 更懂你的课堂' : 'Help AI understand your class'}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {smartPrompts.map((sp, i) => (
                <button
                  key={i}
                  onClick={() => setContext(prev => prev ? `${prev}\n${sp.prompt}` : sp.prompt)}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[0.75rem] font-medium text-zinc-600 transition-all hover:border-zinc-300 hover:shadow-sm active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600"
                >
                  <RemixIcon name={sp.icon} size={14} className="flex-shrink-0 text-zinc-400 dark:text-zinc-500" />
                  {sp.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="flex min-h-0 flex-col gap-4">
          {showHistory ? (
            <HistoryPanel plans={historyList} loading={historyLoading} zh={zh} onSelect={loadPlan} onClose={() => setShowHistory(false)} />
          ) : (
            <PreviewCard zh={zh} courseTitle={courseTitle} topic={topic} duration={duration} principleNames={KB_PRINCIPLES.filter((p) => selectedPrinciples.has(p.id)).map((p) => zh ? p.zh : p.en)} planType={planType} hasCourse={!!selectedCourseId} />
          )}
        </div>
      </div>

      {/* ── Bottom bar ──────────────────────────────── */}
      <div className="mt-4 flex flex-shrink-0 items-center gap-3">
        <button onClick={handleGenerate} disabled={!selectedCourseId || !providerId || !model} className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#000080] px-6 text-[0.875rem] font-semibold text-white shadow-sm transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-40 dark:bg-[#4169E1] dark:hover:bg-[#4169E1]/90 lg:max-w-sm">
          <RemixIcon name="sparkling-2-fill" size={16} />
          {zh ? '生成教案' : 'Generate plan'}
        </button>
        <button onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 px-4 text-[0.8125rem] font-medium text-zinc-600 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
          <RemixIcon name="history-line" size={15} />
          {zh ? '历史' : 'History'}
        </button>
        <button onClick={onSwitchToChat} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 px-4 text-[0.8125rem] font-medium text-zinc-600 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
          <RemixIcon name="chat-3-line" size={15} />
          {zh ? '继续对话' : 'Chat'}
        </button>
      </div>
    </div>
  );
};

export default LessonPrepPanel;

// ---------------------------------------------------------------------------
// Canvas section cards (view + edit)
// ---------------------------------------------------------------------------

interface CanvasSectionProps<T> {
  data: T | undefined;
  editing: boolean;
  onToggle: () => void;
  onChange: (v: T) => void;
  zh: boolean;
}

const SectionWrapper: React.FC<{
  icon: string;
  title: string;
  iconColor?: string;
  editing: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  visible: boolean;
}> = ({ icon, title, iconColor, editing, onToggle, children, visible }) => {
  if (!visible) return null;
  return (
    <div className={`group rounded-xl border bg-white p-4 transition-all ${editing ? 'border-[#000080]/30 ring-1 ring-[#000080]/10 dark:border-[#4169E1]/30 dark:ring-[#4169E1]/10' : 'border-zinc-200 dark:border-zinc-800'} dark:bg-zinc-950`}>
      <div className="mb-3 flex items-center gap-2">
        <RemixIcon name={icon} size={16} className={iconColor ?? 'text-[#000080] dark:text-[#93AAFD]'} />
        <h3 className="flex-1 text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">{title}</h3>
        <button
          onClick={onToggle}
          className={`flex h-7 items-center gap-1 rounded-md px-2 text-[0.6875rem] font-medium transition-colors ${
            editing
              ? 'bg-[#000080]/[0.06] text-[#000080] dark:bg-[#4169E1]/[0.1] dark:text-[#93AAFD]'
              : 'text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800'
          }`}
        >
          <RemixIcon name={editing ? 'check-line' : 'pencil-line'} size={12} />
          {editing ? '完成' : '编辑'}
        </button>
      </div>
      {children}
    </div>
  );
};

// ── Objectives ──────────────────────────────────────────────

const CanvasObjectives: React.FC<CanvasSectionProps<LessonPlanContentType['objectives']>> = ({ data, editing, onToggle, onChange, zh }) => {
  if (!data) return null;
  return (
    <SectionWrapper icon="flag-line" title={zh ? '教学目标' : 'Teaching Objectives'} editing={editing} onToggle={onToggle} visible>
      {editing ? (
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">{zh ? '目标' : 'Goals'}</div>
            <ListEditor items={data.teaching_goals ?? []} onChange={(v) => onChange({ ...data, teaching_goals: v })} placeholder={zh ? '输入教学目标...' : 'Teaching goal...'} zh={zh} />
          </div>
          <div>
            <div className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">{zh ? '重点' : 'Key points'}</div>
            <ListEditor items={data.key_points ?? []} onChange={(v) => onChange({ ...data, key_points: v })} placeholder={zh ? '教学重点...' : 'Key point...'} zh={zh} />
          </div>
          <div>
            <div className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">{zh ? '难点' : 'Difficulties'}</div>
            <ListEditor items={data.difficulties ?? []} onChange={(v) => onChange({ ...data, difficulties: v })} placeholder={zh ? '教学难点...' : 'Difficulty...'} zh={zh} />
          </div>
        </div>
      ) : (
        <>
          {data.teaching_goals?.length > 0 && (
            <ul className="mb-3 space-y-1">
              {data.teaching_goals.map((g, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <RemixIcon name="checkbox-circle-line" size={14} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                  {g}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1.5">
            {data.key_points?.map((p, i) => <span key={`k${i}`} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[0.6875rem] font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">{zh ? '重点' : 'Key'}: {p}</span>)}
            {data.difficulties?.map((d, i) => <span key={`d${i}`} className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[0.6875rem] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">{zh ? '难点' : 'Hard'}: {d}</span>)}
          </div>
        </>
      )}
    </SectionWrapper>
  );
};

// ── Activities ──────────────────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  warm_up: 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400',
  explore: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
  discuss: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400',
  reflect: 'bg-violet-100 text-violet-800 dark:bg-violet-900/20 dark:text-violet-400',
  assess: 'bg-rose-100 text-rose-800 dark:bg-rose-900/20 dark:text-rose-400',
};

type Activity = NonNullable<LessonPlanContentType['activities']>[number];

const CanvasActivities: React.FC<CanvasSectionProps<LessonPlanContentType['activities']>> = ({ data, editing, onToggle, onChange, zh }) => {
  if (!data?.length) return null;

  const updateItem = (idx: number, patch: Partial<Activity>) => {
    const next = data.map((a, i) => i === idx ? { ...a, ...patch } : a);
    onChange(next);
  };

  const removeItem = (idx: number) => onChange(data.filter((_, i) => i !== idx));

  const addItem = () => onChange([...data, {
    title: zh ? '新活动' : 'New activity', duration_min: 10, phase: 'explore',
    description: '', teacher_actions: [], student_actions: [], kb_principle: '', scaffolding_notes: '',
  }]);

  return (
    <SectionWrapper icon="route-line" title={zh ? '活动设计' : 'Activities'} iconColor="text-amber-600 dark:text-amber-400" editing={editing} onToggle={onToggle} visible>
      <div className="relative ml-3 space-y-4 border-l-2 border-zinc-200 pl-5 dark:border-zinc-700">
        {data.map((act, i) => (
          <div key={i} className="relative">
            <div className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-[#000080] bg-white dark:border-[#4169E1] dark:bg-zinc-950" />
            {editing ? (
              <div className="space-y-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <EditField value={act.title} onChange={(v) => updateItem(i, { title: v })} className="flex-1 font-medium" />
                  <input type="number" value={act.duration_min} onChange={(e) => updateItem(i, { duration_min: parseInt(e.target.value, 10) || 0 })} className="w-16 rounded-lg border border-zinc-200 bg-zinc-50/50 px-2 py-1 text-center text-xs dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" />
                  <select value={act.phase} onChange={(e) => updateItem(i, { phase: e.target.value })} className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                    <option value="warm_up">warm_up</option><option value="explore">explore</option><option value="discuss">discuss</option><option value="reflect">reflect</option><option value="assess">assess</option>
                  </select>
                  <button onClick={() => removeItem(i)} className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"><RemixIcon name="delete-bin-line" size={12} /></button>
                </div>
                <EditField value={act.description} onChange={(v) => updateItem(i, { description: v })} multiline placeholder={zh ? '活动描述...' : 'Description...'} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[0.6875rem] font-medium text-zinc-400">{zh ? '教师行为' : 'Teacher'}</div>
                    <ListEditor items={act.teacher_actions ?? []} onChange={(v) => updateItem(i, { teacher_actions: v })} zh={zh} />
                  </div>
                  <div>
                    <div className="mb-1 text-[0.6875rem] font-medium text-zinc-400">{zh ? '学生行为' : 'Student'}</div>
                    <ListEditor items={act.student_actions ?? []} onChange={(v) => updateItem(i, { student_actions: v })} zh={zh} />
                  </div>
                </div>
                <EditField value={act.kb_principle} onChange={(v) => updateItem(i, { kb_principle: v })} placeholder="KB principle" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{act.title}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[0.6875rem] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{act.duration_min}{zh ? '分钟' : 'min'}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${PHASE_COLORS[act.phase] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>{act.phase}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{act.description}</p>
                {act.teacher_actions?.length > 0 && <div className="mt-2"><span className="text-[0.6875rem] font-medium text-zinc-400">{zh ? '教师' : 'Teacher'}:</span><ul className="mt-0.5 space-y-0.5">{act.teacher_actions.map((a, j) => <li key={j} className="text-xs text-zinc-600 dark:text-zinc-400">→ {a}</li>)}</ul></div>}
                {act.student_actions?.length > 0 && <div className="mt-1.5"><span className="text-[0.6875rem] font-medium text-zinc-400">{zh ? '学生' : 'Student'}:</span><ul className="mt-0.5 space-y-0.5">{act.student_actions.map((a, j) => <li key={j} className="text-xs text-zinc-600 dark:text-zinc-400">→ {a}</li>)}</ul></div>}
                {act.kb_principle && <span className="mt-2 inline-block rounded-full bg-[#000080]/[0.06] px-2 py-0.5 text-[0.6875rem] font-medium text-[#000080] dark:bg-[#4169E1]/[0.12] dark:text-[#93AAFD]">KB: {act.kb_principle}</span>}
              </>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <button onClick={addItem} className="mt-3 flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium text-[#000080] hover:bg-[#000080]/[0.04] dark:text-[#93AAFD] dark:hover:bg-[#4169E1]/[0.08] transition-colors">
          <RemixIcon name="add-line" size={12} />
          {zh ? '添加活动' : 'Add activity'}
        </button>
      )}
    </SectionWrapper>
  );
};

// ── Discussion ──────────────────────────────────────────────

type DiscPrompt = NonNullable<LessonPlanContentType['discussion_prompts']>[number];

const CanvasDiscussion: React.FC<CanvasSectionProps<LessonPlanContentType['discussion_prompts']>> = ({ data, editing, onToggle, onChange, zh }) => {
  if (!data?.length && !editing) return null;
  const items = data ?? [];
  const depthColor: Record<string, string> = {
    surface: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    moderate: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    deep: 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400',
  };

  const updateItem = (idx: number, patch: Partial<DiscPrompt>) => onChange(items.map((p, i) => i === idx ? { ...p, ...patch } : p));
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const addItem = () => onChange([...items, { prompt: '', purpose: '', expected_depth: 'moderate' }]);

  return (
    <SectionWrapper icon="question-line" title={zh ? '讨论引导问题' : 'Discussion Prompts'} iconColor="text-emerald-600 dark:text-emerald-400" editing={editing} onToggle={onToggle} visible>
      <div className="space-y-2.5">
        {items.map((p, i) => (
          <div key={i} className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
            {editing ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <EditField value={p.prompt} onChange={(v) => updateItem(i, { prompt: v })} placeholder={zh ? '讨论问题...' : 'Discussion prompt...'} className="flex-1" />
                  <select value={p.expected_depth} onChange={(e) => updateItem(i, { expected_depth: e.target.value })} className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                    <option value="surface">surface</option><option value="moderate">moderate</option><option value="deep">deep</option>
                  </select>
                  <button onClick={() => removeItem(i)} className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"><RemixIcon name="close-line" size={12} /></button>
                </div>
                <EditField value={p.purpose} onChange={(v) => updateItem(i, { purpose: v })} placeholder={zh ? '目的...' : 'Purpose...'} />
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#000080]/[0.08] text-[0.625rem] font-bold text-[#000080] dark:bg-[#4169E1]/[0.15] dark:text-[#93AAFD]">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{p.prompt}</p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{zh ? '目的' : 'Purpose'}: {p.purpose}</p>
                </div>
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${depthColor[p.expected_depth] ?? depthColor.surface}`}>{p.expected_depth}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <button onClick={addItem} className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium text-[#000080] hover:bg-[#000080]/[0.04] dark:text-[#93AAFD] transition-colors">
          <RemixIcon name="add-line" size={12} />{zh ? '添加问题' : 'Add prompt'}
        </button>
      )}
    </SectionWrapper>
  );
};

// ── Assessment ──────────────────────────────────────────────

const CanvasAssessment: React.FC<CanvasSectionProps<LessonPlanContentType['assessment']>> = ({ data, editing, onToggle, onChange, zh }) => {
  if (!data) return null;

  const updateRubric = (idx: number, patch: Partial<NonNullable<LessonPlanContentType['assessment']>['rubric'][number]>) => {
    const rubric = (data.rubric ?? []).map((r, i) => i === idx ? { ...r, ...patch } : r);
    onChange({ ...data, rubric });
  };

  return (
    <SectionWrapper icon="bar-chart-box-line" title={zh ? '评估量规' : 'Assessment Rubric'} iconColor="text-rose-600 dark:text-rose-400" editing={editing} onToggle={onToggle} visible>
      {editing ? (
        <div className="space-y-3">
          {(data.rubric ?? []).map((r, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
              <EditField value={r.dimension} onChange={(v) => updateRubric(i, { dimension: v })} placeholder={zh ? '维度' : 'Dimension'} />
              <EditField value={r.excellent} onChange={(v) => updateRubric(i, { excellent: v })} placeholder={zh ? '优秀' : 'Excellent'} />
              <EditField value={r.good} onChange={(v) => updateRubric(i, { good: v })} placeholder={zh ? '良好' : 'Good'} />
              <EditField value={r.developing} onChange={(v) => updateRubric(i, { developing: v })} placeholder={zh ? '发展中' : 'Developing'} />
            </div>
          ))}
          <button onClick={() => onChange({ ...data, rubric: [...(data.rubric ?? []), { dimension: '', excellent: '', good: '', developing: '' }] })} className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium text-[#000080] hover:bg-[#000080]/[0.04] dark:text-[#93AAFD] transition-colors">
            <RemixIcon name="add-line" size={12} />{zh ? '添加维度' : 'Add dimension'}
          </button>
          <div className="mt-2">
            <div className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">{zh ? '形成性评估' : 'Formative checks'}</div>
            <ListEditor items={data.formative_checks ?? []} onChange={(v) => onChange({ ...data, formative_checks: v })} zh={zh} />
          </div>
        </div>
      ) : (
        <>
          {(data.rubric ?? []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="py-2 pr-3 text-left font-medium text-zinc-500">{zh ? '维度' : 'Dimension'}</th>
                  <th className="py-2 pr-3 text-left font-medium text-emerald-600 dark:text-emerald-400">{zh ? '优秀' : 'Excellent'}</th>
                  <th className="py-2 pr-3 text-left font-medium text-blue-600 dark:text-blue-400">{zh ? '良好' : 'Good'}</th>
                  <th className="py-2 text-left font-medium text-amber-600 dark:text-amber-400">{zh ? '发展中' : 'Developing'}</th>
                </tr></thead>
                <tbody>{data.rubric.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-50 last:border-0 dark:border-zinc-900">
                    <td className="py-2 pr-3 font-medium text-zinc-700 dark:text-zinc-300">{r.dimension}</td>
                    <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">{r.excellent}</td>
                    <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">{r.good}</td>
                    <td className="py-2 text-zinc-600 dark:text-zinc-400">{r.developing}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {(data.formative_checks ?? []).length > 0 && (
            <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <div className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">{zh ? '形成性评估' : 'Formative checks'}</div>
              <ul className="space-y-1">{data.formative_checks.map((c, i) => <li key={i} className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400"><RemixIcon name="checkbox-line" size={12} className="mt-0.5 flex-shrink-0 text-zinc-400" />{c}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </SectionWrapper>
  );
};

// ── AI Triggers ─────────────────────────────────────────────

const TRIGGER_COLORS: Record<string, string> = {
  T1: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  T2: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  T3: 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400',
  T4: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  T5: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  T6: 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400',
};

type Trigger = NonNullable<LessonPlanContentType['ai_triggers']>[number];

const CanvasTriggers: React.FC<CanvasSectionProps<LessonPlanContentType['ai_triggers']>> = ({ data, editing, onToggle, onChange, zh }) => {
  if (!data?.length && !editing) return null;
  const items = data ?? [];
  const updateItem = (idx: number, patch: Partial<Trigger>) => onChange(items.map((t, i) => i === idx ? { ...t, ...patch } : t));
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const addItem = () => onChange([...items, { type: 'T5', when: '', action: '', example_feedback: '' }]);

  return (
    <SectionWrapper icon="robot-2-line" title={zh ? 'AI 介入计划' : 'AI Intervention Plan'} iconColor="text-violet-600 dark:text-violet-400" editing={editing} onToggle={onToggle} visible>
      <div className="space-y-2">
        {items.map((t, i) => (
          <div key={i} className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
            {editing ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select value={t.type} onChange={(e) => updateItem(i, { type: e.target.value })} className="w-16 rounded-lg border border-zinc-200 bg-zinc-50/50 px-2 py-1 text-xs font-bold dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                    {['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map((tt) => <option key={tt} value={tt}>{tt}</option>)}
                  </select>
                  <EditField value={t.when} onChange={(v) => updateItem(i, { when: v })} placeholder={zh ? '触发条件...' : 'When...'} className="flex-1" />
                  <button onClick={() => removeItem(i)} className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"><RemixIcon name="close-line" size={12} /></button>
                </div>
                <EditField value={t.action} onChange={(v) => updateItem(i, { action: v })} placeholder={zh ? 'AI 行动...' : 'Action...'} />
                <EditField value={t.example_feedback} onChange={(v) => updateItem(i, { example_feedback: v })} placeholder={zh ? '反馈示例...' : 'Example feedback...'} />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${TRIGGER_COLORS[t.type] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>{t.type}</span>
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t.when}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t.action}</p>
                <p className="mt-1 rounded-md bg-zinc-50 px-2 py-1 text-[0.6875rem] italic text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">"{t.example_feedback}"</p>
              </>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <button onClick={addItem} className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium text-[#000080] hover:bg-[#000080]/[0.04] dark:text-[#93AAFD] transition-colors">
          <RemixIcon name="add-line" size={12} />{zh ? '添加触发器' : 'Add trigger'}
        </button>
      )}
    </SectionWrapper>
  );
};

// ── Resources ───────────────────────────────────────────────

type Resource = NonNullable<LessonPlanContentType['resources']>[number];

const CanvasResources: React.FC<CanvasSectionProps<LessonPlanContentType['resources']>> = ({ data, editing, onToggle, onChange, zh }) => {
  if (!data?.length && !editing) return null;
  const items = data ?? [];
  const typeIcon: Record<string, string> = { worksheet: 'file-paper-2-line', prompt_card: 'chat-quote-line', reading: 'book-read-line', reference: 'links-line' };

  const updateItem = (idx: number, patch: Partial<Resource>) => onChange(items.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const addItem = () => onChange([...items, { type: 'worksheet', title: '', content: '' }]);

  return (
    <SectionWrapper icon="folder-open-line" title={zh ? '教学资源' : 'Teaching Resources'} iconColor="text-blue-600 dark:text-blue-400" editing={editing} onToggle={onToggle} visible>
      <div className={editing ? 'space-y-3' : 'grid gap-2 sm:grid-cols-2'}>
        {items.map((r, i) => (
          <div key={i} className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
            {editing ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select value={r.type} onChange={(e) => updateItem(i, { type: e.target.value })} className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                    <option value="worksheet">worksheet</option><option value="prompt_card">prompt_card</option><option value="reading">reading</option><option value="reference">reference</option>
                  </select>
                  <EditField value={r.title} onChange={(v) => updateItem(i, { title: v })} placeholder={zh ? '标题...' : 'Title...'} className="flex-1" />
                  <button onClick={() => removeItem(i)} className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"><RemixIcon name="close-line" size={12} /></button>
                </div>
                <EditField value={r.content} onChange={(v) => updateItem(i, { content: v })} multiline placeholder={zh ? '资源内容...' : 'Content...'} />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <RemixIcon name={typeIcon[r.type] ?? 'file-line'} size={14} className="text-zinc-400" />
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{r.title}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.6875rem] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{r.type}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content}</p>
              </>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <button onClick={addItem} className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium text-[#000080] hover:bg-[#000080]/[0.04] dark:text-[#93AAFD] transition-colors">
          <RemixIcon name="add-line" size={12} />{zh ? '添加资源' : 'Add resource'}
        </button>
      )}
    </SectionWrapper>
  );
};

// ── Reflection ──────────────────────────────────────────────

const CanvasReflection: React.FC<CanvasSectionProps<LessonPlanContentType['reflection']>> = ({ data, editing, onToggle, onChange, zh }) => {
  if (!data) return null;
  return (
    <SectionWrapper icon="lightbulb-flash-line" title={zh ? '课后反思' : 'Reflection'} editing={editing} onToggle={onToggle} visible>
      {editing ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">{zh ? '教师反思' : 'Teacher'}</div>
            <ListEditor items={data.teacher_reflection ?? []} onChange={(v) => onChange({ ...data, teacher_reflection: v })} zh={zh} />
          </div>
          <div>
            <div className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">{zh ? '学生反思' : 'Student'}</div>
            <ListEditor items={data.student_reflection ?? []} onChange={(v) => onChange({ ...data, student_reflection: v })} zh={zh} />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(data.teacher_reflection ?? []).length > 0 && (
            <div>
              <div className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">{zh ? '教师反思' : 'Teacher'}</div>
              <ul className="space-y-1.5">{data.teacher_reflection.map((r, i) => <li key={i} className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">• {r}</li>)}</ul>
            </div>
          )}
          {(data.student_reflection ?? []).length > 0 && (
            <div>
              <div className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">{zh ? '学生反思' : 'Student'}</div>
              <ul className="space-y-1.5">{data.student_reflection.map((r, i) => <li key={i} className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">• {r}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </SectionWrapper>
  );
};

// ---------------------------------------------------------------------------
// Sub-components: Preview & History (unchanged from form phase)
// ---------------------------------------------------------------------------

const PreviewCard: React.FC<{
  zh: boolean; courseTitle: string; topic: string; duration: string;
  principleNames: string[]; planType: PlanType; hasCourse: boolean;
}> = ({ zh, courseTitle, topic, duration, principleNames, planType, hasCourse }) => {
  const cfg = PLAN_TYPE_CONFIG[planType];
  const previewItems = zh
    ? ['教学目标与重难点', '活动设计与教学支架', '讨论引导问题', '评估量规', 'AI 介入时机建议']
    : ['Teaching objectives', 'Activity design', 'Discussion prompts', 'Assessment rubric', 'AI triggers'];

  const aiSuggestions = zh
    ? [
        { icon: 'lightbulb-line', color: 'text-amber-500', text: '建议增加小组协作讨论环节' },
        { icon: 'compass-3-line', color: 'text-blue-500', text: '可设置探究问题引导深层思考' },
        { icon: 'bar-chart-grouped-line', color: 'text-emerald-500', text: '推荐使用分层任务适配不同水平' },
      ]
    : [
        { icon: 'lightbulb-line', color: 'text-amber-500', text: 'Consider adding group discussion activities' },
        { icon: 'compass-3-line', color: 'text-blue-500', text: 'Set inquiry questions for deeper thinking' },
        { icon: 'bar-chart-grouped-line', color: 'text-emerald-500', text: 'Use tiered tasks for different levels' },
      ];

  const readyCount = [hasCourse, !!topic, principleNames.length > 0].filter(Boolean).length;
  const progressPct = Math.round((readyCount / 3) * 100);

  return (
    <div className="relative flex-1 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#000080] to-[#4169E1] dark:from-[#4169E1] dark:to-[#93AAFD]" />
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[0.8125rem] font-semibold text-zinc-700 dark:text-zinc-300">{zh ? '实时预览' : 'Live preview'}</span>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[0.6875rem] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {zh ? 'AI 正在为你准备内容...' : 'AI preparing content...'}
          </span>
        </div>

        {hasCourse ? (
          <>
            <h3 className="text-[0.9375rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{courseTitle}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] font-medium ${cfg.bg} ${cfg.iconColor}`}>{zh ? cfg.zh : cfg.en}</span>
              <span className="rounded-full bg-[#000080]/[0.06] px-2.5 py-0.5 text-[0.6875rem] font-medium text-[#000080] dark:bg-[#4169E1]/[0.12] dark:text-[#93AAFD]">{zh ? `${duration}分钟` : `${duration} min`}</span>
              {topic && <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[0.6875rem] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{topic.length > 18 ? topic.slice(0, 18) + '…' : topic}</span>}
            </div>

            {/* Progress bar */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[0.6875rem]">
                <span className="text-zinc-400">{zh ? '准备进度' : 'Readiness'}</span>
                <span className="font-medium text-[#000080] dark:text-[#93AAFD]">{progressPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="h-full rounded-full bg-[#000080] transition-all duration-500 dark:bg-[#4169E1]" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {principleNames.length > 0 && (
              <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <div className="mb-2 text-[0.6875rem] font-medium text-zinc-400">{zh ? '选定原则' : 'Selected principles'}</div>
                <div className="flex flex-wrap gap-1.5">{principleNames.map((n) => <span key={n} className="rounded-full bg-[#000080]/[0.06] px-2.5 py-0.5 text-[0.6875rem] font-medium text-[#000080] dark:bg-[#4169E1]/[0.12] dark:text-[#93AAFD]">{n}</span>)}</div>
              </div>
            )}

            <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <div className="mb-2 text-[0.6875rem] font-medium text-zinc-400">{zh ? '将为你生成' : 'Will be generated'}</div>
              <div className="space-y-2">{previewItems.map((item) => <div key={item} className="flex items-center gap-2.5 text-[0.8125rem] text-zinc-600 dark:text-zinc-400"><RemixIcon name="checkbox-circle-fill" size={15} className="flex-shrink-0 text-emerald-500 dark:text-emerald-400" />{item}</div>)}</div>
            </div>

            {/* AI suggestions */}
            <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/50">
              <div className="mb-2.5 flex items-center gap-1.5">
                <RemixIcon name="sparkling-2-fill" size={13} className="text-[#000080] dark:text-[#93AAFD]" />
                <span className="text-[0.75rem] font-semibold text-zinc-700 dark:text-zinc-300">{zh ? 'AI 建议' : 'AI suggestions'}</span>
              </div>
              <div className="space-y-2">
                {aiSuggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-[0.75rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <RemixIcon name={s.icon} size={14} className={`mt-0.5 flex-shrink-0 ${s.color}`} />
                    {s.text}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800"><RemixIcon name="book-open-line" size={24} className="text-zinc-400 dark:text-zinc-500" /></div>
            <p className="text-[0.875rem] text-zinc-400 dark:text-zinc-500">{zh ? '选择课程后预览教案结构' : 'Select a course to preview'}</p>
          </div>
        )}
      </div>
    </div>
  );
};

const HistoryPanel: React.FC<{
  plans: LessonPlanSummary[]; loading: boolean; zh: boolean;
  onSelect: (id: string) => void; onClose: () => void;
}> = ({ plans, loading, zh, onSelect, onClose }) => (
  <div className="relative flex-1 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
    <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{zh ? '历史教案' : 'History'}</span>
      <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"><RemixIcon name="close-line" size={14} className="text-zinc-400" /></button>
    </div>
    <div className="max-h-[400px] overflow-y-auto p-3">
      {loading ? (
        <div className="flex items-center justify-center py-8"><div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-[#000080] dark:border-zinc-600 dark:border-t-[#4169E1]" /></div>
      ) : plans.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">{zh ? '暂无教案' : 'No plans yet'}</p>
      ) : (
        <div className="space-y-2">
          {plans.map((p) => (
            <button key={p.id} onClick={() => onSelect(p.id)} className="w-full rounded-xl border border-zinc-100 p-3 text-left transition-all hover:border-zinc-200 hover:shadow-sm dark:border-zinc-800 dark:hover:border-zinc-700">
              <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{p.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[0.6875rem] text-zinc-400 dark:text-zinc-500">
                <span className={`rounded-full px-1.5 py-0.5 text-[0.6875rem] ${p.status === 'completed' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>{p.status}</span>
                <span>{new Date(p.created_at).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
);
