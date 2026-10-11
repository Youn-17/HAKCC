import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CSP, answeredLabel, applyAgentEvent, artifactFileName, choiceReplyText, extrasFromLiveMetadata, extrasFromMetadata,
  extrasToMetadata, hasExtras, latestArtifacts, looksLikeMakerTask, sandboxedDocument, type AgentExtras,
} from './agentTurn';

/** 智能体一轮里文字以外的东西（2026-10-11）：流里的事件和存下的 ai_metadata 还原成同一个样子 */

const question = { id: 'q1', question: '用哪种方式呈现？', options: [{ label: '概念图', detail: '看清联系' }, { label: '对比表' }], allowOther: true };

describe('流里的事件', () => {
  it('计划 → 写网页进度 → 网页做好（进度清掉）→ 改成第 2 版（同一个网页只留最新）→ 问题', () => {
    let extras: AgentExtras = {};
    extras = applyAgentEvent(extras, { agentPlan: { steps: [{ title: '找笔记', status: 'in_progress' }, { title: '做网页', status: 'pending' }] } })!;
    expect(extras.plan?.steps).toHaveLength(2);
    extras = applyAgentEvent(extras, { artifactStatus: { stage: 'writing', title: '概念图', chars: 3200 } })!;
    expect(extras.progress).toEqual({ stage: 'writing', title: '概念图', chars: 3200 });
    extras = applyAgentEvent(extras, { artifact: { id: 'a1', groupId: 'g1', title: '概念图', version: 1, kind: 'html', bytes: 9000 } })!;
    expect(extras.progress).toBeUndefined();
    extras = applyAgentEvent(extras, { artifact: { id: 'a2', groupId: 'g1', title: '概念图', version: 2, kind: 'html', bytes: 9500 } })!;
    expect(extras.artifacts?.map(a => a.id)).toEqual(['a2']);
    extras = applyAgentEvent(extras, { agentQuestion: question })!;
    expect(extras.question?.options.map(o => o.label)).toEqual(['概念图', '对比表']);
    // 别的事件不归这里管
    expect(applyAgentEvent(extras, { token: '你好' })).toBeNull();
    expect(applyAgentEvent(extras, { kbSources: [] })).toBeNull();
  });

  it('坏数据不收：没标题的步骤、少于两个选项的问题、没 id 的网页', () => {
    expect(applyAgentEvent({}, { agentPlan: { steps: [{ title: '' }] } })).toEqual({});
    expect(applyAgentEvent({}, { agentQuestion: { id: 'q', question: '要吗', options: [{ label: '要' }] } })).toEqual({});
    expect(applyAgentEvent({}, { artifact: { title: '没 id' } })).toEqual({});
  });

  it('前端消息上存的那几个键 ↔ AgentExtras（写网页进度只在前端有）', () => {
    const extras: AgentExtras = { plan: { steps: [{ title: '找笔记', status: 'done' }] }, progress: { stage: 'writing', title: 'x', chars: 10 } };
    expect(extrasFromLiveMetadata(extrasToMetadata(extras))).toEqual(extras);
    expect(hasExtras({})).toBe(false);
    expect(hasExtras(extras)).toBe(true);
  });
});

describe('存下的 ai_metadata', () => {
  it('计划、问题、网页（同一网页多版只留最新）', () => {
    const extras = extrasFromMetadata({
      plan: { steps: [{ title: '找笔记', status: 'done' }, { title: '做网页', status: 'weird' }] },
      question,
      artifacts: [{ id: 'a1', groupId: 'g1', title: '概念图', version: 1, bytes: 1 }, { id: 'a2', groupId: 'g1', title: '概念图', version: 2, bytes: 2 }, { id: 'b1', title: '自测题', version: 1 }],
      kb_sources: [],
    });
    expect(extras.plan?.steps[1].status).toBe('pending');
    expect(extras.question?.allowOther).toBe(true);
    expect(extras.artifacts?.map(a => a.id)).toEqual(['a2', 'b1']);
    expect(extrasFromMetadata(null)).toEqual({});
    expect(latestArtifacts([])).toEqual([]);
  });
});

describe('选项卡', () => {
  it('点一个发出去的话；之后学生说过话就算答过，能认出点的哪个就标出来', () => {
    expect(choiceReplyText(question.options[0], 'zh')).toBe('我选：概念图（看清联系）');
    expect(choiceReplyText(question.options[1], 'en')).toBe('I choose: 对比表');
    expect(answeredLabel(question, null)).toBeNull();
    expect(answeredLabel(question, '我选：对比表')).toBe('对比表');
    expect(answeredLabel(question, '随便写一句', '概念图')).toBe('概念图');
    expect(answeredLabel(question, '我想要时间线')).toBe('');
  });
});

describe('自由提问里哪些话转给「动手做」', () => {
  it.each([
    '把我们组关于光合作用的笔记做成一个网页',
    '帮我生成 5 道自测题',
    '能不能把这几条观点整理成对比表',
    '做一张时间线，按年份排',
    '给我出几道选择题复习',
    '做一个能拖动摆长的单摆模拟',
    '帮我规划一下这篇笔记怎么写',
    'Can you make a quiz from my notes?',
  ])('转：%s', text => expect(looksLikeMakerTask(text)).toBe(true));

  it.each([
    '光合作用需要哪些条件？',
    '这个观点对吗',
    '解释一下瑞利散射',
    '画一张光合作用的示意图',
    '',
  ])('不转：%s', text => expect(looksLikeMakerTask(text)).toBe(false));
});

describe('网页文件', () => {
  it('下载用的文件名；放进 iframe 前再写一遍不能联网的安全策略', () => {
    expect(artifactFileName('光合作用 / 条件:对比', 1)).toBe('光合作用-条件-对比.html');
    expect(artifactFileName('概念图', 3)).toBe('概念图-v3.html');
    expect(artifactFileName('///', 1)).toBe('page.html');
    const doc = sandboxedDocument('<!doctype html><html><head><title>x</title></head><body></body></html>');
    expect(doc).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`);
    expect(sandboxedDocument('<p>片段</p>').startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(ARTIFACT_CSP).toContain("connect-src 'none'");
  });
});
