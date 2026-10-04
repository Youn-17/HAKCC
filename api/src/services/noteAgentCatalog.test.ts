import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from './agentTools';

// student / teacher 各有专属工具，admin 并不覆盖 student 那批，所以取三者并集。
const allRegisteredTools = (): string[] => {
  const registry = createDefaultRegistry();
  return Array.from(
    new Set(
      (['student', 'teacher', 'admin'] as const).flatMap((role) =>
        registry.getToolsForRole(role).map((t) => t.function.name),
      ),
    ),
  );
};
import {
  getConversationAgentSpec,
  getAgentModeToolNames,
  getAgentLoopMode,
  normalizeConversationAgentMode,
  shouldPrepareToolsForAgentMode,
  isFreeAskMode,
  buildFreeAskSystemPrompt,
} from './noteAgentCatalog';

describe('note agent catalog', () => {
  it('maps legacy response-focus modes to explicit teaching agents', () => {
    expect(normalizeConversationAgentMode('coach')).toBe('idea_coach');
    expect(normalizeConversationAgentMode('evidence')).toBe('evidence_broker');
    expect(normalizeConversationAgentMode('community')).toBe('connection_scout');
    expect(normalizeConversationAgentMode('synthesis')).toBe('rise_above_coach');
    expect(normalizeConversationAgentMode('gap_finder')).toBe('gap_finder');
    expect(normalizeConversationAgentMode('unknown')).toBe('idea_coach');
  });

  it('encodes bounded agency and Knowledge Building action rules', () => {
    const spec = getConversationAgentSpec('gap_finder');

    expect(spec.id).toBe('gap_finder');
    expect(spec.systemInstruction).toContain('bounded autonomy');
    expect(spec.systemInstruction).toContain('knowledge gap');
    expect(spec.systemInstruction).toContain('student epistemic agency');
  });

  it('prepares tools for all agent modes', () => {
    expect(shouldPrepareToolsForAgentMode('connection_scout')).toBe(true);
    expect(shouldPrepareToolsForAgentMode('rise_above_coach')).toBe(true);
    expect(shouldPrepareToolsForAgentMode('gap_finder')).toBe(true);
    expect(shouldPrepareToolsForAgentMode('idea_coach')).toBe(true);
    expect(shouldPrepareToolsForAgentMode('evidence_broker')).toBe(true);
    expect(shouldPrepareToolsForAgentMode('lesson_planner')).toBe(true);
    expect(shouldPrepareToolsForAgentMode('teaching_analyst')).toBe(true);
  });

  it('assigns mode-specific tool sets', () => {
    expect(getAgentModeToolNames('idea_coach')).toContain('read_note');
    expect(getAgentModeToolNames('idea_coach')).toContain('analyze_argument');
    expect(getAgentModeToolNames('connection_scout')).toContain('compare_notes');
    expect(getAgentModeToolNames('evidence_broker')).toContain('web_search');
    expect(getAgentModeToolNames('rise_above_coach')).toContain('search_notes');
    // Context bridging: connection_scout and rise_above_coach have get_workspace_summary
    expect(getAgentModeToolNames('connection_scout')).toContain('get_workspace_summary');
    expect(getAgentModeToolNames('rise_above_coach')).toContain('get_workspace_summary');
  });

  it('assigns teacher-specific tool sets', () => {
    expect(getAgentModeToolNames('lesson_planner')).toContain('lesson_scaffold');
    expect(getAgentModeToolNames('lesson_planner')).toContain('web_search');
    expect(getAgentModeToolNames('teaching_analyst')).toContain('class_analytics');
    expect(getAgentModeToolNames('teaching_analyst')).toContain('suggest_triggers');
    expect(getAgentModeToolNames('teaching_analyst')).toContain('list_note_discussions');
  });

  it('normalizes teacher agent modes', () => {
    expect(normalizeConversationAgentMode('lesson_planner')).toBe('lesson_planner');
    expect(normalizeConversationAgentMode('teaching_analyst')).toBe('teaching_analyst');
  });

  it('sets rise_above_coach to reflection loop mode', () => {
    expect(getAgentLoopMode('rise_above_coach')).toBe('reflection');
    expect(getAgentLoopMode('idea_coach')).toBe('react');
    expect(getAgentLoopMode('gap_finder')).toBe('react');
    expect(getAgentLoopMode('lesson_planner')).toBe('react');
    expect(getAgentLoopMode('teaching_analyst')).toBe('react');
  });

  // 目录里的工具名是靠字符串跟注册表对齐的，三个入口都用
  // `registry.getToolsForRole(role).filter(t => modeToolNames.includes(t.name))`。
  // 名字对不上不会报错，只会把工具悄悄丢掉——曾经因此让学生端 Agent 完全读不到笔记。
  it('only lists tools that actually exist in the registry', () => {
    const registered = new Set(allRegisteredTools());
    const modes = [
      'idea_coach', 'gap_finder', 'connection_scout', 'evidence_broker',
      'rise_above_coach', 'lesson_planner', 'teaching_analyst',
    ] as const;

    const unknown = modes.flatMap((mode) =>
      getAgentModeToolNames(mode)
        .filter((name) => !registered.has(name))
        .map((name) => `${mode}: ${name}`),
    );

    expect(unknown).toEqual([]);
  });

  // 提示词里点名的工具必须真的挂在该模式上，否则模型会去调一个拿不到的工具。
  it('grants every tool its own system instruction tells the model to use', () => {
    const modes = [
      'idea_coach', 'gap_finder', 'connection_scout', 'evidence_broker',
      'rise_above_coach', 'lesson_planner', 'teaching_analyst',
    ] as const;
    const allTools = allRegisteredTools();

    const missing = modes.flatMap((mode) => {
      const spec = getConversationAgentSpec(mode);
      // 只看「Use <tool> ...」这种无条件祈使句。共享规则里的
      // 「When you have X tools available」是条件句，不构成可用性断言。
      const directives = spec.systemInstruction
        .split('\n')
        .filter((line) => line.trimStart().startsWith('Use '))
        .join('\n');
      return allTools
        .filter((tool) => new RegExp(`\\b${tool}\\b`).test(directives))
        .filter((tool) => !spec.toolNames.includes(tool))
        .map((tool) => `${mode} 提示词提到 ${tool}，但工具集里没有`);
    });

    expect(missing).toEqual([]);
  });

  // 自由提问不是任何一个智能体。归一化会把空值变成 idea_coach，所以这两件事必须分开判。
  it('treats a missing agent mode as free ask, never as a named agent', () => {
    expect(isFreeAskMode(undefined)).toBe(true);
    expect(isFreeAskMode(null)).toBe(true);
    expect(isFreeAskMode('')).toBe(true);
    expect(isFreeAskMode('free_ask')).toBe(true);
    expect(isFreeAskMode('idea_coach')).toBe(false);
    expect(isFreeAskMode('coach')).toBe(false);
  });

  it('gives free ask a plain prompt: no persona, no tools, no withholding', () => {
    const prompt = buildFreeAskSystemPrompt({ title: 'T', text: 'my draft' });
    expect(prompt).not.toMatch(/Knowledge Building|pedagogical|follow-up question that can improve/i);
    expect(prompt).not.toMatch(/read_note|search_space_notes|list_related_notes/);
    expect(prompt).toMatch(/Answer the question that is asked/);
    expect(prompt).toMatch(/my draft/);
    // 笔记是空的就不附背景段
    expect(buildFreeAskSystemPrompt({ title: 'T', text: '  ' })).not.toMatch(/BACKGROUND/);
  });

});
