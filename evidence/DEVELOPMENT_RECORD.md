# Development and disclosure record

Public author: **Zhenhai He**, GitHub **Youn-17**. Version: **v0.2.0**, prepared **2026-10-04**.

The application snapshot is based on source revision `f21893aaf50449c8835bd29d9a901464b79d1628`. The public repository has its own disclosure history. Local Git dates are author-controlled metadata and are not independently certified creation dates.

## Source correspondence

[source_snapshot.json](source_snapshot.json) records the published source paths, current SHA-256 hashes, and whether each file was adjusted for publication. Adjustments replace deployment-specific literals, remove private explanatory material, update the public in-app release notes, and provide generic setup configuration. They preserve the application contracts and course access controls.

The release adds an English-led system guide, Chinese companion documents, original diagrams, fictional demonstration media, attribution, and the MIT License. Private development history, credentials, course records, research manuscripts, and operational account details are excluded.

## Public file manifest

[public_files.sha256](public_files.sha256) identifies every published file except the manifest itself. From the repository root, run:

```bash
shasum -a 256 -c evidence/public_files.sha256
python3 publication/validate_release.py
```

The tag and GitHub release identify the inspectable version and its publication record. A hash establishes content identity; it does not independently certify authorship, creation time, or worldwide priority. Cite the tag or commit actually used.
