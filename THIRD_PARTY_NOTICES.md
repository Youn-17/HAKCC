# Third-party notices

Third-party components retain their own copyrights and licenses. HAKCC's [rights statement](RIGHTS.md) applies to original contributions and does not override dependency terms.

## Bundled icons

`styles/remixicon/remixicon.css` and `styles/remixicon/remixicon.woff2` contain **Remix Icon v4.9.1**, copyright Remix Design. The CSS retains its upstream notice. These assets are governed by the [Remix Icon License v1.0](https://github.com/Remix-Design/RemixIcon/blob/v4.9.1/License), verified against that version's upstream license on 2026-10-04. They are included as functional UI components of HAKCC.

## Dependencies and external services

Frontend and API dependency declarations and lockfiles are provided in `package.json`, `package-lock.json`, `api/package.json`, and `api/package-lock.json`. Packages installed through npm retain their distributed license files. This repository does not vendor `node_modules/`.

The client can load external runtime resources, including Pyodide and web fonts. Those resources are distributed by their providers and retain their applicable terms. AI models, search providers, and Supabase services are separately configured services; publishing HAKCC does not grant access to them.

## Theory and documentation

Knowledge Building and Knowledge Forum intellectual sources are cited in the [theory document](write/THEORETICAL_FOUNDATIONS.en.md). The cited publications are linked, rather than redistributed as PDFs. Original reference diagrams used for local visual-style study are excluded.
