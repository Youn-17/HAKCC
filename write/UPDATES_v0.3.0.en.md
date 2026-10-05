# HAKCC v0.3.0: features and upgrade notes

[Home](../README.md) · [中文补充说明](UPDATES_v0.3.0.md) · [System guide](SYSTEM_OVERVIEW.en.md) · [Validation](../evidence/RELEASE_VALIDATION.md)

**Zhenhai He · 6 October 2026.** This release extends the public application snapshot with knowledge exploration, construction history, feedback uptake checks, and more inspectable AI interaction. It includes inspected working-tree changes as well as committed development changes. The public manifest identifies the exact published files; the development revision alone does not identify the complete package.

## Changes from v0.2.0

| Area | What is available | Main implementation |
| --- | --- | --- |
| Knowledge map | Branch and time layouts; author, date, relation-type and branch filters; trace an idea's ancestors and descendants; inspect and locate its original Note | [BuildOnExplorer](../components/BuildOnExplorer.tsx), [map layout](../components/knowledgeExplorerModel.ts) |
| Construction timeline | Overview, Note tracks and people tracks; accessible-space scope; group, person, date and event filters; revision excerpts; continuous-time sequence playback | [SpaceTimeline](../components/SpaceTimeline.tsx), [ConstructionSequence](../components/ConstructionSequence.tsx) |
| Feedback uptake | Accept feedback, revise the original Note, then assess the revision when contributing; avoid a redundant linked feedback Note when the revision demonstrably addresses the suggestion | [feedback routes](../api/src/routes/noteAiFeedback.ts), [uptake checks](../api/src/services/feedbackUptake.ts) |
| AI execution display | Tool names, status, result summaries and elapsed time; completed steps collapse into an expandable summary | [AgentProcess](../components/AgentProcess.tsx), [tool summaries](../api/src/services/toolResultSummary.ts) |
| Answer length and readability | Brief, Medium and Detailed preferences; question-depth adjustment; local Enter-to-send and larger-text settings | [length preferences](../components/answerLengthPref.ts), [length planning](../api/src/services/answerLength.ts), [chat settings](../hooks/useChatPreferences.tsx) |
| Discussion topics | Source-linked labels indicating what the current View discusses; cached by Note signature and periodically refreshed | [topic routes](../api/src/routes/viewTopics.ts), [topic generation](../api/src/services/viewTopics.ts) |
| Optional Jev judgments | Separate feedback judgments and answer-depth planning; off, shadow and gate modes; server-side configuration and fallback | [configuration](../api/src/config/jev.ts), [feedback integration](../api/src/services/feedbackJev.ts) |
| Feedback-check records | Record outcomes once a check reaches the judgment stage, including silent decisions; authorized analysis exports include these records | [check records](../api/src/services/feedbackChecks.ts), [export service](../api/src/services/researchExport.ts) |
| Course membership and help | Distinguish teacher/student counts; teacher help routes unresolved questions to platform administrators, while student help follows course routing | [member counts](../api/src/services/courseMemberCounts.ts), [help routes](../api/src/routes/support.ts) |

The mechanism gallery, Knowledge Forum references, editable figure sources, and fictional demonstration clips remain available. The existing figures and clips explain the baseline mechanisms; they are not recordings of every new v0.3.0 interaction. Some generated content, including the current topic-generation prompt, remains oriented toward Chinese course content even when English interface labels are selected.

## Student workflow

1. Open a course and an accessible knowledge space. Use the workspace's Build-on network to inspect the knowledge map. Select an idea, trace its connections, then open the original Note or its timeline. Map branches derive from stored relations, rather than an AI assessment of idea quality.
2. Open the construction timeline. Switch between the overall trajectory, Note tracks and people tracks. Filter the events before inspecting details. Sequence playback follows recorded timestamps and preserves inactivity gaps; replay changes the presentation clock, not the underlying records or export selection.
3. When feedback is useful, accept it and improve your original Note. Contribute the Note to settle the accepted feedback. Merely closing the editor does not complete uptake review.
4. While asking an AI partner, choose a preferred answer length. Inspect tool steps when available and check the resulting response against the original sources. The length setting is guidance, not a guaranteed character limit; provider limits and failures can still affect completion.

### How feedback acceptance is settled

Acceptance does not immediately create a public feedback Note. The contribution-time endpoint checks the Note author, course access, accepted-item status, source snapshot and latest revision. AI excerpts and scaffold labels are excluded from the extracted student-authored text. An unchanged contribution can leave the feedback unaddressed. A changed contribution is not sufficient evidence by itself: a successful uptake review needs an exact newly added excerpt from the student's text, rather than copied feedback.

When review finds the suggestion addressed, the improved original Note carries the work forward. An accepted item that remains unaddressed can produce a linked feedback Note, subject to permission and concurrency checks. Missing evidence or an unavailable/invalid model review leaves the outcome uncertain for a later retry. Students can inspect the provenance; these checks are software judgments and can be mistaken.

## Teacher workflow and data boundaries

Teachers configure providers, feedback categories, sensitivity and discussion-topic availability within the course settings. A missing provider configuration prevents model-dependent features from working. Topic labels locate discussion and link back to source Notes; the prompt asks for topics rather than a final synthesis. Generation is conditional on available Notes, enabled settings and permitted participation conditions, and may return cached or stale results after failures.

The timeline can read the current space or accessible spaces in the same course. The server checks access to each candidate space. Private AI feedback and personal Note conversations are limited to the requesting user's own activity, including when the requester is a teacher. The optional **My private AI activity** filter changes visibility within that already restricted result.

Timeline export is limited to course staff. It downloads an event CSV and a JSON manifest containing filters, scope, coverage and current membership context. Participant identifiers use course-scoped stable codes. This export omits Note titles and text content; event, Note, course, space and group identifiers remain. Treat it as a restricted process export, not a guarantee of anonymity. Separate research exports have their own fields and authorization requirements.

Coverage metadata reports source truncation and incomplete revision snapshots. Group affiliation reflects the current roster, rather than a reconstructed historical roster. Older revision timestamps can fall back to creation timestamps when the historical schema lacks the edit-time field. Missing events or snapshots cannot be restored by replay.

Feedback-check logging begins at the judgment stage. Checks stopped earlier by eligibility, cooldown or condition gates are not represented as model judgments. Counts therefore describe the recorded stage, rather than every attempted check or a validated learning measure.

## Upgrade requirements

Review the installation-specific schema and backups before applying migrations. For an existing installation corresponding to the prior snapshot, the new files are:

| Migration | Purpose |
| --- | --- |
| [074](../supabase/migrations/074_feedback_suggested_title.sql) | Add a suggested title to accepted feedback |
| [075](../supabase/migrations/075_support_asker_role.sql) | Distinguish student and teacher support routing |
| [076](../supabase/migrations/076_view_topic_summaries.sql) | Add a server-only topic-summary cache |
| [077](../supabase/migrations/077_feedback_trigger_checks.sql) | Add server-only feedback-check records |

Apply these in the stated order in an isolated environment and verify permissions before upgrading your installation. The historical migration archive still has earlier duplicate prefixes and repair scripts; this publication has not validated a fresh replay or applied migrations to the hosted platform. See [Getting started](../GETTING_STARTED.md).

### Optional server-side Jev configuration

Copy values into your own `api/.env`, never into the browser environment or public repository:

```dotenv
JEV_API_KEY=
JEV_FEEDBACK_MODE=shadow
JEV_NEED_THRESHOLD=0.5
JEV_PROMISING_THRESHOLD=0.7
JEV_ANSWER_LENGTH=on
JEV_MODEL=jev-1.13.0
JEV_TIMEOUT_MS=4000
```

An empty key disables Jev feedback and answer-depth calls. With a key, **shadow** records Jev's judgment alongside the primary model while leaving the primary decision in place. **gate** uses Jev to judge need and type before the main model writes feedback; Jev failures return to the primary model path. **off** disables Jev feedback judgments; set `JEV_ANSWER_LENGTH=off` separately to disable depth calls. Thresholds are defaults adjusted by course sensitivity and feedback-fatigue handling, not validated educational cutoffs.

The runtime's default endpoint is configured in [jev.ts](../api/src/config/jev.ts); `JEV_ENDPOINT` can override it. Restart the API after changing environment variables. Feedback judgment sends the Note title and a bounded text excerpt; answer-depth judgment sends a bounded question excerpt. No profile name is appended, but user-written text can contain identifying information. Only enable the external service under the data-use arrangements applicable to your course.

No external provider account, benchmark dataset, actual participant record, private research proposal or provider credential is supplied by this package.

## Verification and theoretical attribution

The [release record](../evidence/RELEASE_VALIDATION.md) distinguishes executed builds/tests from untested database, deployment and live-provider behavior. Current tests use dummy settings and local fixtures; source inspection and automated checks do not establish instructional effectiveness.

Knowledge Building theory and Knowledge Forum remain the principal design foundations, credited to **Marlene Scardamalia and Carl Bereiter**. See [theoretical foundations](THEORETICAL_FOUNDATIONS.en.md), [IKIT](https://ikit.org/) and [Knowledge Forum](https://kf6.ikit.org/login). The new views expose ideas and contribution histories for human interpretation; they do not certify knowledge improvement, collective responsibility or epistemic agency.
