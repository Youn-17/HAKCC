// @vitest-environment jsdom
/**
 * 文档阅读页里两类「改别人的东西」：改正文（.md 走 PUT /notes/:id，Word 走 PUT /notes/:id/document）
 * 和删批注。后端都只放行作者本人和课程教职。原先 Word 的「编辑」对所有人显示，
 * 删批注按平台身份给，凭学生验证码入课的教师账号点下去就是 403。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

import FileViewerPage from './FileViewerPage';

const MD_URL = 'https://files.example.test/reading.md';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function stubBackend() {
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const annotation = (id: string, authorId: string, parentId: string | null, body: string) => ({
    id, noteId: 'note-doc', parentId, authorId, authorName: authorId, authorAvatar: null,
    anchor: {}, quote: null, body, resolved: false, createdAt: '2026-09-20T08:00:00Z', updatedAt: '2026-09-20T08:00:00Z',
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === MD_URL) return new Response('# 阅读材料\n\n第一段。', { status: 200 });
    const path = new URL(url, 'http://localhost').pathname.replace(/^\/api/, '');
    if (path === '/notes/note-doc/annotations') {
      return json({ annotations: [
        annotation('ann-1', 'student-1', null, '这里的论证跳了一步'),
        annotation('ann-2', 'student-2', 'ann-1', '我也这么觉得'),
      ] });
    }
    if (path === '/notes/note-doc/document') return json({ markdown: '# Word 材料\n\n正文。', cached: true, edited: false });
    return json({});
  }));
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function settle(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function waitFor<T>(probe: () => T | null | undefined | false, label: string, timeout = 3000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value as T;
    if (Date.now() - started > timeout) throw new Error(`等不到：${label}`);
    await settle(10);
  }
}

const buttonWith = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === text) ?? null;

async function open(kind: 'md' | 'docx', perms: { canEdit: boolean; isStaff: boolean }) {
  stubBackend();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(FileViewerPage, {
      isOpen: true,
      onClose: () => undefined,
      fileUrl: kind === 'md' ? MD_URL : 'https://files.example.test/reading.docx',
      fileName: kind === 'md' ? 'reading.md' : 'reading.docx',
      mimeType: kind === 'md' ? 'text/markdown' : DOCX,
      noteId: 'note-doc',
      currentUserId: 'teacher-1',
      courseId: 'course-1',
      lang: 'zh',
      onSaveMarkdown: async () => undefined,
      ...perms,
    }));
  });
  await waitFor(() => document.querySelector('.md-preview h1'), '正文');
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('改正文：只给上传者和课程教职', () => {
  it.each(['md', 'docx'] as const)('%s：不能改就不显示「编辑」', async (kind) => {
    await open(kind, { canEdit: false, isStaff: false });
    expect(buttonWith('编辑')).toBeNull();
  });

  it.each(['md', 'docx'] as const)('%s：能改就有「编辑」', async (kind) => {
    await open(kind, { canEdit: true, isStaff: false });
    expect(buttonWith('编辑')).not.toBeNull();
  });
});

describe('删别人的批注：只给课程教职', () => {
  const openComments = async () => {
    const toggle = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('批注'))!;
    await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await waitFor(() => document.body.textContent?.includes('这里的论证跳了一步'), '批注列表');
  };
  const deleteButtons = () => Array.from(document.querySelectorAll('button[aria-label="删除批注"], button[aria-label="删除回复"]'));

  it('不是教职：别人的批注和回复都没有删除按钮', async () => {
    await open('md', { canEdit: false, isStaff: false });
    await openComments();
    expect(deleteButtons()).toHaveLength(0);
  });

  it('课程教职：批注和回复都能删', async () => {
    await open('md', { canEdit: false, isStaff: true });
    await openComments();
    expect(deleteButtons()).toHaveLength(2);
  });
});
