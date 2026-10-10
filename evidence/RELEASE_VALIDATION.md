# Release validation

Checked on **2026-10-10** for the **main source update after v0.7.0**. This is a source commit, not a new tagged release.

## Current source checks

- **218 test files / 2,440 tests passed**, with fictional browser configuration and the local Python text libraries enabled. No tests were skipped in this run.
- Frontend TypeScript check, frontend build with placeholder browser configuration, and API build passed. Existing chunk-size warnings remain.
- The AI surfaces were checked in the private local source using fictional API events: workspace panel, Note assistant, personal agent, mobile and dark layouts, and live reduced-motion changes. These checks do not establish live AI-provider behavior.
- The production frontend JS/CSS files match the private local build. The public source has its own sanitized configuration and was independently tested and built.
- The known-local-credential and operational-marker scan found no matches in public files. The credential-shape, source fingerprint and full-file manifest checks cover the public package. These are bounded automated checks.
- The previous publication-only lockfile changes are preserved; Anime.js 4.5.0 is added. The dated dependency snapshots below were not refreshed into a new security audit.

## Current analysis requirements and limits

Discussion threads replace idea relay; peer connections use actual exchanges and shared text terms. Teacher-defined topics require migration `087_space_analytics_topics.sql` on an existing compatible database. API staff authorization and service-only table access remain required. Topic mentions and shared words are not mastery scores or evidence of learning effects. Keyword periods still group current Note text by creation date. Anonymous display does not anonymize source words. The migration archive is not verified as a complete fresh-database replay. Private operations and production acceptance records are excluded.

## Previous tagged release evidence

The records below describe their named releases and are retained as historical evidence.


Checked on **2026-10-10** for **v0.7.0**. This successor retains the sanitized v0.6.0 package and adds inspected discussion-analysis, optional citation-check and scaffold-suggestion source changes.

## Current checks

- Public application suite: **212 files / 2,420 tests passed** with Node 22 and actual local Python for worker tests.
- Frontend TypeScript check, production build and API build passed. Existing chunk-size warnings remain.
- The dedicated analytics page was checked locally with fictional fixtures on desktop, mobile and dark mode: filters, sources, anonymity, browser back, canvas return and PNG export. Text calculations used actual local Python. These browser checks used the private development source; public source was independently tested and built.
- Source fingerprint, full public inventory, relative-link and credential-shape checks passed. Local comparison against five available credential values and known private paths/server markers found no matching public files. This is a bounded automated check, not a formal privacy audit.
- Public lockfiles retain the previous publication-only dependency patches. Dependencies did not change in this successor. The dependency audit snapshots below are dated 2026-10-09 and were not refreshed for this release.

## Discussion-analysis limits

The four tools inspect student-authored Note text and actual adopted Build-on relations. Keyword periods use creation dates and current text, not historical revision snapshots. Anonymous display hides names, titles and excerpts, but does not anonymize words from source text. Frequencies and relation labels do not measure mastery or demonstrate learning effects. Sources are capped at 50 IDs per keyword; counts remain complete. Peer connections and teacher-defined topic coverage are deferred. No new database migration is required. Deployment credentials and production acceptance records are excluded from this public package.

## Previous release evidence

The following checks and dependency snapshots were recorded for v0.6.0; their dates and scope remain unchanged.


Checked on **2026-10-09** for public release **v0.6.0**. This package inherits the sanitized v0.5.0 public snapshot and incorporates inspected application updates and collaborative-document working files from the revision recorded in [source_snapshot.json](source_snapshot.json). Exact publication bytes are identified by the manifests; the development revision alone does not describe publication-only adjustments or uncommitted working files.

## Executed checks

| Check | Result | Scope |
| --- | --- | --- |
| Fresh locked installations | Passed | Frontend and API `npm ci --ignore-scripts`; collaboration `npm ci --ignore-scripts` followed by the explicit `better-sqlite3` native rebuild |
| Frontend production build | Passed, exit 0 | Dummy browser project configuration and collaboration enabled; existing Vite chunk-size warnings remain |
| Frontend TypeScript check | Passed, exit 0 | `npx tsc --noEmit --pretty false` |
| API TypeScript build | Passed, exit 0 | `npm run build --prefix api` |
| Full application test suite | **203 files / 2,346 tests passed**, exit 0 | `npm test -- --maxWorkers=2 --testTimeout=60000`; mocked providers/data and permitted local test-server listening |
| Collaboration test suite | **5 tests passed**, exit 0 | Durable save acknowledgments, normalized document state, coediting, offline merging, access restrictions, restart, disk failure and origin rejection |
| Independent public Docker demo | Passed | Built this public checkout in an isolated Compose project; frontend and collaboration health checks passed |
| Browser behavior and Word export | Passed | Two fictional students coedited; a viewer was read-only; a severed WebSocket reconnected and merged offline edits; reload, snapshot creation and Word export passed without page errors |
| Export and visual inspection | Passed | Exported Word XML contained both students' text and offline edits; the rendered ribbon, page and save-version controls were inspected |
| Credential scan | No findings | Credential/JWT/private-key patterns and exact comparison with five available local secret values; values are not recorded here |
| Internal-material marker scan | No findings | Known local-path, server, operational-plan, private configuration and research markers; this is a bounded marker scan |
| Source correspondence | Recorded | **794 source files**, including **57 publication-adjusted files**, listed in the source snapshot; frozen source inputs were rechecked for drift |
| Figures and demonstrations | Retained | Eighteen language-specific figure variants, aggregate sources and earlier fictional baseline media; new browser-check artifacts remain outside this repository |
| Public documentation and fingerprints | Checked | Bilingual release guides, relative links, source hashes and complete file inventory checked by the release validator |
| Citation metadata | Checked | Zhenhai He, version 0.6.0, date 2026-10-09, MIT and repository links |

Checks used Node.js **22.22.3**. Public locks retain Capacitor Android/iOS **8.4.3** and API `proxy-addr` **2.0.8**. An initial public-source merge produced a duplicate workspace declaration; it was corrected and the complete application suite, build and TypeScript check were repeated successfully. The independent Docker build also identified a missing demo entry file, which was added before the successful rebuild and browser check. Unsuccessful runs are not counted as passing checks. No real participant account or paid provider was used for these publication checks.

## Refreshed dependency audit snapshots

Audits were refreshed on **2026-10-09** against the public lockfiles.

| Component | Low | Moderate | High | Critical | Total |
| --- | --- | --- | --- | --- | --- |
| Frontend | 1 | 5 | 7 | 0 | 13 |
| API | 0 | 6 | 5 | 0 | 11 |
| Collaboration | 0 | 0 | 0 | 0 | 0 |

See the [frontend audit](frontend_dependency_audit.json), [API audit](api_dependency_audit.json) and [collaboration audit](collaboration_dependency_audit.json). These dated dependency snapshots are not security certification or application exploitability assessments. Publishing this repository does not patch an existing installation.

## Limits

- Collaborative document bodies and snapshots have a separate SQLite owner. They are not yet included in AI retrieval, the knowledge-base ingestion flow or research exports. Note metadata and permission checks remain with the application API and Supabase.
- The editor supports basic Word export, rather than full Word file-format compatibility. Word import, real pagination, comments, tracked changes and a snapshot-restoration interface are not supplied.
- The local demo uses fictional loopback-only identities. Production requires separate credentials, permission callbacks, reverse-proxy settings and persistent storage. The demo data and verification artifacts are not transferred by publication.
- The historical Supabase migration archive includes duplicate prefixes and repair scripts; fresh replay remains unvalidated. No new Supabase migration is required by the collaborative-document feature.
- Memory behavior and access checks were covered by source and regression tests. A full 1M-token request, all provider limits, live summarization costs and complete multimodal/tool sizes were not validated. Application memory does not train model weights; derived summaries are fallible.
- This publication is source and documentation, not a deployment, student-record migration or guarantee of production equivalence. Capacity/load, clean Supabase provisioning, Android/iOS native builds and installation on other operating systems were not tested.
- No production credentials, real participant exports, private operational plans, research proposals or authenticated course recordings are supplied. Automated checks do not constitute complete teacher/student acceptance, a formal privacy audit or learning-effect evidence.

## Recheck this package

```bash
python3 publication/validate_release.py
shasum -a 256 -c evidence/public_files.sha256
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=public-release-test-key npm test -- --maxWorkers=2 --testTimeout=60000
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=public-release-test-key VITE_API_URL=/api VITE_ENABLE_COLLAB_DOCUMENTS=true npm run build
npx tsc --noEmit --pretty false
npm run build --prefix api
npm test --prefix collab
```

The manifest excludes itself. See [Getting started](../GETTING_STARTED.md) and the [v0.6.0 guide](../write/UPDATES_v0.6.0.en.md) for setup, data ownership and the isolated Docker demo.

## 2026-10-10 source update verification

The public source now includes short interaction feedback, compact discussion analysis and a read-only collaborative snapshot panel. Previewing saved content uses a separate editor and does not apply it to the live Yjs document. Application visual updates receive no new changelog entry. Public dependency and privacy adaptations are retained.

Application regressions passed: 2,455 tests across 222 files. The initial run passed 2,451 tests; four Python-dependent cases were then run successfully against the existing isolated production Python runtime using fictional inputs, without accessing participant records. Collaboration service tests passed (6). Frontend TypeScript and frontend/API builds passed. Local fictional-browser checks covered save failure feedback, insertion markup, repeated location, reduced motion, recorded replay and concurrent editing during history preview. These checks do not establish classroom effects or VPS capacity.

Separate production checks used temporary fictional identities: desktop coediting, read-only historical previews while the live document continued syncing, toolbar switching, Word export and per-document access checks passed. The existing mobile workspace is a separate component; production collaborative editing was verified through the desktop entry. All fictional acceptance identities, their isolated course and documents were removed. Production Pages and custom-domain JavaScript/CSS assets matched the deployment build byte for byte. Deployment configuration and acceptance fixtures are excluded from this source package.
