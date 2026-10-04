
import React from 'react';

// ── Auth Types (added for backend integration) ────────────────

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status?: 'active' | 'pending' | 'inactive';
  avatar?: string;
  /** 所在学院 */
  school?: string | null;
  age?: number | null;
  bio?: string | null;
}

/** ApiNote: the backend wire format (no React-specific fields) */
export type ApiNote = Omit<Note, 'icon' | 'customStyle' | 'className'> & {
  author_id: string;
  space_id: string;
  created_at: string;
  updated_at: string;
  users?: { name: string; avatar?: string };
};

export type EpistemicStatus = 'standard' | 'promising' | 'authoritative' | 'needs_work' | 'unresolved';

export type KnowledgeLackType =
  | 'unanswered_question'
  | 'confusion'
  | 'contradiction'
  | 'needed_evidence'
  | 'need_to_understand';

export interface KnowledgeLack {
  id: string;
  type: KnowledgeLackType;
  text: string;
  createdAt?: string;
  resolvedAt?: string;
}

export interface Note {
  id: string;
  type: 'note' | 'drawing' | 'attachment' | 'video' | 'link' | 'view' | 'riseabove' | 'ai_dialogue';
  epistemicStatus?: EpistemicStatus;
  title: string;
  author: string;
  authorId?: string;
  authorAvatar?: string;
  date: string;
  /** ISO timestamp — the source of truth for formatting; `date` is a locale string. */
  createdAt?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  content?: string;
  inquiryQuestion?: string;
  promisingReason?: string;
  knowledgeLacks?: KnowledgeLack[];
  icon?: React.ReactNode;
  group?: string; // For clustering
  tags?: string[]; // Support for tag-based filtering
  views?: string[]; // IDs of views this note belongs to
  // New properties for custom visuals
  customStyle?: React.CSSProperties;
  className?: string;
  // Data for drawing tool
  drawingData?: any[]; 
  // Data for attachments
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  isPreviewMode?: boolean; // If true, show media directly on canvas
  isFixed?: boolean; // If true, pinned in place — selectable but not draggable
  metadata?: Record<string, unknown>; // Canvas presentation prefs, persisted
  
  // Rise Above Specific Data
  citedNoteIds?: string[];
  riseAboveData?: {
    status: 'draft' | 'published';
    keywords?: string[];
    summary?: string;
  };

  // Feedback fields
  feedbacks?: NoteFeedback[];
  unreadFeedback?: boolean;
  /** 我（当前用户）打开过没有。false = 还没有，别人的卡片在我这里标 New；列表接口以外的来源不带这个字段 */
  seenByMe?: boolean;
  metrics?: {
    directInDegree: number;
    directOutDegree: number;
    buildOnCount: number;
    uniqueContributorCount: number;
    challengeCount: number;
    evidenceCount: number;
    synthesisCount: number;
    revisionCount: number;
    heatScore: number;
  };
}

export interface NoteFeedback {
  id: string;
  noteId: string;
  /** KB-theory evaluation text (teacher-only view) */
  aiEvaluation?: string;
  /** Student-facing feedback summary */
  studentSummary: string;
  /** Teacher's additional notes/edits */
  teacherNote?: string;
  publishedBy?: string;
  publishedAt?: string;
  isRead?: boolean;
  createdAt: string;
}

export type RelationType = 'extend' | 'clarify' | 'question' | 'challenge' | 'evidence' | 'synthesize';

export interface Edge {
  id: string;
  source: string;
  target: string;
  relationType?: RelationType;
  aiSuggested?: boolean;
  aiAccepted?: boolean;
}

export interface SidebarItem {
  id: string;
  label: string;
  icon: React.ElementType;
  active?: boolean;
}

export type ViewMode = 'Welcome' | 'Map' | 'List';

export interface GeneratedContent {
  title: string;
  body: string;
}

// --- Scaffold Types ---

export interface ScaffoldStep {
  id: string;
  prompt: string; // "My theory is..."
  placeholder?: string; // "Explain your core idea here"
  type: 'text' | 'textarea' | 'select' | 'multiselect';
  options?: string[]; // For select/multiselect type
  required: boolean;
}

/** 三框架标注 + 学期出现记录，来自五学期支架分类表 */
export interface ScaffoldMetadata {
  l1?: 'TB' | 'CT' | 'GAI' | 'KB';
  l1_zh?: string;
  l1_en?: string;
  l2_zh?: string;
  l2_en?: string;
  hannafin?: string;
  saye_brush?: string;
  liu_metacognitive?: string;
  gai?: boolean;
  semesters?: string[];
  variants?: string[];
  /** 合并了几种原始写法（五学期语料里同一条支架的不同措辞） */
  merged_from?: number;
  source?: string;
  /** Hannafin 之外再细分一层功能类型（Conceptual / Metacognitive / Procedural / Strategic），2026-09 新增的能动性支架才有 */
  hannafin_function?: string;
  /** 对应 AE-AI 的哪个因子：adaptive_direction / critical_integration / cross_source_inquiry / reflective_calibration */
  agency_factor?: string;
  /** 对应的 AE-AI 题项：AD=适应性引导 CI=批判性整合 CS=跨源探究 RC=反思性校准，序号按问卷题目顺序 */
  ae_ai_items?: string[];
  /** 对应的 AI 素养题项：EV=评估 CD=创造与设计 */
  literacy_items?: string[];
}

export interface Scaffold {
  id: string;
  /** 教师在本课程隐藏了它；学生端看不到 */
  hidden?: boolean;
  title: string;
  titleEn?: string;      // 英文支架文本，界面按语言切换
  description: string;
  category: string; // Hierarchical path e.g., "Knowledge Building/Theory"
  icon?: string; // Lucide icon name
  color?: string; // Tailwind color class
  steps: ScaffoldStep[];
  metadata?: ScaffoldMetadata;
  sortOrder?: number;
  usageCount: number;
  isMandatory: boolean; // Teacher setting
  isRecommended: boolean;
  courseId?: string; // null = global scaffold
  createdBy?: string;
}

// --- Group & SSRL Types ---

export interface Group {
  id: string;
  name: string;
  courseId: string;
  memberIds: string[];
  leaderId?: string;
  color?: string;
  aiFeedbackCondition?: 'treatment' | 'control' | null;
}

export type SSRLPhase = 'planning' | 'monitoring' | 'evaluating';

export interface GroupTask {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  assignedToId: string; // Member ID
  createdById: string;
  status: 'todo' | 'in_progress' | 'done';
  ssrlPhase: SSRLPhase;
  createdAt: string;
}

// --- Notification Types ---

export interface Notification {
  id: string;
  userId: string; // Recipient
  type: 'system' | 'task' | 'buildon' | 'mention' | 'teacher';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  link?: { type: 'note' | 'group' | 'view'; id: string }; // Deep link for action
}

// --- Platform Types ---

export type UserRole = 'student' | 'teacher' | 'admin';

export interface Member {
  id: string;
  name: string; // English username
  email: string;
  role: UserRole;
  /** 课内身份，和平台身份分开：平台教师在别人的课里也可能只是普通成员。 */
  courseRole?: 'owner' | 'manager' | 'member';
  avatar?: string;
  status: 'active' | 'pending' | 'inactive';
  lastLogin?: string;
}

export interface Course {
  id: string;
  title: string;
  instructor: string;
  instructor_id?: string; // teacher's user ID
  studentCount: number;
  noteCount: number;
  progress?: number; // 0-100 for students
  visits?: number;   // for admin/teacher
  rating?: number;   // for admin
  coverImage?: string; // CSS gradient or URL
  tags: string[];
  createDate?: string;
  verification_code?: string; // 4-character code for joining course
  hasAi?: boolean;
  hasUnreadFeedback?: boolean;
  unreadFeedbackCount?: number;
  lastActivityAt?: string | null;
}

export type Language = 'en' | 'zh';

// --- GenAI Integration Types ---

export type AIProviderId = 
  | 'openai' 
  | 'anthropic' 
  | 'google' 
  | 'xai' 
  | 'openrouter' 
  | 'deepseek' 
  | 'doubao' 
  | 'moonshot' 
  | 'baidu' 
  | 'alibaba' 
  | 'zhipu';

export interface AIProvider {
  id: AIProviderId;
  name: string;
  nameZh: string;
  icon: string; // Emoji or URL
  description?: string;
  models: string[]; // Available models
  isConfigured: boolean; // Is configured by the current teacher
  isEnabled: boolean; // Is enabled in the current course
}

export interface TeacherAIConfig {
  providerId: AIProviderId;
  apiKey: string; // Masked in UI
  endpointUrl?: string;
  isVerified: boolean;
  configuredAt: string;
  enabledModels: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  providerId: AIProviderId;
  model: string;
}

export interface ChatSession {
  id: string;
  studentId: string;
  courseId: string;
  noteId: string | null; // Null means unclassified/general chat
  noteTitle?: string; // For display convenience
  providerId: AIProviderId;
  model: string;
  startTime: string;
  messages: ChatMessage[];
}

// Stats Types
export interface StudentChatStats {
  studentId: string;
  studentName: string;
  totalMessages: number;
  byNote: {
    noteTitle: string;
    messageCount: number;
    providers: { providerId: AIProviderId; count: number }[];
  }[];
}

export interface AdminAIStats {
  platformTotals: {
    totalCourses: number;
    totalTeachers: number;
    totalStudents: number;
    totalMessages: number;
  };
  providerUsage: {
    providerId: AIProviderId;
    count: number;
    percentage: number;
  }[];
  courseUsage: {
    courseId: string;
    courseName: string;
    teacherName: string;
    messageCount: number;
    activeProviders: AIProviderId[];
  }[];
}

// --- View Management Types ---

/**
 * View 就是一块独立画布，没有别的含义。视图之间不存在层级 —— 一张卡片
 * （view_cards 表）可以把任何视图摆到任何画布上，那是导航，不是包含关系。
 */
export interface ViewDefinition {
  id: string;
  title: string;
  description?: string;
  /** 创建者的 user id；Welcome 是虚拟视图，这里为空。 */
  creatorId: string;
  createdAt: string;
  lastModified: string;
}

// --- Research & Analytics Types ---

export interface AnalyticsLogEntry {
  id: string;
  timestamp: string;
  studentId: string;
  studentName: string;
  noteId: string | null;
  noteTitle: string;
  provider: AIProviderId;
  model: string;
  messageCount: number;
  durationSeconds: number;
  topics: string[]; 
}

// Detailed Student Dashboard Types
export interface StudentDetailMetrics {
  studentId: string;
  name: string;
  studentNumber: string;
  avatar: string;
  status: 'active' | 'moderate' | 'inactive';
  lastActive: string;
  joinDate: string;
  
  // Card 1: Content
  content: {
    noteCount: number;
    totalWords: number;
    avgWords: number;
  };
  // Card 2: KB
  kb: {
    buildOnGiven: number;
    buildOnReceived: number;
    depth: number;
  };
  // Card 3: Collaboration
  collab: {
    readCount: number;
    commentsGiven: number;
    feedbackReceived: number;
  };
  // Card 4: AI
  ai: {
    sessions: number;
    messages: number;
    topProvider: string;
  };
  // Card 5: Time
  time: {
    totalHours: number;
    activeDays: number;
    avgSessionMin: number;
  };
  // Card 6: Score
  score: {
    value: number; // 0-100
    level: string; // 'Active'
  };
  
  // Charts Data
  timelineData: { date: string; notes: number; buildons: number; comments: number; ai: number }[];
  radarData: { subject: string; A: number; fullMark: number }[]; // For Learning Style
  heatmapData: { date: string; count: number; level: number }[];
  noteTypeDist: { type: string; value: number }[];
}

// --- Student Profile & Portfolio Types ---

export interface Badge {
  id: string;
  name: string;
  icon: string; 
  description: string;
  earnedDate: string;
  type: 'achievement' | 'milestone' | 'skill';
  level?: 'bronze' | 'silver' | 'gold';
}

export interface TimelineEvent {
  id: string;
  type: 'join' | 'note' | 'buildon' | 'milestone' | 'ai' | 'feedback';
  title: string;
  description?: string;
  date: string;
  relatedId?: string;
  icon?: string; // Lucide icon name
}

export interface LearningStyleProfile {
  radar: { subject: string; A: number; fullMark: number }[];
  creationPreference: { independent: number; collaborative: number }; // percentages
  expressionPreference: { text: number; visual: number; multimedia: number };
  topTopics: { text: string; value: number }[];
  personaTags: string[]; // e.g. "Visual Thinker", "Early Bird"
}

export interface PortfolioItem {
  id: string;
  title: string;
  type: string; // 'note', 'discussion'
  date: string;
  preview: string;
  stats: { buildons: number; reads: number; likes: number };
  tags: string[];
}

export interface StudentProfileData {
  studentId: string;
  info: {
    name: string;
    id: string;
    major: string;
    email: string;
    avatar: string;
    coverImage: string;
    joinDate: string;
    lastActive: string;
  };
  stats: {
    totalNotes: number;
    noteRank: number; // percentile
    buildOnScore: number;
    collabScore: number;
    aiUsage: number;
    totalHours: number;
    activeDays: number;
  };
  badges: Badge[];
  timeline: TimelineEvent[];
  learningStyle: LearningStyleProfile;
  portfolio: PortfolioItem[];
  feedback: { id: string; source: string; content: string; date: string; type: 'teacher'|'peer'|'ai' }[];
}

// --- Citation / Build-on Network Types ---

export interface CitationNode {
  id: string;
  label: string;
  author: string;
  group: number; // For clustering/community detection
  type: 'note' | 'question' | 'theory' | 'idea';
  createdAt: string;
  val: number; // Size based on citations
  
  // Centrality Metrics
  degreeCentrality: number;
  betweennessCentrality: number;
  closenessCentrality: number;
  
  // Coordinates (Pre-calculated for force simulation)
  x?: number;
  y?: number;
}

export interface CitationLink {
  source: string;
  target: string;
  type: 'build-on' | 'reference';
  createdAt: string;
}

export interface NetworkMetrics {
  totalNodes: number;
  totalEdges: number;
  density: number;
  diameter: number;
  avgClusteringCoefficient: number;
  connectedComponents: number;
  isolatedNodes: number;
}

// Enhanced structures for the 16 modules
export interface AnalyticsModuleData {
  genAiHistory: AnalyticsLogEntry[];
  // Basic list for general views
  studentMetrics: {
    studentId: string;
    name: string;
    notesCreated: number;
    buildOnsGiven: number;
    buildOnsReceived: number;
    reads: number;
    aiConversations: number;
    activityScore: number; // 0-100
  }[];
  // Detailed data for Student Dashboard (Module 2)
  studentDetails: StudentDetailMetrics[]; 
  
  // Detailed data for Citation Dashboard (Module 3)
  citationNetwork: {
    nodes: CitationNode[];
    links: CitationLink[];
    metrics: NetworkMetrics;
  };
  
  // Detailed data for Student Profile (Module 4)
  studentProfile: StudentProfileData;

  networkGraph: { // Legacy simple graph
    nodes: { id: string; label: string; type: 'student'|'note'; val: number }[];
    links: { source: string; target: string; type: string }[];
  };
  wordCloud: { text: string; value: number }[];
  activityHeatmap: { date: string; value: number }[];
  keyConcepts: { concept: string; frequency: number; related: string[] }[];
}

export interface AnalyticsData {
  overview: {
    totalSessions: number;
    totalMessages: number;
    activeStudents: number;
    avgSessionDuration: number;
  };
  modules: AnalyticsModuleData;
}

// --- CT Problem Solving Types ---

export type CTDifficulty = 'easy' | 'medium' | 'hard' | 'expert';
export type CTStatus = 'not_started' | 'in_progress' | 'completed' | 'abandoned';
export type CTStepId = 'analysis' | 'pattern' | 'abstraction' | 'algorithm' | 'coding' | 'evaluation';

// Detailed CT Problem Structure
export interface CTProblem {
  id: string;
  title: string;
  titleZh?: string;
  description: string;
  category: string; // e.g. 'Recursion', 'Graph', 'Sorting'
  difficulty: CTDifficulty;
  tags: string[];
  participants: number;
  rating: number;
  status?: CTStatus;
  currentStep?: number;
  progress?: number;
  lastActive?: string;
  
  // Tool Specific Data
  decompositionData?: { root: string, nodes: string[] }; // Initial decomposition hints
  patternData?: { inputs: string[], outputs: string[], hint: string }; // Input/Output pairs for pattern recognition
  graphTemplate?: { nodes: {id: string, label: string, x: number, y: number}[], edges: {source: string, target: string}[] }; // Initial knowledge graph
  algorithmBlocks?: string[]; // Available pseudocode blocks
  starterCode?: string; // Python starter code
  testCases?: { input: string, expected: string }[]; // Validated by simulated runner
}

export interface CTStepData {
  id: CTStepId;
  title: string;
  status: 'locked' | 'available' | 'in_progress' | 'completed';
  data?: any;
}

// --- Course Settings Types ---

export interface CourseGoal {
  id: string;
  courseId: string;
  title: string;
  description?: string | null;
  /** 0 低 / 1 中 / 2 高 */
  priority: number;
  createdAt: string;
  updatedAt?: string;
  createdBy?: {
    id: string;
    name: string;
    avatar?: string;
  } | null;
}

export interface CourseMaterial {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  uploadedBy?: {
    id: string;
    name: string;
    avatar?: string;
  };
  /** 这份资料在课程 AI 知识库里的实际状态 */
  knowledgeBase?: {
    state: 'unsupported' | 'processing' | 'ready' | 'unsearchable' | 'no_text' | 'failed';
    /** 本地抽的正文已入库，MinerU 还在做结构化解析 */
    refining: boolean;
    chars: number;
    chunks: number;
  };
  createdAt: string;
}

export interface MaterialComment {
  id: string;
  materialId: string;
  userId: string;
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  content: string;
  annotationData?: Record<string, unknown>;
  createdAt: string;
}

export type CourseTaskStatus = 'draft' | 'published' | 'closed';
export type TaskSubmissionStatus = 'pending' | 'submitted' | 'graded' | 'returned';
export type TaskSubmissionType = 'text' | 'file' | 'drawing' | 'video' | 'mixed';

export interface CourseTask {
  id: string;
  courseId: string;
  title: string;
  description?: string | null;
  /** 带时区的 ISO 时间；没有截止时间是 null */
  dueDate?: string | null;
  /** 分值（满分），0 表示不计分 */
  points: number;
  status: CourseTaskStatus;
  createdBy?: {
    id: string;
    name: string;
    avatar?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  /** 课程教职看到的是全班的；其他人只算自己那一份 */
  submissionStats: {
    total: number;
    submitted: number;
    graded: number;
  };
}

export interface TaskSubmission {
  id: string;
  taskId: string;
  studentId: string;
  student?: {
    id: string;
    name: string;
    avatar?: string;
  } | null;
  content?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  drawingData?: Record<string, unknown> | null;
  videoUrl?: string | null;
  submissionType: TaskSubmissionType;
  status: TaskSubmissionStatus;
  submittedAt?: string | null;
  gradedAt?: string | null;
  feedback?: string | null;
  pointsAwarded?: number | null;
}
