import { useId, useRef, useState } from 'react';
import { useDismissible } from '../hooks/useDismissible';
import RemixIcon from './RemixIcon';
import type { PartnerAgentModeSelection } from './noteAiPartnerModel';

type AgentOption = { id: PartnerAgentModeSelection; label: string; description: string; disabled: boolean };

/** This picker belongs to the Note assistant; closing the assistant also closes its menu. */
export default function AssistantAgentPicker({ lang, value, options, onChange, disabled }: {
  lang: 'zh' | 'en';
  value: PartnerAgentModeSelection;
  options: AgentOption[];
  onChange: (value: PartnerAgentModeSelection) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = options.find(option => option.id === value) ?? options[0];
  const label = lang === 'zh' ? '选择智能体' : 'Choose an agent';
  useDismissible({ open, ref, onDismiss: () => setOpen(false) });

  return (
    <div ref={ref} className="assistant-agent-picker assistant-context-bar" onMouseLeave={() => {
      // Keyboard users can keep reading and tabbing through the menu.
      if (!ref.current?.querySelector('[role="radio"]:focus')) setOpen(false);
    }} onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
      if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
      <button ref={trigger} type="button" className="assistant-context-trigger" aria-label={label}
        aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
        onClick={() => setOpen(previous => !previous)} title={active.description}>
        <RemixIcon name="robot-2-line" size={16} />
        <span className="assistant-context-label">{label}</span>
        <span className="assistant-context-value">{active.label}</span>
        <RemixIcon name="arrow-down-s-line" size={14} />
      </button>
      <p className="assistant-agent-description">{active.description}</p>
      {open && <div id={id} className="assistant-context-menu" role="radiogroup" aria-label={label}>
        {options.map(option => <button key={option.id} type="button" role="radio"
          aria-checked={option.id === value} disabled={option.disabled}
          onClick={() => { onChange(option.id); setOpen(false); trigger.current?.focus(); }}>
          <span className="assistant-agent-option-title">{option.label}
            {option.id === value && <RemixIcon name="check-line" size={15} />}
          </span>
          <span className="assistant-agent-option-description">{option.description}</span>
          {option.disabled && <span className="assistant-agent-option-description">{lang === 'zh' ? '需教师开启联网检索' : 'Requires web search enabled by your teacher'}</span>}
        </button>)}
      </div>}
    </div>
  );
}
