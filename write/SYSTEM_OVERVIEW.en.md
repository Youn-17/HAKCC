# HAKCC system overview

Current feature and upgrade supplement: [English](UPDATES_v0.4.0.en.md) · [中文](UPDATES_v0.4.0.md).
[Platform](https://ideaweave.tech/) · [Home](../README.md) · [Theory](THEORETICAL_FOUNDATIONS.en.md) · [中文](SYSTEM_OVERVIEW.md)

HAKCC organizes a course's ideas, questions, evidence, and reflection into a shared knowledge space. Its basic object is the **Note**: a contribution that others can read, revise where permitted, connect, and build on. The design centers community inquiry and student responsibility for ideas.

## 1. Courses, communities, and roles

Authenticated users enter spaces through their courses. A course can contain Views, groups, learning goals, materials, tasks, and a teaching schedule. Platform roles include student, teacher, and administrator; membership and staff standing are also evaluated within each course. Being a teacher does not automatically grant management rights across every course.

Students contribute ideas, examine peers' explanations, use Build-on, discuss with AI, develop syntheses, and reflect. Teachers organize inquiry, configure support, interpret community activity, and respond to help requests. Administrators maintain platform-wide settings and access.

Course goals support teacher preparation. The course-material management area supports staff organization and AI retrieval; students read original materials through attachments published in the knowledge space. Exact access depends on the course and role.

## 2. Shared knowledge workspace

![Knowledge-building discourse](../figure/en/02_knowledge_building.png)

The workspace displays contributions as cards and relations. Text Notes, drawings, and attachments can be organized in multiple Views. Timelines, Build-on networks, and idea graphs help members examine how inquiry develops. A shared inquiry question provides a reference point for otherwise fragmented contributions.

The editor supports titles, content, keywords, formatting, images, and documents. **Scaffolds** provide prompts for explaining, identifying uncertainty, testing an AI suggestion, and connecting ideas. Course settings determine which scaffold groups are available or required. A scaffold supports a knowledge move; filling its fields alone does not demonstrate that the move is substantive.

## 3. Build-on discourse

A Build-on contribution connects a new Note to an existing Note and identifies the relation:

| Relation | Typical contribution |
| --- | --- |
| Extend | Add an explanation, condition, or implication |
| Clarify | Define a term, scope, or ambiguity |
| Question | Identify something that remains unexplained |
| Challenge | Test an assumption, counterexample, or conflict |
| Evidence | Introduce material that supports or tests an idea |
| Synthesize | Connect ideas to develop a further explanation |

For example, one Note might claim that AI enables personalized instruction. A peer could ask how genuine understanding is identified, another could bring evidence, and a later contribution could explain the conditions under which the original claim holds. Relation lines preserve those connections for further discussion.

## 4. AI partners and reflective uptake

![AI partnership](../figure/en/03_ai_partner_and_uptake.png)

AI conversations can operate around a Note, a workspace, or a personal task. In addition to free questioning, the student-facing role catalog includes idea clarification, inquiry gaps, idea connections, evidence testing, and idea improvement. Roles and entry points have different tool sets.

Context can include authorized Notes, discussions, and course materials. Tools support community retrieval, argument analysis, source retrieval, web evidence, and reflection. Teacher tools also support lesson preparation and learning-process analysis. Tool use operates within bounded requests and is constrained by access, role, and configuration.

Students can select an excerpt from an AI response and provide an **adoption reason** before taking it into the shared knowledge space. The server checks the source conversation and message, and retains associated provenance. Students can also reject, question, or revise a suggestion. A successful model response does not itself constitute community knowledge advancement.

Web search, image generation, model availability, and feedback depend on configured services. An unconfigured AI entry cannot complete a real model call. AI-provider keys are handled by the backend rather than supplied in browser code.

## 5. Conditional feedback

![Conditional AI feedback](../figure/en/09_conditional_ai_feedback.png)

When enabled, Note feedback checks the draft under conditions such as a pause in writing. It can draw attention to unexamined AI content, reasoning gaps, insufficient evidence, weak connections, promising directions, or unclear expression, and invite further explanation.

Actual calls depend on course switches, permissions, experimental conditions, deduplication, and cooldown controls. Requested feedback and automatic checks have their own entry points and conditions. The student evaluates the response and decides what to change. Feedback should not be interpreted as an automatic grade or evidence of learning gains.

## 6. Rise-above discussion

![Rise-above discussion](../figure/en/04_rise_above_discussion.png)

Participants select at least two source Notes to establish a discussion room. Source contributions remain available while participants explore connections, disagreements, and unresolved questions. AI discussion roles can ask questions, offer examples or counterexamples, examine sources, and connect ideas.

The published synthesis uses a title and content supplied by a participant. The publication endpoint permits the room creator or authorized course staff; it does not request an AI-written final synthesis during publication. The Rise-above retains source Note references and synthesis relations. This preserves a route back to the ideas from which the new explanation developed.

## 7. Teacher workflows

| Area | Work supported |
| --- | --- |
| Course settings | Goals, materials, tasks, schedules, membership, and collaboration settings |
| Knowledge space | Reading contributions, organizing Views, scaffolds, and discourse |
| AI support | Teacher conversations, lesson preparation, process analysis, and evaluation support |
| Student support | Help requests and feedback linked to the learning context |
| Research tools | Temporal, network, sequence, discourse, participation, coding, and export tools |

These records inform questions such as: Which explanation remains incomplete? Which idea merits further development? Who has had limited opportunities to contribute? Counts of Notes and relations describe activity; they cannot independently determine conceptual understanding.

## 8. Student workflows

A typical cycle is to enter a course, read the shared problem and relevant Notes, formulate an explanation, build on a peer's idea, examine evidence or discuss with AI, judge and revise the contribution, participate in synthesis, and consider the community's next inquiry.

Personal areas provide access to Note activity, knowledge connections, promising ideas, thinking development, collaboration, feedback, and AI. What is visible depends on role, course configuration, and recorded activity. The current publication does not claim a completed live walkthrough of every student and teacher pathway.

## 9. Architecture and research records

![Architecture](../figure/en/07_technical_architecture.png)

The web client uses React, TypeScript, and Vite. An Express API handles course operations, Notes, relations, AI requests, and analysis. Supabase supplies authentication, PostgreSQL, and storage. Server-side access control complements database policies; service-role credentials must stay on the server.

Research exports cover Notes, relations, participants, conversation messages, AI feedback and interventions, events, Note revisions, support requests, and class sessions. Participant codes are used by default; real-name inclusion requires an explicit option. Anonymization options do not guarantee that free-text content cannot identify a person, so researchers must inspect the material they actually export. No participant dataset is included in this repository.

## 10. Scope and verification

This guide describes the inspected source snapshot dated 2026-10-04. [Implementation evidence](IMPLEMENTATION_EVIDENCE.en.md) maps descriptions to code. [Release validation](../evidence/RELEASE_VALIDATION.md) separates tests and builds from database deployment and live classroom evaluation. Feature availability may differ across installations and course settings.

For installation, see [Getting started](../GETTING_STARTED.md). For classroom use, enter a course through [the platform](https://ideaweave.tech/) using your own authorized account, identify the shared problem, read relevant contributions, and bring explanations, evidence, and reflection back into the community.
