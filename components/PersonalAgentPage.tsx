import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, Loader2, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import RemixIcon from './RemixIcon';
import AgentProcess from './AgentProcess';
import type { ToolCallInfo } from './AgentToolCallDisplay';
import { AiThinkingDots } from './AiThinking';
import { useAiSurfaceMotion } from '../hooks/useAiMotion';
import { useAuth } from '../contexts/AuthContext';
import { useLanguagePreference } from '../hooks/useLanguagePreference';
import { personalAgent as personalAgentApi, AgentConversation, getAuthToken, apiFileUrl } from '../services/apiClient';
import LessonPrepPanel from './agent/LessonPrepPanel';
import AnalyticsPanel from './agent/AnalyticsPanel';
import AssessmentPanel from './agent/AssessmentPanel';
import {
  allowsTeacherModes,
  defaultCourseId,
  isTeacherOnlyMode,
  offeredCourses,
  planAgentRequest,
  type AgentCourse,
} from './agent/agentCourses';
import { isSafeHttpUrl } from './chatMarkdown';
import DrawingProgress, { nextDrawingState, type DrawingState } from './DrawingProgress';
import AnswerLengthSelect from './AnswerLengthSelect';
import { getAnswerLength } from './answerLengthPref';

// ── Constants ────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_URL || '/api';


const PROVIDER_LABELS: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  deepseek: 'DeepSeek',
  dmx: 'DMXAPI',
  dmxapi: 'DMXAPI',
  moonshot: 'Kimi',
  doubao: 'Doubao',
  xai: 'Grok',
  baidu: 'Wenxin',
  alibaba: 'Qwen',
  zhipu: 'Zhipu',
  openrouter: 'OpenRouter',
  auto: 'Auto',
};

const STUDENT_AGENT_MODES = [
  { id: 'idea_coach', labelEn: 'Develop Ideas', labelZh: '想法发展' },
  { id: 'gap_finder', labelEn: 'Deep Inquiry', labelZh: '深度追问' },
  { id: 'connection_scout', labelEn: 'Find Connections', labelZh: '关联发现' },
  { id: 'evidence_broker', labelEn: 'Find Evidence', labelZh: '证据查找' },
  { id: 'rise_above_coach', labelEn: 'Synthesize', labelZh: '综合提炼' },
] as const;

const TEACHER_AGENT_MODES = [
  { id: 'lesson_planner', labelEn: 'Lesson Design', labelZh: '课程设计' },
  { id: 'teaching_analyst', labelEn: 'Learning Analytics', labelZh: '学情分析' },
  { id: 'idea_coach', labelEn: 'Develop Ideas', labelZh: '想法发展' },
  { id: 'connection_scout', labelEn: 'Find Connections', labelZh: '关联发现' },
  { id: 'rise_above_coach', labelEn: 'Synthesize', labelZh: '综合提炼' },
] as const;

// ── Types ────────────────────────────────────────────────────────

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolCallInfo[];
  isStreaming?: boolean;
}

interface AgentConfig {
  providerId: string;
  enabledModels: string[];
  isVerified: boolean;
}

// ── Translations ─────────────────────────────────────────────────

function useTranslations(isTeacherRole?: boolean) {
  const [language] = useLanguagePreference();
  const lang = language === 'en' ? 'en' : 'zh';
  const isZh = lang === 'zh';
  return useMemo(() => ({
    isZh,
    title: isZh ? 'AI 助手' : 'AI Assistant',
    back: isZh ? '返回' : 'Back',
    settings: isZh ? '设置' : 'Settings',
    inputPlaceholder: isTeacherRole
      ? (isZh ? '备课、教学分析、课程设计...' : 'Lesson planning, teaching analytics...')
      : (isZh ? '问我任何问题...' : 'Ask anything...'),
    send: isZh ? '发送' : 'Send',
    thinking: isZh ? '思考中...' : 'Thinking...',
    streaming: isZh ? '生成中...' : 'Generating...',
    courseContext: isZh ? '课程上下文' : 'Course context',
    selectCourse: isZh ? '选择课程以提供上下文' : 'Select a course for context',
    noCourse: isZh ? '不关联课程' : 'No course context',
    provider: isZh ? '模型供应商' : 'Provider',
    model: isZh ? '模型' : 'Model',
    agentMode: isZh ? 'Agent 模式' : 'Agent mode',
    loadingConfigs: isZh ? '加载配置中...' : 'Loading configurations...',
    configError: isZh ? '加载配置失败' : 'Failed to load configurations',
    welcomeGreeting: isTeacherRole
      ? (isZh ? '你好！我是你的备课与教学 AI 助手。' : 'Hi! I\'m your Teaching AI assistant.')
      : (isZh ? '你好！我是你的知识建构 AI 助手。' : 'Hi! I\'m your Knowledge Building AI assistant.'),
    welcomeSubtext: isZh ? '我可以帮助你：' : 'I can help with:',
    welcomeItems: isTeacherRole
      ? (isZh
          ? ['设计知识建构课程和教学支架', '分析班级讨论模式和学生参与度', '推荐 AI 介入时机和触发策略', '查找教学研究证据']
          : ['Design KB lessons and scaffolding', 'Analyze class discussion patterns and engagement', 'Recommend AI intervention triggers', 'Find teaching research evidence'])
      : (isZh
          ? ['探索和发展你的想法', '发现知识缺口', '寻找关联观点', '查找研究证据']
          : ['Explore and develop your ideas', 'Discover knowledge gaps', 'Find connected perspectives', 'Find research evidence']),
    examplePrompts: isTeacherRole
      ? (isZh
          ? ['帮我设计一节关于生态系统的知识建构课', '分析我班级中学生讨论的参与度', '推荐 AI 助手何时应该介入学生讨论']
          : ['Help me plan a KB lesson on ecosystems', 'Analyze student discussion engagement in my class', 'When should the AI intervene in student discussions?'])
      : (isZh
          ? ['帮我梳理关于这个话题的想法', '我的观点有哪些知识缺口？', '有没有其他同学提出类似的观点？']
          : ['Help me organize my ideas on this topic', 'What gaps exist in my argument?', 'Are there similar ideas from other students?']),
    newChat: isZh ? '新对话' : 'New conversation',
    errorPrefix: isZh ? '错误：' : 'Error: ',
    pickCourse: isZh ? '选择课程' : 'Select course',
    memberSuffix: isZh ? '（普通成员）' : ' (member)',
    memberCourseHint: isZh
      ? '你在这门课是普通成员。备课和学情分析只对课程创建者和课程管理员开放，这里按「想法发展」模式回答。'
      : 'You are a regular member of this course. Lesson planning and learning analytics are only for its creator and managers, so replies here use Develop Ideas mode.',
    noTeachingCourseHint: isZh
      ? '你目前没有创建或管理的课程，用不了备课和学情分析，这里按「想法发展」模式回答。'
      : 'You do not create or manage any course yet, so lesson planning and learning analytics are unavailable; replies use Develop Ideas mode.',
    pickTeachingCourse: isZh ? '先选一门你创建或管理的课程。' : 'Select a course you create or manage first.',
    noTeachingCourse: isZh
      ? '备课和学情分析只对课程创建者和课程管理员开放，你目前没有这样的课程。'
      : 'Lesson planning and learning analytics are only for course creators and managers, and you have no such course yet.',
    teacherOnlyTitle: (feature: string) => (isZh ? `${feature}只对课程创建者和课程管理员开放` : `${feature} is for course creators and managers`),
    teacherOnlyBody: (count: number) => (isZh
      ? `${count === 1 ? '你在加入的这门课里是普通成员' : `你在加入的 ${count} 门课里都是普通成员`}（凭学生验证码加入，或受邀后还没被设为课程管理员）。需要的话，请课程创建者在课程设置的「协作与权限」里把你设为课程管理员。${count === 1 ? '这门课' : '这些课'}里仍然可以用「AI 对话」。`
      : `${count === 1 ? 'In the course you have joined' : `In the ${count} courses you have joined`} you are a regular member (joined with a student code, or invited but not yet made a manager). The course creator can make you a manager under Collaboration in course settings. AI Chat still works in ${count === 1 ? 'it' : 'them'}.`),
  }), [isZh]);
}

// ── SSE reader ───────────────────────────────────────────────────

async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: Record<string, unknown> | '[DONE]') => void,
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
      const line = part.split('\n').find((item) => item.startsWith('data: '));
      if (!line) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        onEvent('[DONE]');
        continue;
      }
      try {
        onEvent(JSON.parse(data));
      } catch {
        // Ignore malformed stream events.
      }
    }
  }
}

// ── Simple inline formatting ─────────────────────────────────────


function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2]) {
      nodes.push(<strong key={`${keyPrefix}-b${match.index}`} className="font-medium text-gray-900 dark:text-gray-100">{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(
        <code key={`${keyPrefix}-c${match.index}`} className="rounded bg-gray-100 px-1 py-[1px] font-mono text-[0.84em] text-gray-700 dark:bg-gray-800 dark:text-gray-300">{match[3]}</code>,
      );
    } else if (match[4] !== undefined && match[5]) {
      const isApi = match[5].startsWith('/api/');
      const src = isApi ? apiFileUrl(match[5]) : match[5];
      // Model output is untrusted: only same-origin API paths, data: images and
      // http(s) URLs may reach the DOM.
      if (isApi || src.startsWith('data:image/') || isSafeHttpUrl(src)) {
        nodes.push(
          <img key={`${keyPrefix}-img${match.index}`} src={src} alt={match[4]}
            className="my-2 max-w-full rounded-lg border border-gray-200 shadow-sm dark:border-gray-700" />,
        );
      } else {
        nodes.push(match[0]);
      }
    } else if (match[6] && match[7]) {
      const isApi = match[7].startsWith('/api/');
      const href = isApi ? apiFileUrl(match[7]) : match[7];
      if (isApi || isSafeHttpUrl(href)) {
        nodes.push(
          <a key={`${keyPrefix}-a${match.index}`} href={href} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-[#000080]/[0.06] px-2 py-0.5 text-[0.8125rem] font-medium text-[#000080] hover:bg-[#000080]/[0.12] dark:bg-[#4169E1]/[0.1] dark:text-[#93AAFD] dark:hover:bg-[#4169E1]/[0.2] transition-colors">
            <RemixIcon name="download-2-line" size={13} />
            {match[6]}
          </a>,
        );
      } else {
        nodes.push(match[6]);
      }
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const langMatch = line.match(/```(\w+)/);
      const lang = langMatch?.[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <div key={`code-${i}`} className="my-3 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          {lang && (
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-1 text-[0.6875rem] font-medium text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">{lang}</div>
          )}
          <pre className="overflow-x-auto bg-gray-900 p-3 text-[0.8125rem] leading-relaxed text-gray-100 dark:bg-gray-950">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>,
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`hr-${i}`} className="my-4 border-gray-100 dark:border-gray-800" />);
      i++;
      continue;
    }

    // Table (pipe-delimited rows)
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableRows: string[][] = [];
      let hasHeader = false;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        const row = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (row.every(c => /^[-:]+$/.test(c))) { hasHeader = true; i++; continue; }
        tableRows.push(row);
        i++;
      }
      if (tableRows.length > 0) {
        const headerRow = hasHeader ? tableRows.shift()! : null;
        blocks.push(
          <div key={`tbl-${i}`} className="my-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-[0.8125rem]">
              {headerRow && (
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                    {headerRow.map((cell, ci) => (
                      <th key={ci} className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{renderInline(cell, `th${i}-${ci}`)}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {tableRows.map((row, ri) => (
                  <tr key={ri} className={`border-b border-gray-100 dark:border-gray-800 ${ri % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-800/30'}`}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{renderInline(cell, `td${i}-${ri}-${ci}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const cls = level <= 2
        ? 'text-[0.9375rem] font-medium text-gray-900 dark:text-gray-100 mt-5 mb-2'
        : 'text-[0.875rem] font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1.5';
      blocks.push(<div key={`h-${i}`} className={cls}>{renderInline(content, `h${i}`)}</div>);
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: { indent: number; content: string }[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*]\s+(.*)/);
        if (m) items.push({ indent: m[1].length, content: m[2] });
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="my-2 space-y-1.5">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-baseline gap-2 text-[0.875rem] leading-relaxed" style={item.indent > 0 ? { paddingLeft: `${item.indent * 0.5}rem` } : undefined}>
              <span className="mt-[3px] block h-[5px] w-[5px] flex-shrink-0 rounded-full bg-[#000080]/30 dark:bg-[#4169E1]/40" />
              <span>{renderInline(item.content, `li${idx}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*\d+[.)]\s+(.*)/);
        if (m) items.push(m[1]);
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="my-2 list-decimal space-y-1.5 pl-5">
          {items.map((item, idx) => (
            <li key={idx} className="pl-0.5 text-[0.875rem] leading-relaxed marker:text-[#000080]/30 dark:marker:text-[#4169E1]/40">{renderInline(item, `oli${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      blocks.push(<div key={`sp-${i}`} className="h-3" />);
      i++;
      continue;
    }

    // Regular paragraph
    blocks.push(
      <p key={`p-${i}`} className="text-[0.875rem] leading-[1.75]">{renderInline(line, `p${i}`)}</p>,
    );
    i++;
  }

  return <>{blocks}</>;
}

// ── Component ────────────────────────────────────────────────────

interface PersonalAgentPageProps {
  embedded?: boolean;
  userRole?: string;
  initialAgentMode?: string;
  /** 哪个入口：chat / lesson / analytics / assessment。历史记录按它分开存取。 */
  agentModule?: string;
  agentTitle?: string;
}

const PersonalAgentPage: React.FC<PersonalAgentPageProps> = ({ embedded, userRole, initialAgentMode, agentModule = 'chat', agentTitle }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const resolvedRole = userRole ?? user?.role ?? 'student';
  const isTeacherForTranslations = resolvedRole === 'teacher' || resolvedRole === 'admin';
  const t = useTranslations(isTeacherForTranslations);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // State
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  /** 这一轮是画图（后端识别出「画一张……」）：放绘图动画，图到了再换成图 */
  const [drawing, setDrawing] = useState<DrawingState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config state
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [courses, setCourses] = useState<AgentCourse[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const effectiveRole = userRole ?? user?.role ?? 'student';
  const isTeacher = effectiveRole === 'teacher' || effectiveRole === 'admin';
  const displayName = (user as unknown as Record<string, string>)?.name || '';
  const agentModes = isTeacher ? TEACHER_AGENT_MODES : STUDENT_AGENT_MODES;
  const lockedMode = !!initialAgentMode;
  const [selectedAgentMode, setSelectedAgentMode] = useState(initialAgentMode ?? (isTeacher ? 'lesson_planner' : 'idea_coach'));

  // Tool tracking state
  const [activeTools, setActiveTools] = useState<ToolCallInfo[]>([]);

  // Conversation persistence
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoringChat, setRestoringChat] = useState(false);
  const motionRef = useAiSurfaceMotion({ open: true, ready: !configsLoading && !restoringChat });

  // Derived
  const chatConfigs = useMemo(
    () => configs.filter((c) => c.isVerified || (c.enabledModels?.length ?? 0) > 0),
    [configs],
  );
  const selectedConfig = chatConfigs.find((c) => c.providerId === selectedProviderId);
  const modelList = selectedProviderId === 'auto' ? ['auto'] : selectedConfig?.enabledModels ?? [];

  // 备课 / 学情分析 / 教学评估只列有教职的课。Dashboard 按入口给了 key，切换入口会重新挂载；这里再兜一层：
  // 同一个实例被换了入口时，手上的课可能不在这份列表里（比如在 AI 对话里选的只听课的课），那就回到默认的课，别把失效的选择交给面板。
  const lockedTeacherMode = lockedMode && isTeacherOnlyMode(selectedAgentMode);
  const courseChoices = useMemo(
    () => offeredCourses(courses, selectedAgentMode, lockedMode),
    [courses, selectedAgentMode, lockedMode],
  );
  const activeCourseId = !selectedCourseId || courseChoices.some((c) => c.id === selectedCourseId)
    ? selectedCourseId
    : defaultCourseId(courseChoices, selectedAgentMode);
  const teacherModeUnavailable = lockedTeacherMode && courses.length > 0 && courseChoices.length === 0;
  const requestPlan = planAgentRequest({ mode: selectedAgentMode, modeLocked: lockedMode, courses, selectedCourseId: activeCourseId });
  const fallbackHint = 'agentMode' in requestPlan && requestPlan.agentMode !== selectedAgentMode
    ? (activeCourseId ? t.memberCourseHint : t.noTeachingCourseHint)
    : null;

  // ── Load configs on mount ──────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setConfigsLoading(true);
      try {
        const res = await fetch(`${BASE_URL}/personal-agent/configs`, {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setConfigs(data.configs ?? []);
        setCourses(data.courses ?? []);
        // Auto-select first provider
        const verified = (data.configs ?? []).filter(
          (c: AgentConfig) => c.isVerified || (c.enabledModels?.length ?? 0) > 0,
        );
        if (verified.length > 0) {
          setSelectedProviderId('auto');
          setSelectedModel('auto');
        }
        // 要用教师模式就默认选有教职的课：只听课的那门排在前面时，第一句话就是 403
        setSelectedCourseId(defaultCourseId(offeredCourses(data.courses ?? [], selectedAgentMode, lockedMode), selectedAgentMode));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t.configError);
      } finally {
        if (!cancelled) setConfigsLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps



  // ── Load conversation history ───────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      const res = await personalAgentApi.listConversations(agentModule);
      setConversations(res.conversations ?? []);
    } catch {
      // non-critical
    }
  }, [agentModule]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const deleteConversation = useCallback(async (conv: AgentConversation) => {
    const ok = window.confirm(t.isZh ? `删除这条对话记录？\n「${conv.title || '未命名对话'}」` : `Delete this conversation?\n"${conv.title || 'Untitled'}"`);
    if (!ok) return;
    try {
      await personalAgentApi.deleteConversation(conv.id);
      setConversations((prev) => prev.filter((c) => c.id !== conv.id));
      if (conversationId === conv.id) {
        setConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  }, [conversationId, t.isZh]);

  const restoreConversation = useCallback(async (conv: AgentConversation) => {
    setConversationId(conv.id);
    setRestoringChat(true);
    setHistoryOpen(false);
    setError(null);
    try {
      const res = await personalAgentApi.loadMessages(conv.id);
      const restored: AgentMessage[] = (res.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tools: m.tools_used?.map((name) => ({ name, status: 'done' as const })),
      }));
      setMessages(restored);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setRestoringChat(false);
    }
  }, []);

  // ── Sync model when provider changes ───────────────────────────

  useEffect(() => {
    if (!selectedProviderId) return;
    if (selectedProviderId === 'auto') {
      if (selectedModel !== 'auto') setSelectedModel('auto');
      return;
    }
    const config = chatConfigs.find((c) => c.providerId === selectedProviderId);
    const firstModel = config?.enabledModels[0] ?? '';
    if (firstModel && !config?.enabledModels.includes(selectedModel)) {
      setSelectedModel(firstModel);
    }
  }, [chatConfigs, selectedModel, selectedProviderId]);

  // ── Auto-scroll ────────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, isThinking]);

  // ── Auto-focus input ───────────────────────────────────────────

  useEffect(() => {
    if (!configsLoading) {
      textareaRef.current?.focus();
    }
  }, [configsLoading]);

  // ── Auto-resize textarea ───────────────────────────────────────

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 24;
    const maxRows = 6;
    const maxHeight = lineHeight * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  // ── Build history for API ──────────────────────────────────────

  const buildHistory = useCallback(() => {
    return messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  // ── Send message ───────────────────────────────────────────────

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    if (!selectedProviderId || !selectedModel) {
      setError(t.isZh ? '请先选择模型供应商和模型' : 'Please select a provider and model first');
      setSettingsOpen(true);
      return;
    }
    const plan = planAgentRequest({ mode: selectedAgentMode, modeLocked: lockedMode, courses, selectedCourseId: activeCourseId });
    if ('blocked' in plan) {
      setError(plan.blocked === 'pick_course' ? t.pickTeachingCourse : t.noTeachingCourse);
      return;
    }

    setError(null);
    setSending(true);
    setIsThinking(true);
    setActiveTools([]);
    setInput('');

    // Add user message
    const userMsg: AgentMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);

    // Create temp assistant message for streaming
    const tempId = `stream-${Date.now()}`;
    let streamedText = '';
    const collectedTools: ToolCallInfo[] = [];

    try {
      const history = buildHistory();
      const res = await fetch(`${BASE_URL}/personal-agent/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          content: trimmed,
          provider_id: selectedProviderId,
          model: selectedModel,
          course_id: plan.courseId,
          context_course_id: plan.contextCourseId,
          agent_mode: plan.agentMode,
          module: agentModule,
          conversation_id: conversationId ?? undefined,
          history,
          answer_length: getAnswerLength(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      await readSSEStream(reader, (event) => {
        if (event === '[DONE]') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId ? { ...m, isStreaming: false } : m,
            ),
          );
          setIsThinking(false);
          return;
        }

        // Error event
        if (typeof event.error === 'string') {
          setError(event.error);
          setIsThinking(false);
          setDrawing(null);
          return;
        }

        // 画图：放绘图动画，等 token 带着图片回来
        if (event.drawing && typeof (event.drawing as { prompt?: unknown }).prompt === 'string') {
          setIsThinking(false);
          setDrawing(prev => nextDrawingState(prev, event.drawing as { prompt: string; stage?: unknown; caption?: unknown; mode?: unknown }));
          return;
        }

        // Done event — capture conversationId for persistence
        if (event.done === true && typeof event.conversationId === 'string') {
          setConversationId(event.conversationId as string);
          return;
        }

        // Reasoning/thinking status
        if (event.reasoningStatus === 'thinking') {
          setIsThinking(true);
          return;
        }

        // Tool running
        if (event.toolStatus === 'running' && typeof event.toolName === 'string') {
          setIsThinking(false);
          const toolName = event.toolName as string;
          const info: ToolCallInfo = { name: toolName, status: 'running' };
          if (!collectedTools.find((t) => t.name === toolName)) {
            collectedTools.push(info);
          }
          setActiveTools((prev) =>
            prev.find((t) => t.name === toolName) ? prev : [...prev, info],
          );
          return;
        }

        // Tools completed
        if (event.toolStatus === 'used') {
          const names = (event.toolNames as string[]) ?? (event.toolName ? [event.toolName as string] : []);
          for (const n of names) {
            const existing = collectedTools.find((t) => t.name === n);
            if (existing) existing.status = 'done';
            else collectedTools.push({ name: n, status: 'done' });
          }
          setActiveTools((prev) =>
            prev.map((t) => names.includes(t.name) ? { ...t, status: 'done' as const } : t),
          );
          return;
        }

        // Streaming token
        if (typeof event.token === 'string') {
          setIsThinking(false);
          setDrawing(null);
          streamedText += event.token;
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === tempId);
            if (existing) {
              return prev.map((m) =>
                m.id === tempId ? { ...m, content: streamedText } : m,
              );
            }
            return [
              ...prev,
              {
                id: tempId,
                role: 'assistant' as const,
                content: streamedText,
                isStreaming: true,
              },
            ];
          });
          return;
        }

        // Final assembled message
        if (event.assistantMessage) {
          const final = event.assistantMessage as Record<string, unknown>;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? {
                    ...m,
                    id: (final.id as string) || m.id,
                    content: (final.content as string) || m.content,
                    tools: collectedTools.length > 0 ? [...collectedTools] : m.tools,
                    isStreaming: false,
                  }
                : m,
            ),
          );
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setInput(trimmed);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
      setDrawing(null);
      setIsThinking(false);
      setActiveTools([]);
      textareaRef.current?.focus();
    }
  }, [sending, selectedProviderId, selectedModel, activeCourseId, selectedAgentMode, lockedMode, courses, agentModule, conversationId, buildHistory, t]);

  // ── Keyboard handler ───────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  // ── Clear conversation ─────────────────────────────────────────

  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
    textareaRef.current?.focus();
  }, []);

  // ── Render ─────────────────────────────────────────────────────

  const hasMessages = messages.length > 0;
  // 一门有教职的课都没有：三个教师入口不摆面板，只说明为什么用不了
  const isAnalyticsMode = agentModule === 'analytics' && !teacherModeUnavailable;
  const isAssessmentMode = agentModule === 'assessment' && !teacherModeUnavailable;
  const isLessonPrepMode = !configsLoading && !hasMessages && initialAgentMode === 'lesson_planner' && !teacherModeUnavailable;
  const showingAgentPanel = !configsLoading && !hasMessages && !!initialAgentMode && !isAnalyticsMode && !isAssessmentMode && !isLessonPrepMode;

  return (
    <div ref={motionRef} className={`ai-motion-surface flex flex-col bg-white dark:bg-gray-900 ${embedded ? 'h-full' : 'h-[100dvh]'}`}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header data-ai-motion-chrome className={`flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900 ${embedded ? 'py-2' : 'py-2.5'}`}>
        <div className="flex items-center gap-2.5">
          {!embedded && (
            <button
              onClick={() => navigate('/dashboard')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <img src="/assets/ai-tutor-avatar.png" alt="" className="h-7 w-7 rounded-lg object-cover" />
          <h1 className={`font-medium text-gray-900 dark:text-gray-100 ${embedded ? 'text-sm' : 'text-[0.9375rem]'}`}>
            {agentTitle ?? (isTeacher ? (t.isZh ? '备课与教学助手' : 'Teaching Assistant') : (t.isZh ? '智能助手' : 'Smart Assistant'))}
          </h1>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setHistoryOpen((prev) => !prev)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              historyOpen
                ? 'bg-[#000080]/[0.06] text-[#000080] dark:bg-[#4169E1]/[0.12] dark:text-[#93AAFD]'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300'
            }`}
            title={t.isZh ? '历史对话' : 'History'}
          >
            <RemixIcon name="history-line" size={16} />
          </button>
          {hasMessages && (
            <button
              onClick={clearConversation}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              title={t.newChat}
            >
              <RemixIcon name="chat-new-line" size={16} />
            </button>
          )}
          <button
            onClick={() => setSettingsOpen((prev) => !prev)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              settingsOpen
                ? 'bg-[#000080]/[0.06] text-[#000080] dark:bg-[#4169E1]/[0.12] dark:text-[#93AAFD]'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300'
            }`}
          >
            <Settings size={15} />
          </button>
        </div>
      </header>

      {/* ── Settings drawer ─────────────────────────────────────── */}
      <div
        className={`overflow-hidden border-b border-gray-100 transition-all duration-300 dark:border-gray-800 ${
          settingsOpen ? 'max-h-80 py-3' : 'max-h-0 py-0'
        }`}
      >
        <div className="mx-auto flex max-w-3xl flex-wrap gap-3 px-4">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{t.courseContext}</span>
            <select
              value={activeCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors focus:border-[#000080] focus:outline-none focus:ring-1 focus:ring-[#000080] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              <option value="">{lockedTeacherMode ? t.pickCourse : t.noCourse}</option>
              {courseChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {isTeacherOnlyMode(selectedAgentMode) && !allowsTeacherModes(c) ? `${c.title}${t.memberSuffix}` : c.title}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[140px] flex-1 flex-col gap-1">
            <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{t.provider}</span>
            <select
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors focus:border-[#000080] focus:outline-none focus:ring-1 focus:ring-[#000080] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              <option value="auto">{PROVIDER_LABELS.auto}</option>
              {chatConfigs.map((c) => (
                <option key={c.providerId} value={c.providerId}>
                  {PROVIDER_LABELS[c.providerId] ?? c.providerId}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[140px] flex-1 flex-col gap-1">
            <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{t.model}</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors focus:border-[#000080] focus:outline-none focus:ring-1 focus:ring-[#000080] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              {modelList.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              {modelList.length === 0 && (
                <option value="" disabled>--</option>
              )}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{t.isZh ? '回答长度' : 'Answer length'}</span>
            <AnswerLengthSelect lang={t.isZh ? 'zh' : 'en'} disabled={sending} />
          </div>
        </div>
      </div>

      {/* ── Conversation history drawer ──────────────────────────── */}
      <div
        className={`overflow-hidden border-b border-gray-100 transition-all duration-300 dark:border-gray-800 ${
          historyOpen ? 'max-h-60 py-2' : 'max-h-0 py-0'
        }`}
      >
        <div className="mx-auto max-w-3xl px-4">
          <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t.isZh ? '历史对话' : 'Conversation history'}
          </p>
          {conversations.length === 0 ? (
            <p className="py-2 text-xs text-gray-400 dark:text-gray-500">
              {t.isZh ? '暂无历史对话' : 'No conversation history yet'}
            </p>
          ) : (
            <div className="max-h-44 space-y-0.5 overflow-y-auto">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group flex items-center rounded-lg transition-colors ${
                    conversationId === conv.id
                      ? 'bg-[#000080]/[0.06] text-[#000080] dark:bg-[#4169E1]/[0.12] dark:text-[#93AAFD]'
                      : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  <button
                    onClick={() => void restoreConversation(conv)}
                    className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-xs"
                  >
                    <span className="truncate font-medium">{conv.title || (t.isZh ? '未命名对话' : 'Untitled')}</span>
                    <span className="ml-2 shrink-0 text-[0.6875rem] text-gray-400 dark:text-gray-500">
                      {new Date(conv.updated_at).toLocaleDateString()}
                    </span>
                  </button>
                  <button
                    onClick={() => void deleteConversation(conv)}
                    className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-60 transition-colors hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    title={t.isZh ? '删除' : 'Delete'}
                    aria-label={t.isZh ? '删除对话' : 'Delete conversation'}
                  >
                    <RemixIcon name="delete-bin-line" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Content area ────────────────────────────────────────── */}
      <div className={`flex flex-1 overflow-hidden ${isAnalyticsMode || isAssessmentMode ? '' : 'flex-col'}`}>
        {isAnalyticsMode && (
          <div className="w-1/2 min-h-0 overflow-hidden border-r border-zinc-200 dark:border-zinc-800">
            <AnalyticsPanel
              lang={t.isZh ? 'zh' : 'en'}
              courses={courseChoices}
              selectedCourseId={activeCourseId}
              onCourseChange={setSelectedCourseId}
              onSendMessage={(text) => void sendMessage(text)}
            />
          </div>
        )}
        {isAssessmentMode && (
          <div className="w-1/2 min-h-0 overflow-hidden border-r border-zinc-200 dark:border-zinc-800">
            <AssessmentPanel
              lang={t.isZh ? 'zh' : 'en'}
              courses={courseChoices}
              selectedCourseId={activeCourseId}
              onCourseChange={setSelectedCourseId}
              onSendMessage={(text) => void sendMessage(text)}
            />
          </div>
        )}
        <div className={`flex ${isAnalyticsMode || isAssessmentMode ? 'w-1/2' : 'flex-1'} flex-col min-w-0 min-h-0`}>
      {/* ── Chat area ───────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-gray-900">
        <div className={`mx-auto ${isLessonPrepMode ? '' : 'px-4 sm:px-6'} ${showingAgentPanel ? 'flex h-full flex-col' : isLessonPrepMode ? 'h-full max-w-none' : (isAnalyticsMode || isAssessmentMode) && !hasMessages ? 'h-full' : (isAnalyticsMode || isAssessmentMode) ? 'py-6' : (!configsLoading && !hasMessages && !initialAgentMode ? 'h-full' : 'max-w-3xl py-6')}`}>

          {/* Loading configs */}
          {configsLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={20} className="animate-spin text-[#000080] dark:text-blue-300" />
              <span className="ml-2 text-sm text-gray-400 dark:text-gray-500">{t.loadingConfigs}</span>
            </div>
          )}

          {teacherModeUnavailable && !hasMessages && (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                <RemixIcon name="lock-line" size={26} className="text-zinc-400 dark:text-zinc-500" />
              </div>
              <p className="text-sm font-semibold tracking-tight text-zinc-700 dark:text-zinc-200">
                {t.teacherOnlyTitle(agentTitle ?? (t.isZh ? '备课与学情分析' : 'Lesson planning and analytics'))}
              </p>
              <p className="mt-2 max-w-md text-[0.8125rem] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {t.teacherOnlyBody(courses.length)}
              </p>
            </div>
          )}

          {/* Welcome screen — agent-specific or generic */}
          {isLessonPrepMode && (
            <div className="h-full">
              <LessonPrepPanel
                lang={t.isZh ? 'zh' : 'en'}
                courses={courseChoices}
                selectedCourseId={activeCourseId}
                onCourseChange={setSelectedCourseId}
                onSwitchToChat={() => textareaRef.current?.focus()}
                providerId={selectedProviderId}
                model={selectedModel}
              />
            </div>
          )}
          {isAnalyticsMode && !hasMessages && !configsLoading && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                <RemixIcon name="chat-3-line" size={26} className="text-zinc-400 dark:text-zinc-500" />
              </div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t.isZh ? '点击左侧洞察按钮' : 'Click insight buttons on the left'}</p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{t.isZh ? 'AI 分析结果将在此显示' : 'AI analysis results will appear here'}</p>
            </div>
          )}
          {isAssessmentMode && !hasMessages && !configsLoading && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                <RemixIcon name="chat-3-line" size={26} className="text-zinc-400 dark:text-zinc-500" />
              </div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t.isZh ? '点击左侧按钮开始分析' : 'Click buttons on the left to start'}</p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{t.isZh ? 'AI 分析结果将在此显示' : 'AI results will appear here'}</p>
            </div>
          )}
          {!configsLoading && !hasMessages && !initialAgentMode && (
            <div className="mx-auto flex h-full max-w-6xl flex-col justify-between px-4 pb-2 pt-5">

              {/* ── Hero: Greeting + Robot + Quick Actions ── */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_270px]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-[1.25rem] font-bold tracking-tight text-zinc-900 dark:text-gray-100">
                      {t.isZh ? `你好，${displayName || 'User'}！` : `Hello, ${displayName || 'User'}!`}
                    </h2>
                    <h1 className="mt-1 text-[1.625rem] font-bold leading-tight tracking-tight">
                      {t.isZh ? '我是你的' : "I'm your "}
                      <span className="bg-gradient-to-r from-[#000080] via-[#4169E1] to-[#6366F1] bg-clip-text text-transparent">
                        {isTeacher
                          ? (t.isZh ? '智能教学助手' : 'Smart Teaching Assistant')
                          : (t.isZh ? '智能学习助手' : 'Smart Learning Assistant')}
                      </span>
                    </h1>
                    <p className="mt-2 max-w-lg text-[0.8125rem] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {isTeacher
                        ? (t.isZh
                            ? '专注于课前备课、课堂教学与课后评估全流程，助力教学设计、学情分析与评价反馈。'
                            : 'End-to-end support for lesson prep, classroom teaching, and post-class evaluation.')
                        : (t.isZh
                            ? '帮助你探索想法、发现知识关联、寻找证据，助力知识建构。'
                            : 'Explore ideas, discover connections, find evidence, and build knowledge.')}
                    </p>
                  </div>
                  <img src="/assets/Smart AI Assistant.png" alt="" className="hidden h-32 w-auto flex-shrink-0 object-contain lg:block" />
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-3 flex items-center gap-2">
                    <RemixIcon name="flashlight-line" size={14} className="text-[#000080] dark:text-[#93AAFD]" />
                    <span className="text-[0.8125rem] font-semibold text-zinc-900 dark:text-gray-100">
                      {t.isZh ? '快捷操作' : 'Quick Actions'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(t.isZh
                      ? [
                          { icon: 'pencil-line', label: '总结笔记', prompt: '帮我总结最近的课程笔记' },
                          { icon: 'translate', label: '翻译', prompt: '帮我把以下内容翻译成英文：' },
                          { icon: 'list-unordered', label: '大纲', prompt: '帮我生成一个关于以下主题的大纲：' },
                          { icon: 'edit-line', label: '文稿润色', prompt: '帮我润色以下文稿，使其更专业流畅：' },
                          { icon: 'lightbulb-line', label: '头脑风暴', prompt: '帮我围绕以下话题进行头脑风暴：' },
                        ]
                      : [
                          { icon: 'pencil-line', label: 'Summarize', prompt: 'Summarize my recent course notes' },
                          { icon: 'translate', label: 'Translate', prompt: 'Translate the following to Chinese:' },
                          { icon: 'list-unordered', label: 'Outline', prompt: 'Create an outline for the topic:' },
                          { icon: 'edit-line', label: 'Polish', prompt: 'Polish the following text to be more professional:' },
                          { icon: 'lightbulb-line', label: 'Brainstorm', prompt: 'Brainstorm ideas about:' },
                        ]
                    ).map((action, i) => (
                      <button
                        key={i}
                        onClick={() => { setInput(action.prompt); textareaRef.current?.focus(); }}
                        disabled={sending || !selectedProviderId}
                        className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-[0.75rem] text-zinc-600 transition-all hover:border-[#000080]/30 hover:bg-[#000080]/[0.04] hover:text-[#000080] disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-[#4169E1]/30 dark:hover:bg-[#4169E1]/[0.06] dark:hover:text-[#93AAFD]"
                      >
                        <RemixIcon name={action.icon} size={12} />
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Feature Cards + Tips ── */}

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_240px]">
                {([
                  { icon: 'chat-3-line', bg: 'bg-blue-50 dark:bg-blue-900/20', color: 'text-blue-600 dark:text-blue-400', titleZh: '对话探究', titleEn: 'Inquiry Chat', descZh: '多轮对话，深度探究教学问题', descEn: 'Multi-turn chat, deep inquiry', action: () => textareaRef.current?.focus() },
                  { icon: 'scissors-cut-line', bg: 'bg-orange-50 dark:bg-orange-900/20', color: 'text-orange-500 dark:text-orange-400', titleZh: '快捷工具', titleEn: 'Quick Tools', descZh: '总结、翻译、改写等效率工具', descEn: 'Summarize, translate, rewrite', action: () => textareaRef.current?.focus() },
                  { icon: 'file-text-line', bg: 'bg-emerald-50 dark:bg-emerald-900/20', color: 'text-emerald-600 dark:text-emerald-400', titleZh: '文档生成', titleEn: 'Doc Generation', descZh: '生成教案、报告、笔记等文档', descEn: 'Generate lesson plans, reports', action: () => { setInput(t.isZh ? '帮我生成课程笔记总结报告' : 'Generate a summary report of course notes'); setTimeout(() => textareaRef.current?.focus(), 50); } },
                  { icon: 'bar-chart-grouped-line', bg: 'bg-violet-50 dark:bg-violet-900/20', color: 'text-violet-600 dark:text-violet-400', titleZh: '数据分析', titleEn: 'Data Analysis', descZh: '多维数据分析，洞察教学趋势', descEn: 'Engagement charts, trend reports', action: () => { setInput(t.isZh ? '分析一下最近两周的学生参与度' : 'Analyze student engagement for the last 2 weeks'); setTimeout(() => textareaRef.current?.focus(), 50); } },
                ] as const).map((card, i) => (
                  <button
                    key={i}
                    onClick={card.action}
                    className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 text-left transition-all hover:border-[#000080]/30 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-[#4169E1]/40"
                  >
                    <div className={`mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl ${card.bg}`}>
                      <RemixIcon name={card.icon} size={20} className={card.color} />
                    </div>
                    <h3 className="mb-0.5 text-[0.875rem] font-semibold text-zinc-900 dark:text-gray-100">{t.isZh ? card.titleZh : card.titleEn}</h3>
                    <p className="text-[0.6875rem] leading-relaxed text-zinc-400 dark:text-gray-500">{t.isZh ? card.descZh : card.descEn}</p>
                    <div className="mt-auto flex justify-end pt-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 transition-colors group-hover:border-[#000080]/30 group-hover:bg-[#000080]/[0.04] dark:border-gray-700 dark:group-hover:border-[#4169E1]/30">
                        <RemixIcon name="arrow-right-s-line" size={13} className="text-zinc-400 transition-colors group-hover:text-[#000080] dark:text-gray-500 dark:group-hover:text-[#93AAFD]" />
                      </span>
                    </div>
                  </button>
                ))}

                {/* Tips panel + shield icon inside */}
                <div className="col-span-2 flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 lg:col-span-1 dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-3 flex items-center gap-2">
                    <RemixIcon name="sparkling-2-fill" size={14} className="text-[#000080] dark:text-[#93AAFD]" />
                    <span className="text-[0.8125rem] font-semibold text-zinc-900 dark:text-gray-100">
                      {t.isZh ? '助手小贴士' : 'Tips'}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {(t.isZh
                      ? [
                          { icon: 'attachment-line', text: '支持上传教材、课件、作业等文件进行分析与生成' },
                          { icon: 'user-star-line', text: '可基于学科与年级提供个性化教学建议' },
                          { icon: 'save-line', text: '对话内容自动保存，随时回顾与继续' },
                          { icon: 'shield-check-line', text: '你的数据安全受到保护，放心使用' },
                        ]
                      : [
                          { icon: 'attachment-line', text: 'Upload materials and assignments for AI analysis' },
                          { icon: 'user-star-line', text: 'Personalized suggestions by subject and grade' },
                          { icon: 'save-line', text: 'Conversations auto-saved for later review' },
                          { icon: 'shield-check-line', text: 'Your data is securely protected' },
                        ]
                    ).map((tip, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <RemixIcon name={tip.icon} size={13} className="mt-0.5 flex-shrink-0 text-zinc-400 dark:text-zinc-500" />
                        <span className="text-[0.6875rem] leading-relaxed text-zinc-500 dark:text-zinc-400">{tip.text}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto flex justify-end pt-2">
                    <img src="/assets/Icon 1.png" alt="" className="h-20 w-auto object-contain opacity-90" />
                  </div>
                </div>
              </div>

              {/* ── Recommended Prompts ── */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RemixIcon name="sparkling-line" size={14} className="text-[#000080] dark:text-[#93AAFD]" />
                    <span className="text-[0.8125rem] font-semibold text-zinc-900 dark:text-gray-100">
                      {t.isZh ? '推荐你试试' : 'Try these prompts'}
                    </span>
                  </div>
                  <button
                    className="flex items-center gap-1 text-[0.75rem] text-[#000080] transition-colors hover:text-[#4169E1] dark:text-[#93AAFD] dark:hover:text-[#b3c3ff]"
                    onClick={() => textareaRef.current?.focus()}
                  >
                    <RemixIcon name="refresh-line" size={12} />
                    {t.isZh ? '换一换' : 'Refresh'}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {t.examplePrompts.map((prompt, i) => {
                    const promptIcons = ['chat-3-line', 'bar-chart-line', 'robot-line'];
                    const promptColors = [
                      'bg-blue-50 text-blue-500 dark:bg-blue-900/20 dark:text-blue-400',
                      'bg-emerald-50 text-emerald-500 dark:bg-emerald-900/20 dark:text-emerald-400',
                      'bg-violet-50 text-violet-500 dark:bg-violet-900/20 dark:text-violet-400',
                    ];
                    return (
                      <button
                        key={i}
                        onClick={() => void sendMessage(prompt)}
                        disabled={sending || !selectedProviderId}
                        className="group flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 text-left text-[0.75rem] leading-relaxed text-zinc-600 transition-all hover:border-[#000080]/30 hover:shadow-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-[#4169E1]/40"
                      >
                        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${promptColors[i]}`}>
                          <RemixIcon name={promptIcons[i]} size={15} />
                        </span>
                        <span className="min-w-0 flex-1">{prompt}</span>
                        <RemixIcon name="arrow-right-up-line" size={13} className="flex-shrink-0 text-zinc-300 transition-colors group-hover:text-[#000080] dark:text-gray-600 dark:group-hover:text-[#93AAFD]" />
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* Messages */}
          {!configsLoading && hasMessages && (
            <div className="space-y-6">
              {messages.map((msg, index) => (
                <React.Fragment key={msg.id}>
                  {msg.role === 'user' ? (
                    /* ── User message ── */
                    <div data-ai-motion="message" data-ai-motion-key={index} className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[#000080] px-4 py-2.5 text-[0.87rem] leading-relaxed text-white sm:max-w-[70%]">
                        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                      </div>
                    </div>
                  ) : (
                    /* ── AI message ── */
                    <div data-ai-motion="message" data-ai-motion-key={index} className="flex items-start gap-3">
                      <img src="/assets/ai-tutor-avatar.png" alt="" className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-lg object-cover" />
                      <div className="min-w-0 flex-1 text-gray-700 dark:text-gray-300">
                        {msg.tools && msg.tools.length > 0 && (
                          <div className="mb-2">
                            <AgentProcess steps={msg.tools} phase={msg.isStreaming ? 'writing' : 'done'} lang={t.isZh ? 'zh' : 'en'} />
                          </div>
                        )}
                        <div className="break-words">
                          {renderMarkdown(msg.content)}
                          {msg.isStreaming && (
                            <span className="ml-0.5 inline-block h-[18px] w-[2px] animate-pulse bg-[#000080] dark:bg-blue-400 align-text-bottom" />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}

              {/* Active tool indicators */}
              {activeTools.length > 0 && (
                <div className="flex items-start gap-3">
                  <img src="/assets/ai-tutor-avatar.png" alt="" className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <AgentProcess steps={activeTools} phase="waiting" lang={t.isZh ? 'zh' : 'en'} />
                  </div>
                </div>
              )}

              {/* 画图中：绘图动画 */}
              {drawing && (
                <div className="flex items-start gap-3">
                  <img src="/assets/ai-tutor-avatar.png" alt="" className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-lg object-cover" />
                  <DrawingProgress {...drawing} lang={t.isZh ? 'zh' : 'en'} />
                </div>
              )}

              {/* Thinking indicator — animated dots */}
              {isThinking && !drawing && activeTools.length === 0 && !messages.some((m) => m.isStreaming) && (
                <div className="flex items-start gap-3">
                  <img src="/assets/ai-tutor-avatar.png" alt="" className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-lg object-cover" />
                  <div className="flex items-center gap-2 pt-1">
                    <AiThinkingDots />
                    <span className="text-[0.8125rem] text-gray-400 dark:text-gray-500">{t.thinking}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50/50 px-4 py-3 text-[0.8125rem] text-red-600 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400">
              <RemixIcon name="error-warning-line" size={16} className="mt-0.5 flex-shrink-0" />
              <span>{t.errorPrefix}{error}</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* ── Input area (hidden when agent panel is showing) ───── */}
      {!showingAgentPanel && !isLessonPrepMode && (
      <div data-ai-motion-chrome className="bg-white px-4 pb-4 pt-3 dark:bg-gray-900">
        <div className={`mx-auto ${isAnalyticsMode || isAssessmentMode ? '' : !configsLoading && !hasMessages && !initialAgentMode ? 'max-w-6xl' : 'max-w-3xl'}`}>
          {fallbackHint && (
            <p className="mb-2 flex items-start gap-1.5 text-[0.75rem] leading-relaxed text-zinc-500 dark:text-zinc-400">
              <RemixIcon name="information-line" size={14} className="mt-0.5 flex-shrink-0" />
              <span>{fallbackHint}</span>
            </p>
          )}
          <div className="rounded-2xl border border-gray-200 bg-gray-50/50 transition-colors focus-within:border-[#000080]/50 focus-within:bg-white dark:border-gray-700 dark:bg-gray-800/50 dark:focus-within:border-[#4169E1]/50 dark:focus-within:bg-gray-800">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.inputPlaceholder}
              disabled={sending || configsLoading}
              rows={1}
              className="w-full resize-none border-0 bg-transparent px-4 pb-1 pt-3 text-[0.875rem] leading-relaxed text-gray-800 outline-none placeholder:text-gray-400 disabled:opacity-60 dark:text-gray-200 dark:placeholder:text-gray-500"
              style={{ maxHeight: `${24 * 6}px` }}
            />
            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-0.5">
                {[
                  { icon: 'add-line', tip: t.isZh ? '更多' : 'More' },
                  { icon: 'attachment-line', tip: t.isZh ? '附件' : 'Attach' },
                  { icon: 'list-check', tip: t.isZh ? '任务' : 'Tasks' },
                  { icon: 'global-line', tip: t.isZh ? '联网' : 'Web' },
                ].map((btn, i) => (
                  <button
                    key={i}
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title={btn.tip}
                  >
                    <RemixIcon name={btn.icon} size={16} />
                  </button>
                ))}
              </div>
              <button
                onClick={() => void sendMessage(input)}
                disabled={!input.trim() || sending || configsLoading}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#000080] text-white transition-all hover:bg-[#000080]/90 disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
                title={t.send}
              >
                {sending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RemixIcon name="send-plane-fill" size={16} />
                )}
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[0.6875rem] text-gray-300 dark:text-gray-600">
            Enter ↵ {t.isZh ? '发送' : 'send'} · Shift+Enter ↵ {t.isZh ? '换行' : 'newline'}
          </p>
        </div>
      </div>
      )}
        </div>
      </div>
    </div>
  );
};

export default PersonalAgentPage;
