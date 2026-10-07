# Development and disclosure record

Public author: **Zhenhai He**, GitHub **Youn-17**. Version: **v0.4.0**, prepared **2026-10-07**.

The application snapshot uses development revision `c25f8555184e94701b8c7daef05a2b28673ed329` together with inspected working-tree changes. The public SHA-256 manifests identify the actual published bytes; the revision identifier alone does not identify these uncommitted additions. Previous packages remain identifiable by tags `v0.2.0` and `v0.3.0`. The public repository has its own disclosure history. Local Git dates are author-controlled metadata and are not independently certified creation dates.

## Source correspondence

[source_snapshot.json](source_snapshot.json) records **737 published source files**, their current SHA-256 hashes, and whether each differs from its inspected development copy (**55 publication-adjusted files**). Adjustments retain generic deployment configuration and prior privacy cleanup, remove internal research/operational commentary, update public release notes and fictional media, preserve test compatibility, and apply compatible dependency patches for proxy-addr and Capacitor Android/iOS. They preserve the application contracts and course access controls. Original behavior assertions remain in the tests.

The release supplies English-led system and upgrade guides, Chinese companion documents, original diagrams, fictional demonstration media, attribution, and the MIT License. Private development history, credentials, course records, research manuscripts, internal evaluation scripts and operational account details are excluded. Publication does not modify the private development installation or deploy the hosted site.

## Public file manifest

[public_files.sha256](public_files.sha256) identifies every published file except the manifest itself. From the repository root, run:

```bash
shasum -a 256 -c evidence/public_files.sha256
python3 publication/validate_release.py
```

The tag and GitHub release identify the inspectable version and its publication record. A hash establishes content identity; it does not independently certify authorship, creation time, or worldwide priority. Cite the tag or commit actually used.
