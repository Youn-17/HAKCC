import {
  getConversationAgentSpec,
  normalizeConversationAgentMode,
} from './noteAgentCatalog';
import {
  getOrCreateProfile,
  getScaffoldingPrompt,
  loadReflections,
  buildReflectionContext,
  detectOverrelianceSignals,
  updateProfileAfterInteraction,
  type LearnerProfile,
  type ScaffoldingLevel,
} from './learnerProfileService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole = 'student' | 'teacher' | 'admin';

export type NoteContext = {
  id: string;
  title: string;
  content: string;
  spaceId: string;
  courseId: string;
};

export type ConversationMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

export type AgentContextParams = {
  note: NoteContext;
  history: ConversationMessage[];
  agentMode: string;
  userRole: AgentRole;
  userId: string;
  courseId: string;
  spaceId: string;
  toolNames?: string[];
  userMessage?: string;
};

export type BuiltAgentContext = {
  systemPrompt: string;
  messages: ConversationMessage[];
  toolContext: {
    noteId: string;
    spaceId: string;
    courseId: string;
    userId: string;
    userRole: AgentRole;
    noteTitle: string;
    noteContent: string;
  };
  learnerProfile?: LearnerProfile;
  overrelianceDetected?: boolean;
  frictionMessage?: string | null;
};

// ---------------------------------------------------------------------------
// HTML / content helpers
// ---------------------------------------------------------------------------

/** Remove HTML tags and collapse runs of whitespace into single spaces. */
export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Truncate `content` to at most `maxLength` characters, adding "..." when cut. */
export function summarizeContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '...';
}

// ---------------------------------------------------------------------------
// Role instructions
// ---------------------------------------------------------------------------

const ROLE_INSTRUCTIONS: Record<AgentRole, string> = {
  student: [
    'You are assisting a student.',
    'Preserve the learner\'s epistemic agency: do not give direct answers or write the final idea for them.',
    'Guide their thinking through questions, contrasts, and evidence pointers.',
    'Help the learner develop their own ideas so the resulting Note reflects their voice.',
  ].join(' '),
  teacher: [
    'You are assisting a teacher.',
    'You can use lesson planning, analytics, and classroom-overview tools when available.',
    'Provide pedagogical insights grounded in Knowledge Building principles.',
    'Help the teacher understand student progress and suggest facilitation moves.',
  ].join(' '),
  admin: [
    'You are assisting a course administrator.',
    'You can use lesson planning, analytics, and classroom-overview tools when available.',
    'Provide pedagogical insights grounded in Knowledge Building principles.',
    'Help the administrator understand student progress and suggest facilitation moves.',
  ].join(' '),
};

export function buildRoleInstructions(role: AgentRole): string {
  return ROLE_INSTRUCTIONS[role] ?? ROLE_INSTRUCTIONS.student;
}

// ---------------------------------------------------------------------------
// Tool instructions
// ---------------------------------------------------------------------------

/**
 * Build a prompt section that lists the tools available to the agent and
 * instructs it on how to use them inside a ReAct loop.
 *
 * When no tools are provided the section is omitted entirely so the system
 * prompt stays lean.
 */
export function buildToolInstructions(toolNames: string[]): string {
  if (toolNames.length === 0) return '';

  const toolList = toolNames.map((name) => `- ${name}`).join('\n');

  return [
    'You have the following tools available:',
    toolList,
    '',
    'When you need more information, call a tool and wait for its result before continuing.',
    'You may call multiple tools in sequence if needed.',
    'After gathering enough context, provide your final response to the user.',
    'Think step by step: observe the current state, decide which tool (if any) would help, act, then respond.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// History management
// ---------------------------------------------------------------------------

const DEFAULT_MAX_MESSAGES = 10;

/**
 * If `messages` exceeds `maxMessages`, compress the oldest messages into a
 * single system-role summary and keep the most recent ones intact.
 *
 * The summary captures the key topics discussed and any conclusions reached so
 * the agent retains conversational context without exceeding the window.
 */
export function summarizeHistory(
  messages: ConversationMessage[],
  maxMessages: number = DEFAULT_MAX_MESSAGES,
): ConversationMessage[] {
  if (messages.length <= maxMessages) return messages;

  const cutoff = messages.length - maxMessages;
  const older = messages.slice(0, cutoff);
  const recent = messages.slice(cutoff);

  // Build a condensed summary of the earlier conversation.
  const topics: string[] = [];
  for (const msg of older) {
    if (!msg.content) continue;
    // Keep the first sentence of each message as a topic signal.
    const firstSentence = msg.content
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+/)[0];
    if (firstSentence) {
      const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
      topics.push(`${prefix}: ${summarizeContent(firstSentence, 120)}`);
    }
  }

  const summaryText = [
    '[Earlier conversation summary]',
    topics.length > 0
      ? topics.join('\n')
      : 'The conversation covered preliminary discussion about the note.',
  ].join('\n');

  const summaryMessage: ConversationMessage = {
    role: 'system',
    content: summaryText,
  };

  return [summaryMessage, ...recent];
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Assemble the complete context required for one iteration of the agent loop.
 *
 * The function is intentionally pure (aside from the `getConversationAgentSpec`
 * lookup which is synchronous and side-effect-free).  All Supabase reads
 * happen upstream in the caller; this function only shapes the data.
 */
export async function buildAgentContext(
  params: AgentContextParams,
): Promise<BuiltAgentContext> {
  const {
    note,
    history,
    agentMode,
    userRole,
    userId,
    courseId,
    spaceId,
    toolNames = [],
    userMessage,
  } = params;

  const agentSpec = getConversationAgentSpec(normalizeConversationAgentMode(agentMode));
  const plainContent = stripHtml(note.content);
  const contentSummary = summarizeContent(plainContent, 1200);

  // --- Learner profile & cognitive friction (students only) ---
  let learnerProfile: LearnerProfile | undefined;
  let overrelianceDetected = false;
  let frictionMessage: string | null = null;
  let scaffoldingSection = '';
  let reflectionSection = '';

  if (userRole === 'student') {
    try {
      const [profile, reflections] = await Promise.all([
        getOrCreateProfile(userId, courseId),
        loadReflections(userId, courseId),
      ]);
      learnerProfile = profile;

      scaffoldingSection = getScaffoldingPrompt(profile.scaffoldingLevel);
      reflectionSection = buildReflectionContext(reflections);

      if (userMessage) {
        const signals = detectOverrelianceSignals(userMessage);
        overrelianceDetected =
          signals.isDirectAnswerRequest ||
          signals.isCopyPasteRequest ||
          signals.isLazyDelegation;
        frictionMessage = signals.frictionResponse;
      }
    } catch (err) {
      console.error('[AgentContext] Learner profile load failed, using defaults:', err);
    }
  }

  // --- System prompt sections ---
  const sections: string[] = [
    // 1. Base identity
    'You are a pedagogical GenAI collaborator inside a Knowledge Building note editor. Help the learner improve the current idea. Be concise, concrete, and evidence-oriented.',

    // 2. Agent-mode-specific instruction
    agentSpec.systemInstruction,

    // 3. Role-specific instructions
    buildRoleInstructions(userRole),

    // 4. Note context
    `Current note title: ${note.title}\nCurrent note content: ${contentSummary}`,
  ];

  // 5. Adaptive scaffolding (students only)
  if (scaffoldingSection) {
    sections.push(scaffoldingSection);
  }

  // 6. Cross-session memory (students only)
  if (reflectionSection) {
    sections.push(reflectionSection);
  }

  // 7. Active cognitive friction warning
  if (overrelianceDetected) {
    sections.push(
      'COGNITIVE FRICTION ALERT: The student\'s latest message shows signs of cognitive offloading (asking for direct answers or copy-paste content). ' +
      'You MUST redirect them toward their own thinking. Do NOT comply with the request directly. ' +
      'Instead, ask a guiding question or offer a thinking framework.',
    );
  }

  // 8. Tool instructions (only if tools are available)
  const toolSection = buildToolInstructions(toolNames);
  if (toolSection) {
    sections.push(toolSection);
  }

  // 9. Agent loop guidance
  sections.push(
    'You can call tools to gather information. After gathering enough context, provide your final response. Think step by step.',
  );

  const systemPrompt = sections.join('\n\n');

  // --- Messages (sliding window) ---
  const messages = summarizeHistory(history, DEFAULT_MAX_MESSAGES);

  // --- Tool context for executors ---
  const toolContext = {
    noteId: note.id,
    spaceId,
    courseId,
    userId,
    userRole,
    noteTitle: note.title,
    noteContent: plainContent,
  };

  return {
    systemPrompt,
    messages,
    toolContext,
    learnerProfile,
    overrelianceDetected,
    frictionMessage,
  };
}

// ---------------------------------------------------------------------------
// Post-interaction profile update (call after agent loop completes)
// ---------------------------------------------------------------------------

export { updateProfileAfterInteraction, saveReflection } from './learnerProfileService';
export type { ScaffoldingLevel } from './learnerProfileService';
