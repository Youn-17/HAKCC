# Development and disclosure record

Public author: **Zhenhai He**, GitHub **Youn-17**. Version: **v0.5.0**, prepared **2026-10-08**.

This publication inherits the inspected v0.4.0 public snapshot and applies the conversation-memory delta plus follow-up Note-text and test-fixture fixes from development revision `027198aa582dbed9cf82b1175525755cb12acaf2`. The inherited snapshot includes previously inspected working-tree changes and publication-only adjustments; this revision identifier alone does not identify all public bytes. The SHA-256 manifests identify the actual published content. Prior public releases v0.2.0, v0.3.0 and v0.4.0 remain available. The public repository has its own disclosure history; private Git history is not imported. Local Git dates are author-controlled metadata, not independently certified creation dates.

## Source correspondence

[source_snapshot.json](source_snapshot.json) records **748 published source files**, their current SHA-256 hashes and **55 publication-adjusted files**. The new memory delta covers 19 source/test/migration files. Publication adjustments preserve prior privacy cleanup, generic configuration, fictional media, test compatibility and existing public dependency patches. The memory change adds no package dependency. Original behavior and access-control assertions remain in the tests; two in-memory database fixtures now support range pagination.

The release supplies English-led system and upgrade guides, Chinese companion documents, original diagrams, fictional demonstration media, attribution and the MIT License. Private development history, credentials, course records, research manuscripts, internal evaluation scripts and operational account details remain excluded. The three follow-up fixes were also saved to the local development checkout. This publication does not deploy the hosted site or migrate a database.

## Public file manifest

[public_files.sha256](public_files.sha256) identifies every published file except the manifest itself. From the repository root, run:

```bash
shasum -a 256 -c evidence/public_files.sha256
python3 publication/validate_release.py
```

The tag and GitHub release identify the inspectable version and publication record. A hash establishes content identity; it does not independently certify authorship, creation time or worldwide priority. Cite the tag or commit actually used.
