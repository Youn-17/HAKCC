# Release validation

Checked on **2026-10-08** for public release **v0.5.0**. This package inherits the v0.4.0 public snapshot and adds the memory delta and follow-up compatibility fixes from development revision `027198aa582dbed9cf82b1175525755cb12acaf2`. Exact public bytes are identified by the manifests.

## Executed checks

| Check | Result | Scope |
| --- | --- | --- |
| Frontend production build | Passed, exit 0 | `npm run build` with dummy browser project configuration; existing Vite chunk-size warnings remain |
| API TypeScript build | Passed, exit 0 | `npm run build --prefix api`, rerun after the shared Note-text fix |
| Full test suite | **191 files / 2,170 tests passed**, exit 0 | Final `npm test -- --maxWorkers=2 --testTimeout=20000`; mocked providers/data and permitted local test-server listening |
| Targeted compatibility checks | **4 files / 58 tests passed**, exit 0 | Knowledge-base scope, deleted attachments, shared Note-text sites and student context |
| Credential scan | No findings | Key/JWT/private-key patterns and exact comparison with three available local secret values; values are not recorded here |
| Internal-material marker scan | No findings | Known local-path, server-path, operational-plan and internal-research markers; this is a bounded marker scan |
| Source correspondence | Recorded | **748 source files**, including **55 publication-adjusted files**, listed in [source_snapshot.json](source_snapshot.json) |
| Figures and demonstrations | Retained | Eighteen language-specific figure variants, aggregate sources and fictional baseline media; no new authenticated recordings |
| Public documentation and fingerprints | Checked | Bilingual memory guides, relative link targets, source hashes and complete public inventory checked by the release validator |
| Citation metadata | Checked | Zhenhai He, version 0.5.0, date 2026-10-08, MIT and repository links; other CFF fields unchanged from v0.4.0 |
| Local synchronization | Checked | All 19 memory-delta files match inspected development bytes except the previously sanitized public workspace route |

The checks used Node.js **22.22.3** and the public dependency installations validated for v0.4.0. No package or lockfile changed for this release; a fresh dependency installation was not repeated. The v0.4.0 locked installations used `--ignore-scripts`; lifecycle scripts on other platforms remain unvalidated. No participant account or paid provider was used for these release checks.

The first complete run exposed two database test doubles missing the new range interface and a new HTML-stripping site that needed the shared Note-text helper. Those three files were corrected in both local checkouts and the complete suite rerun. The original access and behavior assertions remain. The unsuccessful first run is not counted as a passing check. Existing public workspace-label and sanitizer-timeout test adjustments are retained.

## Retained dependency audit snapshots

The audits below were captured on **2026-10-07** for v0.4.0; they were **not refreshed** for this release. Dependency locks are unchanged.

| Component | Low | Moderate | High | Critical | Total |
| --- | --- | --- | --- | --- | --- |
| Frontend | 1 | 5 | 7 | 0 | 13 |
| API | 0 | 6 | 5 | 0 | 11 |

See [frontend audit](frontend_dependency_audit.json) and [API audit](api_dependency_audit.json). These are dated tooling/transitive-dependency snapshots, not current security certification or application exploitability assessments. Public locks retain proxy-addr 2.0.8 and Capacitor Android/iOS 8.4.3. Repository publication does not patch or rebuild an existing installation.

## Limits

- Migration 086 is included but was not applied to a live or newly provisioned database as part of this publication. The historical archive still includes duplicate prefixes and repair scripts; fresh replay remains unvalidated. Review earlier upgrade requirements for older installations.
- This release publishes source and documentation. It does not deploy the hosted application, migrate student records or establish equivalence to a running production revision.
- Memory, student-owned retrieval and fallback budgeting were checked through source and mocked regression tests. A full 1M-token request, all gateway account limits, live summarization costs and complete multimodal/tool request sizes were not validated.
- Application-level memory does not train model weights. Derived summaries are fallible and incremental; there is no dedicated memory viewing/editing/deletion interface, and summary refresh does not guarantee immediate removal of earlier summarized facts.
- Container startup, clean Supabase provisioning, Android/iOS native builds and installation on other operating systems were not tested. Frontend screenshots/GIFs retain their earlier fictional baseline and do not demonstrate the new backend memory behavior.
- No production credentials, real participant exports, private research proposals or authenticated course recordings are supplied. Automated checks do not constitute complete teacher/student acceptance, a formal security/privacy audit or educational-effect evidence.

## Recheck this package

```bash
python3 publication/validate_release.py
shasum -a 256 -c evidence/public_files.sha256
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=public-release-test-key npm test -- --maxWorkers=2 --testTimeout=20000
npm run build
npm run build --prefix api
```

The manifest excludes itself. See [Getting started](../GETTING_STARTED.md) and the [memory guide](../write/UPDATES_v0.5.0.en.md) for setup, data flow and upgrade conditions.
