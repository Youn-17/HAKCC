import React from 'react';
import RemixIcon from './RemixIcon';

interface Props {
  scope: 'note' | 'space';
  lang: 'zh' | 'en';
  onChoose: (prompt: string) => void;
  disabled?: boolean;
}

/** Suggested questions remain editable; choosing one never sends a message. */
const AssistantWelcome: React.FC<Props> = ({ scope, lang, onChoose, disabled }) => {
  const zh = lang === 'zh';
  const note = scope === 'note';
  const suggestions = note ? [
    { icon: 'question-answer-line', label: zh ? '发现知识缺口' : 'Find knowledge gaps', prompt: zh ? '这条 Note 中有哪些尚未解释清楚的观点？请提出值得继续探究的问题。' : 'Which ideas in this Note need more explanation? Suggest questions worth exploring.' },
    { icon: 'file-search-line', label: zh ? '检视论据' : 'Examine evidence', prompt: zh ? '请帮我检视这条 Note 的论据：哪些主张需要更多证据，下一步可以如何核查？' : 'Help me examine the evidence in this Note. Which claims need more support, and how could I verify them?' },
    { icon: 'chat-quote-line', label: zh ? '推进观点' : 'Develop an idea', prompt: zh ? '请对这条 Note 提出一个有启发性的追问，帮助我进一步完善自己的解释。' : 'Ask a constructive follow-up question to help me improve my explanation in this Note.' },
  ] : [
    { icon: 'node-tree', label: zh ? '梳理观点联系' : 'Connect ideas', prompt: zh ? '请梳理这个知识空间中观点之间的联系，说明哪些 Note 可以相互 Build-on。' : 'Explore connections between ideas in this knowledge space. Which Notes could build on one another?' },
    { icon: 'question-answer-line', label: zh ? '寻找未解问题' : 'Find open questions', prompt: zh ? '这个知识空间中还有哪些未解决的问题或需要更多证据的主张？请标明相关 Note。' : 'Which questions remain unresolved, or which claims need more evidence? Identify the relevant Notes.' },
    { icon: 'git-merge-line', label: zh ? '探索综合方向' : 'Explore a synthesis', prompt: zh ? '请比较这个知识空间中的不同观点，提出一个值得共同推进的综合方向，并保留尚未解决的分歧。' : 'Compare different ideas in this knowledge space and suggest a direction for collective synthesis, preserving unresolved disagreements.' },
  ];
  return (
    <div className="assistant-welcome">
      <span className="assistant-welcome-icon" aria-hidden="true"><RemixIcon name={note ? 'chat-quote-line' : 'node-tree'} size={26} /></span>
      <p className="assistant-eyebrow">{note ? 'NOTE' : 'COMMUNITY'} · AI</p>
      <h3>{note ? (zh ? '让观点更进一步' : 'Take your idea further') : (zh ? '一起推进社区的知识' : 'Advance knowledge together')}</h3>
      <p className="assistant-welcome-description">{note ? (zh ? '围绕当前 Note，检视证据、发现缺口、完善解释。' : 'Examine evidence, notice gaps, and improve your explanation in this Note.') : (zh ? '连接公共观点，发现未解问题，探索新的综合方向。' : 'Connect public ideas, find open questions, and explore new directions.')}</p>
      <div className="assistant-suggestions">
        {suggestions.map(s => (
          <button key={s.icon} type="button" disabled={disabled} onClick={() => onChoose(s.prompt)}>
            <RemixIcon name={s.icon} size={17} />
            <span>{s.label}</span>
            <RemixIcon name="arrow-right-up-line" size={15} className="ml-auto" />
          </button>
        ))}
      </div>
      <p className="assistant-welcome-hint">{zh ? '选择一个方向，编辑问题后再发送' : 'Choose a direction, then edit your question before sending'}</p>
    </div>
  );
};

export default AssistantWelcome;
