# Getting started

[Home](README.md) · [System guide](write/SYSTEM_OVERVIEW.en.md) · [Validation](evidence/RELEASE_VALIDATION.md)

This is the public source snapshot of an existing platform. Frontend/API builds and automated tests are covered by the release checks. A fresh database installation has **not** been validated for this release; the historical migration archive requires review before use.

## Requirements

- Node.js 22 and npm; the release was checked with Node.js 22.22.3.
- A separately provisioned Supabase project with Auth, PostgreSQL, Storage, and the schema/policies required by the application.
- AI-provider access configured by authorized staff for the features you intend to use.

## Install

```bash
git clone https://github.com/Youn-17/HAKCC.git
cd HAKCC
npm ci
npm ci --prefix api
cp .env.example .env.local
cp api/.env.example api/.env
```

Edit the copied environment files using your own project's configuration. No functioning account or API credential is supplied in the examples.

| Location | Variables | Purpose |
| --- | --- | --- |
| `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` | Browser-visible project URL, anon/publishable key, and API base; use `/api` for the local Vite proxy |
| `api/.env` | `PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `FRONTEND_URL` | API port, server database access, encryption fallback material, and allowed frontend origins |
| `api/.env` | `AI_CONFIG_ENCRYPTION_KEY` | Optional dedicated encryption material for stored AI configuration |
| `api/.env` | `AUTH_RATE_LIMIT_MAX`, `API_RATE_LIMIT_MAX` | Optional rate-limit overrides |

The service-role key and provider keys belong on the server. The `VITE_*` values become part of the browser bundle. A browser project key is intentionally public and relies on correctly configured access policies; it must never be substituted with a service-role credential.

## Database archive

`supabase/migrations/` preserves schema and policy evolution from the existing installation. Some entries are historical repair scripts, and multiple files share the prefixes `058` and `059`. `004_seed_data.sql` assumes fixture identities exist. The archive has not been normalized into a verified clean-install sequence.

Accordingly, this release does not recommend blindly applying the archive with `supabase db reset`. For a new installation, review migration dependencies, resolve duplicate versions into a deliberate order, skip environment-specific repairs and optional seed data where appropriate, then test the resulting schema and access policies in an isolated project. Automatic seed-file loading is disabled in the public configuration because the referenced local seed file is not supplied.

No production database dump or course dataset is included. A future release can provide a verified baseline schema without exposing private content.

## Upgrading to v0.3.0

Review the [supplementary upgrade guide](write/UPDATES_v0.3.0.en.md) for migrations 074–077, course feature configuration and optional server-side Jev settings. Test schema and permissions in an isolated environment before upgrading an existing installation. No hosted database migration or deployment is part of this publication.

## Run locally

After provisioning the database and environment:

```bash
# Terminal 1
cd api
npm run dev
```

```bash
# Terminal 2, repository root
npm run dev
```

The frontend normally runs on port 3000 and proxies `/api` to port 4000. The API health route is `/health`. Create accounts through the app, then grant the initial administrator role using your own database administrator access. Teacher registration requires approval; course tools also depend on membership/staff standing.

Configure AI services through the appropriate administration/course tools. Selecting an AI role cannot supply a missing provider configuration.

## Build and test

```bash
npm run build
npm run build --prefix api
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=public-release-test-key npm test -- --maxWorkers=2 --testTimeout=20000
```

The test command uses dummy browser configuration; API test setup also uses test values. API tests require permission to bind loopback ports. These tests do not require or validate a production course or a live provider key.

The dependency lockfiles are preserved from the development snapshot. The release report lists the npm audit findings separately; this source disclosure should not be taken as production security certification.

## Containers and deployment

Container definitions are under `docker/`. Copy `docker/.env.example` to `docker/.env`, configure your own values, and inspect the selected Compose file before running it. Project-specific token literals were replaced by environment variables in the public snapshot. `docker/docker-compose.prod.yml` defines a frontend and API and exposes ports 80 and 4000.

No production deployment is performed by this repository publication. Container startup, native-library installation on a fresh machine, and fresh Supabase provisioning remain separate acceptance steps.
