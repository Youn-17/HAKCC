// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import AgentProcess from './AgentProcess';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('完成标记只用于已完成工具；失败和执行中保持各自状态', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    for (const status of ['running', 'done', 'error'] as const) {
      act(() => root.render(React.createElement(AgentProcess, { steps: [{ name: 'search_notes', status }], phase: 'writing', lang: 'zh' })));
      expect(host.querySelector('[data-ai-motion-state]')?.getAttribute('data-ai-motion-state')).toBe(status);
      expect(host.textContent).toContain(status === 'running' ? '正在处理 1 步' : status === 'error' ? '有步骤未完成' : '用了 1 步');
      act(() => (host.querySelector('button') as HTMLButtonElement).click());
      expect(host.querySelector('li')?.getAttribute('data-ai-motion-state')).toBe(status);
      act(() => (host.querySelector('button') as HTMLButtonElement).click());
    }
  } finally { act(() => root.unmount()); host.remove(); }
});
