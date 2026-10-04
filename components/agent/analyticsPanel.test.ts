// @vitest-environment jsdom
/**
 * 学情分析左栏曾在没有数据时回落到写死的数字：活跃度 84.6%、参与深度 7.8、
 * 12 名风险学生、102/132/52 的分层、固定的「较上周期」涨跌和小折线，
 * 趋势图是一条正弦波。教师会把它们当成自己课上的真实数据。
 * 这里既扫源码（占位数字不许回来），也挂真组件看空数据和真数据时显示什么。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const api = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return {
    learnerProfiles: vi.fn(),
    activityPulse: vi.fn(),
    memoryWrite: vi.fn(async () => ({})),
  };
});

vi.mock('../../services/apiClient', () => ({
  dashboard: { learnerProfiles: api.learnerProfiles },
  teacherMemory: { write: api.memoryWrite, list: vi.fn(async () => ({ memories: [] })) },
  activityPulse: api.activityPulse,
}));

import AnalyticsPanel from './AnalyticsPanel';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function profile(userId: string, lastDaysAgo: number | null, level: 'high' | 'medium' | 'low' | 'minimal') {
  return {
    userId, userName: userId, avatar: null, scaffoldingLevel: level,
    interactionCount: 6, totalMessagesSent: 6, avgMessageLength: 40, questionsAsked: 2,
    evidenceCited: 1, connectionsMade: 1, cognitivePatterns: {}, reflectionCount: 1,
    feedbackStats: { total: 0, accepted: 0, byType: {} },
    lastInteractionAt: lastDaysAgo === null ? null : ago(lastDaysAgo),
  };
}

const EMPTY_PULSE = {
  weeks: Array.from({ length: 8 }, (_, i) => ({ label: `W${i + 1}`, startsAt: ago(56 - i * 7), notes: 0, aiInteractions: 0 })),
  acceptance: { accepted: 0, rejected: 0, pending: 0, rate: null, byTrigger: [] },
  heatmap: [], heatmapMax: 0, hasData: false,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(lang: 'zh' | 'en' = 'zh') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(AnalyticsPanel, {
      lang,
      courses: [{ id: 'course-1', title: '知识建构' }],
      selectedCourseId: 'course-1',
      onCourseChange: () => undefined,
      onSendMessage: () => undefined,
    }));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return host.textContent ?? '';
}

beforeEach(() => {
  api.learnerProfiles.mockReset();
  api.activityPulse.mockReset();
  api.memoryWrite.mockClear();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
});

describe('源码里不许再有占位数字', () => {
  const src = readFileSync(resolve(__dirname, 'AnalyticsPanel.tsx'), 'utf-8')
    // 注释里会提到这些旧数字，只查代码
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('没有写死的回落值、涨跌幅和分层人数', () => {
    for (const literal of [/84\.6/, /\b7\.8\b/, /6\.3%/, /\b102\b/, /\b132\b/, /'[-+] ?\d/]) {
      expect(src).not.toMatch(literal);
    }
  });

  it('没有「|| 数字」式的回落', () => {
    expect(src).not.toMatch(/\|\|\s*\d/);
  });

  it('没有正弦波趋势和写死的小折线', () => {
    expect(src).not.toMatch(/Math\.(sin|cos)\(/);
    expect(src).not.toMatch(/\bline:\s*\[/);
    expect(src).not.toMatch(/较上周期|vs prior/);
  });
});

describe('挂真组件', () => {
  it('没有学习画像、也没有活动时：写「暂无数据」，不出现任何编造的数', async () => {
    api.learnerProfiles.mockResolvedValue({ profiles: [] });
    api.activityPulse.mockResolvedValue({ pulse: EMPTY_PULSE });
    const text = await render();

    expect(text).toContain('暂无数据');
    expect(text).toContain('学生和 AI 对话过，才会有学习画像');
    for (const fake of ['84.6', '7.8', '102', '132', '较上周期', '达峰值']) {
      expect(text).not.toContain(fake);
    }
    // 三张指标卡都是破折号，不是 0% 或 0 —— 0 会被读成「一个都没有」
    expect(text.match(/—/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('有数据时每个数都是现算的', async () => {
    api.learnerProfiles.mockResolvedValue({
      profiles: [
        profile('a', 1, 'low'),
        profile('b', 3, 'medium'),
        profile('c', 20, 'high'),
        profile('d', null, 'high'),
      ],
    });
    api.activityPulse.mockResolvedValue({
      pulse: {
        ...EMPTY_PULSE,
        weeks: EMPTY_PULSE.weeks.map((w, i) => ({ ...w, notes: i === 6 ? 3 : i === 7 ? 5 : 0 })),
        acceptance: { accepted: 2, rejected: 1, pending: 4, rate: 67, byTrigger: [] },
        hasData: true,
      },
    });
    const text = await render();

    // 最近 14 天和 AI 对话过的：a、b → 2/4
    expect(text).toContain('50%');
    expect(text).toContain('2/4 人最近 14 天和 AI 对话过');
    // 5 天以上没对话：c、d；需要高支架：c、d；风险学生是两者并集
    expect(text).toContain('2 人 5 天以上没和 AI 对话，2 人需要高支架');
    expect(text).toContain('本周新笔记 5 条，上周 3 条');
    expect(text).toContain('AI 反馈 7 条：采纳 2，没采纳 1，还没处理 4');
    expect(text).toContain('50% 的学生需要高支架（2/4）');
    expect(text).toContain('跟进 2 名风险学生');
  });

  it('取数失败要说失败，不能伪装成「暂无数据」', async () => {
    api.learnerProfiles.mockRejectedValue(new Error('HTTP 500'));
    api.activityPulse.mockResolvedValue({ pulse: EMPTY_PULSE });
    const text = await render();
    expect(text).toContain('部分学情数据没有加载成功：HTTP 500');
  });
});
