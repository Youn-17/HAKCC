# Release validation

Checked on **2026-10-04** for public release **v0.2.0**. Source snapshot: `f21893aaf50449c8835bd29d9a901464b79d1628`.

## Executed checks

| Check | Result | Scope |
| --- | --- | --- |
| Frontend production build | Passed, exit 0 | `npm run build`; Vite reports chunks above its 300 kB warning threshold |
| API TypeScript build | Passed, exit 0 | `npm run build` in `api/` |
| Full existing test suite | **134 files / 1,588 tests passed**, exit 0 | Dummy browser configuration; local API test servers permitted |
| Credential-pattern scan and exact local-value comparison | No findings in publication files | Provider-key/JWT/private-key patterns and locally configured credential values; no values are written to this report |
| Source snapshot correspondence | Recorded | 621 source files included; 19 publication-adjusted files identified in the snapshot manifest |
| Figure inventory | Eighteen language-specific mechanisms | Nine English and nine Chinese figures, each in draw.io, SVG, PNG; aggregate draw.io/PDF |
| Public privacy regressions | Passed | In-app reference list and update text exclude unpublished-source annotations and private operational notes |
| Fictional documentation media | Visually checked | Three screenshots and three looping GIFs; mock data and scripted responses; no real-course login |
| Added mechanism overview | Original bytes retained; embedded draw.io inspected | Supplied overview displayed on both language homepages and gallery; editable source extracted |
| Public privacy regressions | Passed | In-app reference list and update text exclude unpublished-source annotations and private operational notes |
| Fictional documentation media | Visually checked | Three screenshots and three looping GIFs; mock data and scripted responses; no real-course login |
| Added mechanism overview | Original bytes retained; embedded draw.io inspected | Supplied overview displayed on both language homepages and gallery; editable source extracted |
| Public privacy regressions | Passed | In-app reference list and update text exclude unpublished-source annotations and private operational notes |
| Fictional documentation media | Visually checked | Three screenshots and three looping GIFs; mock data and scripted responses; no real-course login |
| Added mechanism overview | Original bytes retained; embedded draw.io inspected | Supplied overview displayed on both language homepages and gallery; editable source extracted |
| Citation metadata | Passed official CFF 1.2.0 schema validation | Public author name, version, date, and repository links |
| Aggregate figure PDF | Eighteen pages verified | English and Chinese mechanism collection |
| Documentation links and public-file fingerprints | Checked by the release validator | Relative targets and SHA-256 manifest; rerun using the script below |

The checks used Node.js **22.22.3** and the development installation's existing dependencies. Temporary dependency symlinks were excluded from publication. A clean `npm ci` installation on a new machine, including native backend chart dependencies, was not tested.

The initial sandboxed test attempt failed because local listening ports were prohibited. A subsequent run identified missing browser project configuration in one suite. The final run used the dummy values documented in [Getting started](../GETTING_STARTED.md), without production credentials, and passed all suites.

## Dependency audit findings

The checked lockfiles have known npm advisories:

| Component | Low | Moderate | High | Critical | Total |
| --- | --- | --- | --- | --- | --- |
| Frontend | 1 | 5 | 6 | 0 | 12 |
| API | 0 | 3 | 4 | 0 | 7 |

See [frontend audit](frontend_dependency_audit.json) and [API audit](api_dependency_audit.json) for affected packages and advisory links. Findings include development tooling and transitive packages, as well as direct dependencies; the counts do not establish that each advisory is exploitable in HAKCC.

The lockfiles are preserved as part of the disclosed development snapshot. Dependency remediation requires its own reviewed update and regression checks. No blanket `npm audit fix --force` or unreviewed major downgrade was applied. **This is not a vulnerability-free or production-security-certified release.**

## Limits

- The historical database migration archive has duplicate version prefixes and deployment-era repairs. A fresh database replay and container startup were not validated.
- Publishing the repository does not deploy an application or establish that the hosted site runs the same revision.
- No production credentials, real participant exports, or authenticated course recordings are included.
- Automated tests and source inspection do not constitute complete live teacher/student acceptance, independent human review, or evidence of learning outcomes.
- Secret scans address known values and patterns; they are not a formal security audit of every possible information channel.

## Recheck this package

```bash
python3 publication/validate_release.py
shasum -a 256 -c evidence/public_files.sha256
```

The manifest excludes itself. To repeat software checks, use the commands and dummy configuration in [Getting started](../GETTING_STARTED.md). Later changes require a new manifest and a corresponding verification record.
