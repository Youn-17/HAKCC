import { describe, expect, it } from 'vitest';
import {
  isPermanentEventInsertError,
  isUuid,
  NIL_UUID,
  normalizeEventPayload,
} from './eventPayload';
import type { EventPayload } from './eventService';

const basePayload: EventPayload = {
  actor_id: '11111111-1111-1111-1111-111111111111',
  actor_role: 'student',
  event_type: 'view',
  object_type: 'dashboard',
  object_id: '22222222-2222-2222-2222-222222222222',
  space_id: '33333333-3333-3333-3333-333333333333',
  metadata_json: { source: 'test' },
  session_id: '44444444-4444-4444-4444-444444444444',
  client_version: 'test',
};

describe('event payload normalization', () => {
  it('accepts standard UUID strings', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isUuid('018f3a63-73cb-7cc1-b5ef-3ef3e03dca1a')).toBe(true);
    expect(isUuid('CM3QipVQ')).toBe(false);
  });

  it('preserves UUID identifiers', () => {
    expect(normalizeEventPayload(basePayload)).toEqual(basePayload);
  });

  it('moves client UI ids and short session ids into metadata before insert', () => {
    const normalized = normalizeEventPayload({
      ...basePayload,
      object_id: 'tab-chat',
      space_id: '',
      session_id: 'CM3QipVQ',
      target_note_id: 'note-card-local',
      related_note_id: 'another-ui-id',
      condition_id: 'condition-name',
    });

    expect(normalized.object_id).toBe(NIL_UUID);
    expect(normalized.space_id).toBeUndefined();
    expect(normalized.session_id).toBeUndefined();
    expect(normalized.target_note_id).toBeUndefined();
    expect(normalized.related_note_id).toBeUndefined();
    expect(normalized.condition_id).toBeUndefined();
    expect(normalized.metadata_json).toMatchObject({
      source: 'test',
      raw_object_id: 'tab-chat',
      client_session_id: 'CM3QipVQ',
      raw_target_note_id: 'note-card-local',
      raw_related_note_id: 'another-ui-id',
      raw_condition_id: 'condition-name',
    });
  });

  it('does not retry permanent insert errors', () => {
    expect(isPermanentEventInsertError('invalid input syntax for type uuid: "CM3QipVQ"')).toBe(true);
    expect(isPermanentEventInsertError('violates not-null constraint')).toBe(true);
    expect(isPermanentEventInsertError('network timeout')).toBe(false);
  });
});
