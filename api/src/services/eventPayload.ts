import type { EventPayload } from './eventService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uuidOrUndefined(value: unknown): string | undefined {
  const text = textValue(value);
  return isUuid(text) ? text : undefined;
}

export function normalizeEventPayload(payload: EventPayload): EventPayload {
  const metadata = { ...(payload.metadata_json ?? {}) };

  const objectId = textValue(payload.object_id);
  if (objectId && !isUuid(objectId)) {
    metadata.raw_object_id = objectId;
  }

  const sessionId = textValue(payload.session_id);
  if (sessionId && !isUuid(sessionId)) {
    metadata.client_session_id = sessionId;
  }

  const spaceId = uuidOrUndefined(payload.space_id);
  if (payload.space_id && !spaceId) metadata.raw_space_id = payload.space_id;

  const targetNoteId = uuidOrUndefined(payload.target_note_id);
  if (payload.target_note_id && !targetNoteId) metadata.raw_target_note_id = payload.target_note_id;

  const relatedNoteId = uuidOrUndefined(payload.related_note_id);
  if (payload.related_note_id && !relatedNoteId) metadata.raw_related_note_id = payload.related_note_id;

  const conditionId = uuidOrUndefined(payload.condition_id);
  if (payload.condition_id && !conditionId) metadata.raw_condition_id = payload.condition_id;

  return {
    ...payload,
    object_id: isUuid(objectId) ? objectId : NIL_UUID,
    space_id: spaceId,
    target_note_id: targetNoteId,
    related_note_id: relatedNoteId,
    condition_id: conditionId,
    session_id: uuidOrUndefined(sessionId),
    metadata_json: metadata,
  };
}

export function isPermanentEventInsertError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('column') ||
    normalized.includes('schema cache') ||
    normalized.includes('invalid input syntax') ||
    normalized.includes('violates foreign key constraint') ||
    normalized.includes('violates not-null constraint') ||
    normalized.includes('invalid uuid')
  );
}
