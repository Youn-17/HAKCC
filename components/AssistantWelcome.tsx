import React from 'react';
import RemixIcon from './RemixIcon';

interface Props {
  scope: 'note' | 'space';
  lang: 'zh' | 'en';
  onChoose: (prompt: string) => void;
  disabled?: boolean;
  /** page：知识空间智能体整页，大标题 + 两列卡片，多一张「做成网页」 */
  variant?: 'panel' | 'page';
}

/** 卡片依次浮上来的先后（Tailwind 的类名得写全，不能拼） */
const ENTER_ORDER = ['[--enter-i:3]', '[--enter-i:4]', '[--enter-i:5]', '[--enter-i:6]'];

/** Suggested questions remain editable; choosing one never sends a message. */
const AssistantWelcome: React.FC<Props> = ({ scope, lang, onChoose, disabled, variant = 'panel' }) => {
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
  if (variant === 'page' && !note) {
    const details = zh
      ? ['哪些笔记可以互相 Build-on', '需要证据或回应的观点', '比较不同解释，保留待讨论的分歧']
      : ['Which notes could build on each other', 'Claims that still lack evidence or replies', 'Keep the disagreements, find a way forward'];
    const cards = [
      ...suggestions.map((s, i) => ({ ...s, detail: details[i] })),
      {
        icon: 'pages-line',
        label: zh ? '做成网页' : 'Build a page',
        detail: zh ? '整理成对比表、概念图，可以导入笔记' : 'A comparison table or concept map you can import',
        prompt: zh
          ? '把这个空间里的主要观点做成一张对比表网页：每个观点写清楚是谁提的、依据是什么、还缺什么证据。'
          : 'Turn the main ideas in this space into a comparison page: who proposed each idea, what it rests on, and what evidence is still missing.',
      },
    ];
    return (
      <div className="relative isolate m-auto w-full max-w-[42rem] px-1 py-6 text-center" data-agent-hero>
        <div aria-hidden="true" className="agent-hero-grid pointer-events-none absolute inset-x-0 -top-6 -z-10 h-72" />
        <span data-enter data-hero-icon aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.25rem] border border-zinc-200/80 bg-white text-[#000080] shadow-[0_10px_30px_-14px_rgba(30,58,138,0.45)] [--enter-i:0] dark:border-gray-700 dark:bg-gray-900 dark:text-[#93AAFD]">
          <RemixIcon name="node-tree" size={26} />
        </span>
        <h3 data-enter className="agent-page-display mt-6 text-[2.125rem] leading-[1.2] text-zinc-900 [--enter-i:1] dark:text-zinc-50">
          {zh ? '一起推进社区的知识' : 'Advance knowledge together'}
        </h3>
        <p data-enter className="mx-auto mt-3 max-w-[30rem] text-[0.875rem] leading-relaxed text-zinc-500 [--enter-i:2] dark:text-zinc-400">
          {zh
            ? '可以查阅空间笔记、比较观点、寻找未解问题，也可以制作网页。你可以选择方案、修改内容，再决定是否导入笔记。'
            : 'Review space Notes, compare ideas, find open questions, or create a page. Choose an approach, revise the content, and decide whether to import it into a Note.'}
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {cards.map((s, i) => (
            <button
              key={s.icon}
              type="button"
              data-enter
              disabled={disabled}
              onClick={() => onChoose(s.prompt)}
              className={`group relative flex items-start gap-3 rounded-2xl border border-zinc-200/80 bg-white p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[#000080]/25 hover:shadow-[0_14px_32px_-18px_rgba(30,58,138,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 ${ENTER_ORDER[i]}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#000080]/[0.06] text-[#000080] transition-colors duration-200 group-hover:bg-[#000080] group-hover:text-white dark:bg-[#93AAFD]/10 dark:text-[#93AAFD] dark:group-hover:bg-[#93AAFD] dark:group-hover:text-gray-950">
                <RemixIcon name={s.icon} size={18} />
              </span>
              <span className="min-w-0 flex-1 pr-5">
                <span className="block text-[0.875rem] font-semibold text-zinc-900 dark:text-zinc-100">{s.label}</span>
                <span className="mt-1 block text-[0.75rem] leading-5 text-zinc-500 dark:text-zinc-400">{s.detail}</span>
              </span>
              <RemixIcon name="arrow-right-up-line" size={15} className="absolute right-3.5 top-3.5 text-zinc-300 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#000080] dark:text-gray-600 dark:group-hover:text-[#93AAFD]" />
            </button>
          ))}
        </div>
        <p data-enter className="mt-6 text-[0.6875rem] text-zinc-400 [--enter-i:7]">{zh ? '选一个方向，改好问题再发送' : 'Pick a direction, edit the question, then send'}</p>
      </div>
    );
  }

  return (
    <div className="assistant-welcome">
      <span className="assistant-welcome-icon" aria-hidden="true"><RemixIcon name={note ? 'chat-quote-line' : 'node-tree'} size={26} /></span>
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
