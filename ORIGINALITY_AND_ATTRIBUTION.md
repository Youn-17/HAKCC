# Design contributions and attribution

**Creator and maintainer: Zhenhai He.** Release: v0.3.0. Source basis: `9f1e83a0ba93bb4a0fbdedf4d7e4d641fc9f7b70` plus inspected working-tree changes, identified by the public file manifest.

HAKCC is an independently implemented platform for human–AI knowledge collaboration. This statement makes its design claims inspectable alongside the published source. It is not a claim that every underlying concept was first invented in HAKCC.

## Contributions documented in this release

| Design area | Intellectual precedent | HAKCC implementation | Inspectable evidence |
| --- | --- | --- | --- |
| Public idea improvement | KB; KF Notes, Views, and Build-on | A course-scoped workspace connecting editable Notes through six typed discourse relations | [Workspace](components/Workspace.tsx), [Note routes](api/src/routes/notes.ts), [relation routes](api/src/routes/relations.ts) |
| Contextual AI partnership | KB epistemic agency and constructive use of sources | Five optional inquiry roles and role-dependent tools operating around Notes and community context | [Role catalog](api/src/services/noteAgentCatalog.ts), [agent tools](api/src/services/agentTools.ts), [agent loop](api/src/services/agentLoop.ts) |
| Reflective uptake | Student judgment and responsibility for ideas | Selected AI text must have an adoption reason; source conversation/message and model provenance are retained | [Note AI panel](components/NoteAiPanel.tsx), [Note routes](api/src/routes/notes.ts) |
| Conditional feedback | Feedback supporting idea improvement | Feedback eligibility combines course configuration, permissions, condition gates, deduplication, and cooldown controls | [Feedback routes](api/src/routes/noteAiFeedback.ts), [condition service](api/src/services/experimentCondition.ts) |
| Collaborative synthesis | KB/KF Rise-above | Source Notes remain available in a discussion room; participants supply the published synthesis and retain source relations | [Discussion room](components/RiseAboveRoom.tsx), [publication route](api/src/routes/riseAbove.ts) |
| Teaching and research support | Collective cognitive responsibility and embedded assessment | Course-specific teacher navigation, help channels, and exports with participant coding | [Teacher navigation](components/dashboard/teacherDashboardConfig.ts), [export service](api/src/services/researchExport.ts) |

The contribution lies in the implemented configuration and integration of these mechanisms. Establishing novelty relative to the entire research and software literature would require a separate comparative study.

## Attribution boundaries

The foundational KB theory is credited to **Marlene Scardamalia and Carl Bereiter**. KF is the software precedent for Notes, Views, Build-on, Scaffolds, and Rise-above. Those terms and pedagogical ideas are not claimed as inventions of HAKCC. See the [theory document](write/THEORETICAL_FOUNDATIONS.en.md) for primary references.

Third-party software and bundled assets retain their applicable rights. Their use does not transfer authorship of those components to HAKCC. AI-assisted drafting and artifact preparation are disclosed in [AUTHORS.md](AUTHORS.md).

HAKCC is not an official KF distribution. Naming intellectual sources does not imply their authors' endorsement.

## What the public record establishes

The tagged GitHub release identifies a public package that others can inspect and cite. Its source paths, source snapshot identifier, and SHA-256 manifest connect the explanation to specific code and artifact bytes. The published manifest records content identity.

Local Git dates are author-controlled metadata; hashes identify content rather than independently verifying authorship or creation time. This record supports attribution and version traceability. It does not certify worldwide invention priority or establish a legal ruling on ownership. Platform capabilities also do not establish educational effectiveness.
