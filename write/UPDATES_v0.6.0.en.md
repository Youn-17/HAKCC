# v0.6.0: shared documents and contextual drawing

[Home](../README.md) · [中文](UPDATES_v0.6.0.md) · [Validation](../evidence/RELEASE_VALIDATION.md)

## Shared documents in a knowledge space

Members can create a shared writing card, open it by double-clicking, and edit together. The editor uses Tiptap, Yjs and Hocuspocus with a Word-style Home / Insert / View ribbon, a paper view, ruler, style buttons, character count and zoom. Paragraphs, headings, basic text formatting, lists, tables and PNG/JPG images are supported. Editor controls currently use Chinese labels.

A room has the same ID as its Note card. The existing API checks course membership, group access and deleted Notes. During experiment mode, shared-space participants are read-only; course staff retain their existing permissions. Connections recheck access every 30 seconds; existing caches can extend revocation to about 90 seconds. The API owns the server-created metadata marker and ordinary Note updates cannot forge or remove it.

The Note card remains in Supabase, while collaborative body state and snapshots belong to a separate SQLite service. An initialized card is compensated if body provisioning fails. SQLite uses WAL and FULL synchronization. The editor reports saved only after its normalized full Yjs state matches a durable server acknowledgement. Pending offline changes are separated by account and room in browser IndexedDB; read-only sessions do not upload old pending edits.

The service retains the latest 20 document snapshots. A manual snapshot preserves the current version, and a changed document can create an automatic snapshot after five minutes. There is no snapshot restore interface yet. This is separate from deployment-release retention.

## Try the fictional local demo

With Docker running and Node.js 22.22.3 available, from the repository root:

```bash
bash scripts/start_collab_demo.sh
```

Open http://localhost:3110 in two browser windows and choose the fictional students A and B. A read-only visitor can inspect and export the document. No Supabase project or real student account is needed for this demo.

The script generates a private local environment file, and the Compose file binds only to loopback. The persistent volume survives container recreation and ordinary `down`. Do not delete the volume if you want to retain documents. Do not publish the demo to the internet: fictional demo authentication is explicitly rejected in production mode.

## Connect an existing installation

Both frontend and API require explicit enablement. This update does not add a new Supabase migration, but it assumes the existing supported Note metadata, view, course and membership schema. Fresh replay of the historical migration archive remains unvalidated.

| Component | Configuration |
| --- | --- |
| Frontend build | `VITE_ENABLE_COLLAB_DOCUMENTS=true` |
| Existing API | `COLLAB_ENABLED=true`, `COLLAB_INTERNAL_URL`, `COLLAB_PUBLIC_WS_URL`, `COLLAB_SECRET` |
| Collaboration service | `NODE_ENV=production`, `COLLAB_DEMO=false`, `COLLAB_AUTH_API_URL`, `COLLAB_ORIGINS`, `COLLAB_DB_PATH` |

The API and collaboration service share a random secret of at least 32 characters for internal requests. It is not a browser credential. WebSocket clients use the existing authenticated account token; the collaboration service asks the API to validate room access. Configure exact permitted frontend Origins and a TLS WebSocket proxy. Only the WebSocket path belongs on the public proxy; internal document HTTP endpoints remain private.

A generic Linux-host template is [docker-compose.collab-production.yml](../docker/docker-compose.collab-production.yml). Build an image from [collab/Dockerfile](../collab/Dockerfile), then supply your own `HAKCC_COLLAB_IMAGE`, `COLLAB_ENV_FILE`, `COLLAB_DATA_DIR` and `COLLAB_AUTH_API_URL`. Its host networking reaches an existing API, while the service binds to loopback. The template limits memory to 512 MiB and CPU to one; it does not establish a concurrent-user capacity. Ensure the data directory is writable by container UID 1000.

Preserve the data directory independently of application releases. Back up through SQLite's online backup API and check integrity; copying just the live main file can omit WAL state. Keep a consistent backup on a separate storage location for disaster recovery. No database, credentials or deployed server layout are supplied here.

## Other source updates

- AI drawing uses conversation history, memory and accessible Note/document context, chooses structured diagrams or generated scenes, and can revise the previous drawing. Optional server-side Jev judgments route requests and check the plan, with bounded retries and fallback behavior.
- Canvas search and Build-on folding improve navigation; language preference, teaching settings and person-level export handling are also updated.
- Node 22.22.3 is pinned for the frontend/API container builds and the new service. Previously published Capacitor and proxy-addr patches are retained.

The drawing context described above does not include the new separately stored collaborative body. It is not yet read by AI, the course knowledge base or research exports.

## Limits and data handling

A Yjs state is limited to 8 MiB. Each image is limited to 1 MiB and must be PNG/JPG. Word export preserves basic paragraphs, headings, lists, tables, images and common formatting; it does not reproduce complex Word layouts. The paper view is continuous, not a full pagination engine. Word import, comments, tracked changes and snapshot restore are not implemented.

This is software functionality and design evidence, not evidence of learning effects. Conversation memory remains application persistence/retrieval rather than model training. This publication does not upload student records, deploy the reader's installation or synchronize a local demo with a remote database. See the release report for the executed checks and their limits.
