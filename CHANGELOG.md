# Changelog

## v0.5.0 — 2026-10-08

- Restore paginated history for knowledge-space and Note AI instead of short fixed queries.
- Persist thread-scoped rolling summaries while retaining original messages and failure checkpoints.
- Allocate history by configured model windows, retaining model choice and adapting workspace fallback budgets.
- Retrieve relevant student-owned Notes, questions and recent summaries within the current course and accessible spaces.
- Add migration 086 and bilingual guidance covering external processing, summary limitations and upgrade checks.

See [memory and upgrade notes](write/UPDATES_v0.5.0.en.md) and [executed validation](evidence/RELEASE_VALIDATION.md). This is application-level memory and retrieval, not model training; repository publication does not deploy the hosted application.

## v0.4.0 — 2026-10-07

- Integrate scoped course-material retrieval into Note and workspace AI with numbered source cards and available PDF page references.
- Add teacher knowledge-base inclusion switches, material re-parsing, search tests and processing/retrieval summaries.
- Add bounded vector jobs, keyword fallback, reranking and contextual follow-up queries.
- Require a typed question with attachments; restore failed sends and match reused conversations to assistant and course.
- Improve canvas pagination, process counts and backend report/chart generation.
- Update bilingual public guides and generic server configuration; retain all existing figures and fictional demonstrations.
- Include compatible security patches in the public lockfiles: proxy-addr 2.0.8 and Capacitor Android/iOS 8.4.3. These changes do not deploy or rebuild existing installations.

See [feature and upgrade notes](write/UPDATES_v0.4.0.en.md) and [executed validation](evidence/RELEASE_VALIDATION.md). Historical migrations 078–085 require installation-specific review; this publication does not deploy the hosted application.

## v0.3.0 — 2026-10-06

- Add branch/time knowledge maps, filtered construction timelines and timestamp-based sequence replay.
- Review accepted feedback against the contributed original Note before deciding whether a linked feedback Note is needed.
- Show AI execution steps and summaries; add answer-length and readability preferences.
- Add source-linked discussion topics, optional server-side Jev judgments and judgment-stage check records.
- Improve teacher/student member counts and role-specific technical-help routing.
- Add English and Chinese feature, configuration, permission and migration explanations; retain the mechanism gallery and KF attribution.

See [detailed update notes](write/UPDATES_v0.3.0.en.md) and [executed validation](evidence/RELEASE_VALIDATION.md). Existing installations require review of migrations 074–077. Repository publication does not deploy the hosted application.

## v0.2.0 — 2026-10-04

Open-source HAKCC application and English-led public documentation.

- Release original code, documentation, and HAKCC diagrams under the MIT License.
- Present a mechanism overview and all nine mechanisms on the English homepage, with a complete bilingual gallery and editable draw.io sources.
- Add fictional-data screenshots and looping demonstrations of Build-on, AI partnership, and Rise-above.
- Document Knowledge Forum precedents with Scardamalia's original publications, IKIT, and KF6 links.
- Limit the public package to application behavior, published theoretical sources, and demonstrative data.
- Provide citation metadata, content fingerprints, regression checks, build results, and setup limitations.

This version identifies the public package. Application dependency/package versions remain those of the source snapshot.
