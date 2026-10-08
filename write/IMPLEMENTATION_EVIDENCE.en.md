# Implementation evidence

Current feature and upgrade supplement: [English](UPDATES_v0.5.0.en.md) · [中文](UPDATES_v0.5.0.md).
[System guide](SYSTEM_OVERVIEW.en.md) · [Development record](../evidence/DEVELOPMENT_RECORD.md)

Current publication inherits the v0.4.0 public snapshot and applies the memory delta from development revision `027198aa582dbed9cf82b1175525755cb12acaf2`, dated 2026-10-08. The linked update supplement documents the new paths; file hashes identify the exact publication. These paths are present in the public release. Historical module documents may describe older behavior; the linked source and tests take precedence.

| Documented mechanism | Principal source | Evidence scope |
| --- | --- | --- |
| Course-specific standing | [Course standing](../components/courseStanding.ts), [course settings](../components/courseSettings/CourseSettingsPage.tsx) | Source inspection and existing role tests |
| Public Notes and workspace | [Workspace](../components/Workspace.tsx), [editor](../components/NoteEditorModal.tsx) | Source inspection and existing workspace/editor tests |
| Six Build-on relations | [Types](../types.ts), [relations](../api/src/routes/relations.ts) | Source and relation tests |
| Scaffolds | [Scaffold routes](../api/src/routes/scaffolds.ts), [editor](../components/NoteEditorModal.tsx) | Source and scaffold tests |
| AI roles and tools | [Role catalog](../api/src/services/noteAgentCatalog.ts), [tools](../api/src/services/agentTools.ts) | Source and agent tests; calls require configured services |
| Conversation memory and student context | [Memory](../api/src/services/conversationMemory.ts), [student context](../api/src/services/studentLearningContext.ts), [history loader](../api/src/services/loadConversationHistory.ts) | Source and mocked regression tests; no model-weight training or full-window stress test |
| Selective uptake | [AI panel](../components/NoteAiPanel.tsx), [Note routes](../api/src/routes/notes.ts) | Source checks selection, reason, and source-message requirements |
| Conditional feedback | [Feedback](../api/src/routes/noteAiFeedback.ts), [conditions](../api/src/services/experimentCondition.ts) | Source and feedback tests; conditions affect availability |
| Rise-above | [Room](../components/RiseAboveRoom.tsx), [publication](../api/src/routes/riseAbove.ts), [room service](../api/src/services/riseAboveRoom.ts) | Source; published text is participant-supplied; room-service tests |
| Teacher/student tools | [Teacher navigation](../components/dashboard/teacherDashboardConfig.ts), [personal agent](../components/PersonalAgentPage.tsx) | Source and navigation tests |
| Research export | [Export service](../api/src/services/researchExport.ts), [research UI](../components/dashboard/ResearchZone.tsx) | Source; no real participant export included |
| Architecture | [Client dependencies](../package.json), [API dependencies](../api/package.json), [authentication](../contexts/AuthContext.tsx) | Dependency declarations, source, and release builds |

See [release validation](../evidence/RELEASE_VALIDATION.md) for the actual test totals and limitations. Passing automated tests and builds does not establish a fresh database installation, equivalence to a deployed production revision, complete end-to-end coverage, or educational effectiveness.
