# Release validation

Checked on **2026-10-07** for public release **v0.4.0**. Source basis: `c25f8555184e94701b8c7daef05a2b28673ed329` plus inspected working-tree changes. Exact public bytes are identified by the manifests.

## Executed checks

| Check | Result | Scope |
| --- | --- | --- |
| Locked dependency installation | Passed | Fresh `npm ci --ignore-scripts --no-audit` in the public frontend and API directories on this Mac; private dependencies were not altered |
| Frontend production build | Passed, exit 0 | Final `npm run build` with dummy browser project configuration; Vite reports chunks above its 300 kB warning threshold |
| API TypeScript build | Passed, exit 0 | `npm run build` in `api/` after the proxy-addr patch |
| Full test suite | **186 files / 2,148 tests passed**, exit 0 | Final run: `npm test -- --maxWorkers=2 --testTimeout=20000` with the installed public dependency patches; dummy configuration and local API test servers |
| Credential-pattern scan and exact local-value comparison | No findings | Public files scanned for key/JWT/private-key patterns and four available local credential values; no values are stored in this report |
| Internal-material marker scan | No findings in final files | Checked known private manuscript, planning, operational and internal experiment markers; excluded material remains outside this checkout |
| Source snapshot correspondence | Recorded | **737 source files**, including **55 publication-adjusted files**, listed in [source_snapshot.json](source_snapshot.json) |
| Figure inventory | Eighteen language-specific mechanisms retained | Nine English and nine Chinese mechanisms in draw.io, SVG and PNG; aggregate collection and supplied integrated overview |
| Public documentation | Checked | English and Chinese update guides linked from both homepages; relative targets and fingerprints checked by the release validator |
| Fictional screenshot | Public v0.4.0 changelog recaptured and inspected | Local mock course/participants; sanitized public update history; no real-course login or live AI call |
| Citation metadata | Passed official CFF 1.2.0 schema validation | Zhenhai He, version 0.4.0, release date and repository links |
| Development snapshot stability | Checked | Included source files did not change between snapshot capture and publication preparation |

The checks used Node.js **22.22.3**. Fresh locked installs used `--ignore-scripts`; installation lifecycle scripts on other platforms remain unvalidated. Backend chart generation was exercised by the automated tests on this Mac, including its text fallback. Android/iOS native builds, container startup and installation on other operating systems were not tested. No participant account or paid provider was used.

The prior public test adjustments are retained: workspace tests locate the accessible AI input label, and the sanitizer suite allows 40 seconds for its worker's 30-second guard. Behavior and security assertions remain; application runtime limits were not changed. A sandboxed final run could not initialize temporary HTTP servers and was interrupted. The completed final run permitted local test-server listening; interrupted or failed runs are not counted as passing checks.

## Dependency audit snapshots

Fresh npm audits on **2026-10-07**, after compatible lockfile patches, report:

| Component | Low | Moderate | High | Critical | Total |
| --- | --- | --- | --- | --- | --- |
| Frontend | 1 | 5 | 7 | 0 | 13 |
| API | 0 | 6 | 5 | 0 | 11 |

See [frontend audit](frontend_dependency_audit.json) and [API audit](api_dependency_audit.json). These include tooling and transitive dependencies; the counts do not establish exploitability in this application. Remaining advisories have not been fully remediated or assessed through a formal security audit.

The public locks update proxy-addr to 2.0.8 ([official advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)) and Capacitor Android/iOS to 8.4.3 ([official advisory](https://github.com/advisories/GHSA-rvm3-566m-v7fv)), within the existing package ranges. The root package declarations and unrelated lock entries are preserved. Existing native installations require a rebuild; the GitHub release does not patch the private installation or the deployed service.

## Limits

- Migrations 078–085 are included but were not applied to a live or newly provisioned database. The historical archive still contains duplicate earlier prefixes and deployment-era repairs. Fresh replay remains unvalidated. The intermediate canvas-layout functions are withdrawn by 081 and are not advertised as current features.
- Repository publication does not deploy the hosted platform or establish that it runs this revision.
- AI retrieval, citations, permissions and Jev behavior were checked through source and mocked tests, rather than live-provider acceptance or benchmarking. Default thresholds are not validated educational standards; page mappings and generated citations require checking.
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

The manifest excludes itself. Use [Getting started](../GETTING_STARTED.md) for environment requirements and [the update guide](../write/UPDATES_v0.4.0.en.md) for configuration and upgrade conditions.
