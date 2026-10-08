# v0.5.0: conversation memory and student learning context

[Home](../README.md) · [中文说明](UPDATES_v0.5.0.md) · [Installation](../GETTING_STARTED.md) · [Validation](../evidence/RELEASE_VALIDATION.md)

Knowledge-space and Note AI now restore a longer conversation history, retain a rolling memory of earlier turns, and retrieve relevant records belonging to the current student in the current course. Students continue to choose the configured model and judge its suggestions. This release implements application-level persistence and retrieval; it does not train or fine-tune model weights or demonstrate improved learning outcomes.

## Conversation continuity

Both entry points use a shared history loader that pages through saved messages instead of relying on the former 12-message Note or 40-message workspace query. Model input contains recent complete turns that fit the allocated history budget. Older material can be progressively summarized into a thread-scoped `conversation_memory` JSONB field; original messages remain in their transcript.

The summary instruction preserves goals, requirements, corrections, decisions and unresolved questions, and distinguishes student statements from AI suggestions. A refresh processes at most 100 older rows, with a 16,000-character input target and a summary capped at 4,500 characters (smaller for smaller model budgets). Oversized historical messages retain excerpts with an explicit omission marker. Compaction is incremental, so a single turn does not necessarily incorporate the entire backlog.

History or persisted-memory read failures stop the affected request rather than silently treating it as a new conversation. Summary-generation or save failures retain the previous checkpoint and retry on a later turn. Summary generation calls the configured external provider and can incur additional usage charges. A summary may omit or misstate information; it is not a complete transcript or a verified account of the student's intentions.

## Model-dependent context

The code retains model selection and allocates history using the model-window mapping in [modelContextBudget.ts](../api/src/services/modelContextBudget.ts). Mapped families include selected 1M-window models, Gemini 2.5 at 1,048,576 tokens and Kimi K2.5/2.6/2.7 at 262,144 tokens. Unknown models receive a conservative 32,768-token assumption. These are application configuration assumptions, not a guarantee of a provider or gateway account's entitlement.

History is estimated using UTF-8 bytes and message overhead, with about 25% of the nominal window plus an additional 8,000 units reserved for other input and output. This is a conservative approximation, not the provider's tokenizer or an exact bound for the complete multimodal/tool request. Workspace fallback candidates are fitted to their own budgets. An individual oversized final message is retained even if it exceeds the allocated history estimate. This release has not stress-tested a full 1M-token request or every provider/model combination.

## Personalization from the student's own records

After course access checks, [studentLearningContext.ts](../api/src/services/studentLearningContext.ts) re-reads records from spaces the student can currently enter in that course:

- Rank up to 40 recent, non-deleted Notes authored by the student and select up to five.
- Rank up to 20 recent student questions from each of workspace and student-owned AI Note conversations, selecting up to eight across both sources.
- Retrieve up to three derived summaries from recent student-owned conversations, with source identifiers and timestamps.

This is bounded lexical selection and recent-memory retrieval. It is not an exhaustive search of the student's history or a permanent ability profile. Deleted Notes/threads and inaccessible spaces are excluded by the source queries; records belonging to other students or courses are excluded. Derived summaries are fallible and may contain AI suggestions. Source text is presented as quoted data, with current corrections and the current Note taking priority. Teachers do not receive a student profile through these prompts.

Selected context, conversation history and earlier material used for summarization are sent to the course's configured AI provider. Operators should explain this data flow to users and configure providers appropriately. The application adds no separate memory viewing, editing or deletion interface in this release; summary refresh does not by itself guarantee immediate removal of previously summarized facts.

## Upgrade an existing installation

1. Back up the database and inspect [086_conversation_memory.sql](../supabase/migrations/086_conversation_memory.sql) against the existing schema. It adds `conversation_memory jsonb NOT NULL DEFAULT '{}'::jsonb` to `agent_conversations` and `note_conversation_threads` using `ADD COLUMN IF NOT EXISTS`.
2. Apply the reviewed migration before starting the updated API, then build and deploy the API through your normal process. No frontend environment variable or new package dependency is required by this change.
3. In an isolated project, check ownership/course boundaries, long conversations, a smaller-window model, provider failure and checkpoint persistence. Inspect actual provider request limits rather than assuming the mapping establishes account support.

Existing route authorization remains necessary; the migration does not create a new RLS policy or grant. The historical migration archive is still not a verified clean-install sequence. See the [previous v0.4.0 guide](UPDATES_v0.4.0.en.md) when upgrading from an older installation. Publishing this repository does not deploy an application or apply a database migration.

## Inspect the implementation

| Responsibility | Source and regression evidence |
| --- | --- |
| Ordered, paginated history | [Loader](../api/src/services/loadConversationHistory.ts), [tests](../api/src/services/loadConversationHistory.test.ts) |
| Faithful recent-turn selection | [Selector](../api/src/services/conversationHistory.ts), [tests](../api/src/services/agentContextHistory.test.ts) |
| Window mapping and budget | [Budget](../api/src/services/modelContextBudget.ts), [tests](../api/src/services/modelContextBudget.test.ts) |
| Rolling memory and checkpoints | [Memory](../api/src/services/conversationMemory.ts), [tests](../api/src/services/conversationMemory.test.ts) |
| Student-owned course context | [Retrieval](../api/src/services/studentLearningContext.ts), [tests](../api/src/services/studentLearningContext.test.ts) |
| Route integration | [Workspace](../api/src/routes/workspaceAgent.ts), [Note](../api/src/routes/noteConversations.ts), [Note process tests](../api/src/routes/noteConversationsProcess.test.ts) |

Automated regression uses mocked data/providers and local test servers. It does not establish live-provider acceptance, complete privacy/security assurance or educational effectiveness. Author and maintainer: **Zhenhai He**.
