/**
 * Event logging service with in-memory buffer.
 * Events are batched and flushed to Supabase every 2 seconds.
 * This keeps event recording non-blocking for the main API flow.
 */
import { supabase } from '../config/supabase';
import { isPermanentEventInsertError, normalizeEventPayload } from './eventPayload';

export interface EventPayload {
  actor_id: string;
  actor_role: string;
  event_type: string;
  object_type: string;
  object_id: string;
  space_id?: string | null;
  target_note_id?: string;
  related_note_id?: string;
  metadata_json?: Record<string, unknown>;
  condition_id?: string;
  session_id?: string;
  client_version?: string;
}

const buffer: EventPayload[] = [];
const FLUSH_INTERVAL_MS = 2000;
const MAX_BUFFER = 500;

export function logEvent(payload: EventPayload): void {
  buffer.push(normalizeEventPayload(payload));
  if (buffer.length >= MAX_BUFFER) {
    void flushEvents();
  }
}

async function flushEvents(): Promise<void> {
  if (buffer.length === 0) return;

  const batch = buffer.splice(0, buffer.length);
  const { error } = await supabase.from('events').insert(batch);

  if (error) {
    // Schema errors (missing columns, wrong types) are permanent — don't retry
    if (isPermanentEventInsertError(error.message)) {
      console.error('[EventService] Permanent insert error (not retrying):', error.message);
    } else {
      console.error('[EventService] Failed to flush events:', error.message);
      // Put back in buffer (up to MAX_BUFFER to avoid memory leak)
      const remaining = buffer.length;
      if (remaining < MAX_BUFFER) {
        buffer.unshift(...batch.slice(0, MAX_BUFFER - remaining));
      }
    }
  }
}

// Start the periodic flush
setInterval(() => { void flushEvents(); }, FLUSH_INTERVAL_MS);

// Ensure flush on process exit
process.on('beforeExit', () => { void flushEvents(); });
