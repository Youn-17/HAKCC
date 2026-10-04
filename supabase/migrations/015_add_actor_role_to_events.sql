-- Add actor_role column to events table for research tracking
ALTER TABLE events ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50);
