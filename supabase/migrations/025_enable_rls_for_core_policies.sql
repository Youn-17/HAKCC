-- Migration 025: Enable Row Level Security for every table that 023 defines policies on.
--
-- 023_core_rls_policies.sql creates SELECT/write policies for the tables below but
-- never runs `ENABLE ROW LEVEL SECURITY`. In Postgres a policy is INERT until RLS
-- is enabled on its table, so on a fresh deploy these tables — including
-- `teacher_ai_configs`, which stores third-party provider API keys — would be
-- fully readable/writable by the `anon` and `authenticated` roles via the public
-- REST/GraphQL API.
--
-- The production database already has RLS enabled on these tables (applied
-- out-of-band), so this migration is a no-op there; its purpose is to bring the
-- repo migrations in line so any freshly provisioned environment is secured
-- identically. Every statement is idempotent (ENABLE on an already-secured table
-- does nothing).

ALTER TABLE public.teacher_ai_configs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_interventions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_metrics_realtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_revisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces                ENABLE ROW LEVEL SECURITY;
