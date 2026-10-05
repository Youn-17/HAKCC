import React, { useState } from 'react';

const KEY = 'hakcc-chat-preferences';
export function useChatPreferences() {
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      return saved && typeof saved === 'object' ? saved as { enterToSend?: boolean; largeText?: boolean } : {};
    }
    catch { return {}; }
  });
  const update = (key: 'enterToSend' | 'largeText', value: boolean) => setPreferences(previous => {
    const next = { ...previous, [key]: value };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* optional preference */ }
    return next;
  });
  return {
    enterToSend: preferences.enterToSend !== false,
    largeText: preferences.largeText === true,
    setEnterToSend: (value: boolean) => update('enterToSend', value),
    setLargeText: (value: boolean) => update('largeText', value),
  };
}
export function ChatPreferenceControls(props: ReturnType<typeof useChatPreferences> & { lang: string }) {
  const zh = props.lang === 'zh';
  return <div className="assistant-preferences">
    <label>{zh ? 'Enter 发送 · Shift+Enter 换行' : 'Enter to send · Shift+Enter for a new line'}
      <input type="checkbox" checked={props.enterToSend} onChange={event => props.setEnterToSend(event.target.checked)} />
    </label>
    <label>{zh ? '放大对话文字' : 'Larger conversation text'}
      <input type="checkbox" checked={props.largeText} onChange={event => props.setLargeText(event.target.checked)} />
    </label>
  </div>;
}
