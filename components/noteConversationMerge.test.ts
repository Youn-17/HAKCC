import { describe, expect, it } from 'vitest';
import type { NoteConversationMessage } from '../services/apiClient';
import { settleOptimisticMessage } from './noteConversationMerge';

const msg = (id: string, senderKind: NoteConversationMessage['senderKind'], content: string): NoteConversationMessage => ({
  id, threadId: 't1', senderKind, content, attachments: [], aiMetadata: {}, createdAt: '2026-09-28T06:00:00Z',
});

describe('server copy of the learner message arrives over SSE', () => {
  it('swaps the local copy in place, ahead of the streaming reply', () => {
    const settled = settleOptimisticMessage(
      [msg('local-user-1', 'user', 'hello'), msg('stream-9', 'assistant', '')],
      'local-user-1',
      msg('m-1', 'user', 'hello'),
    );
    expect(settled.map(m => m.id)).toEqual(['m-1', 'stream-9']);
  });

  it('server copy already on screen: drops the local copy instead of showing a second one', () => {
    const settled = settleOptimisticMessage(
      [msg('m-1', 'user', 'same'), msg('local-user-1', 'user', 'same')],
      'local-user-1',
      msg('m-1', 'user', 'same'),
    );
    expect(settled.map(m => m.id)).toEqual(['m-1']);
  });

  it('local copy already gone: appends the server copy', () => {
    const settled = settleOptimisticMessage([msg('m-0', 'assistant', 'earlier')], 'local-user-1', msg('m-1', 'user', 'hello'));
    expect(settled.map(m => m.id)).toEqual(['m-0', 'm-1']);
  });
});
