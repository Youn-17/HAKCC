import { describe, it, expect } from 'vitest';
import { compareFeedbackRevision, studentAuthoredText, validUptakeEvidence } from './feedbackUptake';
describe('feedback uptake at contribution', () => {
  it('excludes copied AI text and scaffold labels, retains student writing', () => {
    expect(studentAuthoredText('<p>原观点</p><div data-ai-source="genai"><div>复制的建议</div></div><p data-scaffold-id="s"><span data-scaffold-tag="true">建议话头</span><span data-scaffold-input="true">我观察到实验组差异，因此需要控制变量。</span></p>')).toBe('原观点 我观察到实验组差异，因此需要控制变量。');
  });
  it('formatting, punctuation, tiny edits and empty scaffolds are not substantive revision', () => {
    expect(compareFeedbackRevision('我的观点是学生需要更多证据', '我的观点是，学生需要更多证据。')).toBe('unchanged');
    expect(compareFeedbackRevision('我的观点', '我的观点呀')).toBe('unchanged');
  });
  it('a substantive addition needs relevance review; missing old snapshots remain uncertain', () => {
    expect(compareFeedbackRevision('我的观点', '我的观点。实验中两组基础水平不同，因此需要先匹配样本。')).toBe('review');
    expect(compareFeedbackRevision(undefined, '新正文')).toBe('uncertain');
  });
  it('requires a new exact student excerpt, rejects hallucinations and verbatim feedback copying', () => {
    const evidence='实验中两组基础水平不同，因此需要先匹配样本。';
    expect(validUptakeEvidence(evidence,'我的观点',`我的观点${evidence}`,'请补充证据')).toBe(true);
    expect(validUptakeEvidence(evidence,evidence,evidence,'反馈')).toBe(false);
    expect(validUptakeEvidence(evidence,'观点',evidence,evidence)).toBe(false);
    expect(validUptakeEvidence('不存在于正文的内容，这不是学生的回应','观点',evidence,'反馈')).toBe(false);
  });
});
