# Release validation

Checked on **2026-10-06** for public release **v0.3.0**. Source basis: `9f1e83a0ba93bb4a0fbdedf4d7e4d641fc9f7b70` plus inspected working-tree changes. Exact public bytes are identified by the manifests.

## Executed checks

| Check | Result | Scope |
| --- | --- | --- |
| Frontend production build | Passed, exit 0 | Final `npm run build` with dummy browser project configuration; Vite reports chunks above its 300 kB warning threshold |
| API TypeScript build | Passed, exit 0 | `npm run build` in `api/` |
| Full test suite | **165 files / 1,923 tests passed**, exit 0 | Final run: `npm test -- --maxWorkers=2 --testTimeout=20000`; dummy configuration and local API test servers |
| Workspace integration tests | **48 tests passed** separately, then passed in the full run | Build-on, drafting, conversation history, answer preferences and related UI behavior |
| Credential-pattern scan and exact local-value comparison | No findings | Public files scanned for key/JWT/private-key patterns and available local environment credential values; no values are stored in this report |
| Internal-material marker scan | No findings in final files | Checked known private manuscript, planning, operational and internal experiment markers; excluded material remains outside this checkout |
| Source snapshot correspondence | Recorded | **693 source files**, including **33 publication-adjusted files**, listed in [source_snapshot.json](source_snapshot.json) |
| Figure inventory | Eighteen language-specific mechanisms retained | Nine English and nine Chinese mechanisms in draw.io, SVG and PNG; aggregate collection and supplied integrated overview |
| Public documentation | Checked | English and Chinese update guides linked from both homepages; relative targets and fingerprints checked by the release validator |
| Fictional screenshots | Updated public changelog and workspace inspected | Mock course/participants; sanitized public update history; no real-course login or live AI call |
| Citation metadata | Passed official CFF 1.2.0 schema validation | Zhenhai He, version 0.3.0, release date and repository links |
| Development snapshot stability | Checked | Included source files did not change between snapshot capture and publication preparation |

The checks used Node.js **22.22.3** and the development installation's existing dependencies. Temporary dependency symlinks were excluded from publication. A clean `npm ci` installation on a new machine, including native backend chart dependencies, was not tested.

The first full run failed in two suites: workspace tests used the former AI input placeholder, and the sanitizer suite's 20-second limit was shorter than the worker's 30-second guard. The public test copy now locates the current accessible input label and permits 40 seconds for the sanitizer suite. Behavior and security assertions are retained; application runtime limits were not changed. The final full run reduced worker concurrency and used the command shown above. Earlier failed runs are not counted as passing checks.

## Dependency audit snapshots

The frontend and API lockfiles are unchanged from v0.2.0. The retained **2026-10-04** audit reports show:

| Component | Low | Moderate | High | Critical | Total |
| --- | --- | --- | --- | --- | --- |
| Frontend | 1 | 5 | 6 | 0 | 12 |
| API | 0 | 3 | 4 | 0 | 7 |

See [frontend audit](frontend_dependency_audit.json) and [API audit](api_dependency_audit.json). These are prior audit snapshots, not a new advisory lookup for this release. They include tooling and transitive dependencies; the counts do not establish exploitability in this application. Dependency remediation remains a separate reviewed update.

## Limits

- Migrations 074–077 are included but were not applied to a live or newly provisioned database. The historical archive still contains duplicate earlier prefixes and deployment-era repairs. Fresh replay and container startup remain unvalidated.
- Repository publication does not deploy the hosted platform or establish that it runs this revision.
- AI and Jev behavior was checked through source and mocked tests, rather than live-provider acceptance or benchmarking. Default thresholds are not validated educational standards.
- The three looping GIFs retain their baseline demonstrations. Updated screenshots do not cover every new interaction.
- No production credentials, real participant exports, private research proposals or authenticated course recordings are supplied.
- Automated checks do not constitute complete teacher/student acceptance, independent human review, instructional-effect evidence or a formal security audit.

## Recheck this package

```bash
python3 publication/validate_release.py
shasum -a 256 -c evidence/public_files.sha256
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=public-release-test-key npm test -- --maxWorkers=2 --testTimeout=20000
npm run build
npm run build --prefix api
```

The manifest excludes itself. Use [Getting started](../GETTING_STARTED.md) for environment requirements and [the update guide](../write/UPDATES_v0.3.0.en.md) for configuration and upgrade conditions.
