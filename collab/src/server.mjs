import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import jwt from 'jsonwebtoken';
import { pathToFileURL } from 'node:url';
import { DocumentStore, MAX_BYTES } from './store.mjs';
import { exportWord, snapshotContent } from './export.mjs';

const PEOPLE = {
  'student-a': { id: 'student-a', name: '试点学生 A', color: '#2563eb', canEdit: true },
  'student-b': { id: 'student-b', name: '试点学生 B', color: '#b45309', canEdit: true },
  viewer: { id: 'viewer', name: '只读访客', color: '#64748b', canEdit: false },
};
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const fail = (status, message) => Object.assign(new Error(message), { status });
async function body(request) {
  const parts = []; let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > 4096) throw fail(413, 'Request too large');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString() || '{}'); }
  catch { throw fail(400, 'Invalid JSON'); }
}

export function createCollaborationServer({ port = 4310, host = '127.0.0.1', path = './data/documents.sqlite',
  secret = process.env.COLLAB_SECRET, demo = false, apiUrl = '', allowedOrigins = [] } = {}) {
  if (!secret || secret.length < 32) throw new Error('COLLAB_SECRET must contain at least 32 characters');
  if (demo && process.env.NODE_ENV === 'production') throw new Error('Demo authentication is forbidden in production');
  if (!demo && !apiUrl) throw new Error('COLLAB_AUTH_API_URL is required');
  const store = new DocumentStore(path);
  if (demo) store.create('demo-document', '知识空间协作文档试点');
  async function authorize(token, documentName) {
    if (!validId(documentName) || !store.get(documentName)) throw fail(404, 'Document not found');
    if (demo) {
      let claims;
      try { claims = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'hakcc-demo', audience: documentName }); }
      catch { throw fail(401, 'Invalid or expired session'); }
      if (!PEOPLE[claims.sub]) throw fail(403, 'Unknown demo identity');
      return { ...PEOPLE[claims.sub], token, checkedAt: Date.now() };
    }
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/collaborative-documents/${documentName}/access`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw fail(response.status, 'Document permission denied');
    const access = await response.json();
    if (access.documentId !== documentName || !access.user?.id) throw fail(403, 'Invalid access response');
    return { ...access.user, canEdit: access.canEdit === true, token, checkedAt: Date.now() };
  }
  async function recheck(connection, force = false) {
    if (!force && Date.now() - connection.context.checkedAt < 30_000) return;
    try {
      connection.context = await authorize(connection.context.token, connection.document.name);
      connection.readOnly = !connection.context.canEdit;
    } catch {
      connection.close({ code: 4403, reason: 'Permission expired or revoked' });
      throw fail(403, 'Permission expired or revoked');
    }
  }
  const server = new Server({
    port, address: host, quiet: true, debounce: 1000, maxDebounce: 5000,
    websocketOptions: { maxPayload: MAX_BYTES },
    async onUpgrade({ request, socket }) {
      const origin = request.headers.origin;
      if (allowedOrigins.length && (!origin || !allowedOrigins.includes(origin))) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        throw null; // Handled rejection: do not throw out of Node's async upgrade listener.
      }
    },
    async onAuthenticate({ token, documentName, connectionConfig }) {
      const context = await authorize(token, documentName);
      connectionConfig.readOnly = !context.canEdit;
      return context;
    },
    async onTokenSync({ token, documentName, connection, connectionConfig }) {
      const context = await authorize(token, documentName);
      connection.context = context;
      connectionConfig.readOnly = !context.canEdit;
      connection.readOnly = !context.canEdit;
      return context;
    },
    async beforeHandleMessage({ connection, update }) {
      if (update.length > MAX_BYTES) throw fail(413, 'Message too large');
      await recheck(connection);
    },
    async onLoadDocument({ documentName, document }) {
      const row = store.get(documentName);
      if (!row) throw fail(404, 'Document not found');
      Y.applyUpdate(document, row.state);
    },
    async onChange({ documentName, document }) {
      try { document.broadcastStateless(JSON.stringify(store.save(documentName, document))); }
      catch {
        document.broadcastStateless(JSON.stringify({ type: 'save-error', message: '保存失败，待同步修改仍保留在本机；请勿清除浏览器数据' }));
        for (const connection of document.connections.keys()) connection.close({ code: 4500, reason: 'Persistence failed' });
      }
    },
    async onStateless({ documentName, document, connection, payload }) {
      await recheck(connection);
      if (payload === 'saved-state') {
        // Never acknowledge in-memory state that failed to reach disk.
        const row = store.get(documentName);
        connection.sendStateless(JSON.stringify({ type: 'saved', hash: row.hash, version: row.version, updatedAt: row.updated_at }));
      }
    },
    async onRequest({ request, response }) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const send = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/health') send(200, { ok: true, mode: demo ? 'demo' : 'integrated' });
        else if (demo && url.pathname === '/demo/session' && request.method === 'POST') {
          const input = await body(request);
          const user = PEOPLE[input.person];
          if (!user) throw fail(400, 'Unknown demo identity');
          const token = jwt.sign({}, secret, { algorithm: 'HS256', issuer: 'hakcc-demo', audience: 'demo-document', subject: user.id, expiresIn: '1h' });
          send(200, { documentId: 'demo-document', title: store.get('demo-document').title, user, canEdit: user.canEdit, token });
        } else {
          const internal = url.pathname.startsWith('/internal/');
          const match = /^\/(internal|demo)\/documents\/([a-zA-Z0-9_-]{1,80})(?:\/(export|snapshots)(?:\/([1-9][0-9]{0,15}))?)?$/.exec(url.pathname);
          if (!match || (!internal && !demo)) throw fail(404, 'Not found');
          if (internal) {
            if (request.headers.authorization !== `Bearer ${secret}`) throw fail(401, 'Unauthorized');
          } else {
            const context = await authorize((request.headers.authorization ?? '').replace(/^Bearer /, ''), match[2]);
            if (request.method !== 'GET' && !context.canEdit) throw fail(403, 'Read only');
          }
          const [, , id, action, snapshotId] = match;
          if (!action && request.method === 'POST' && internal) {
            const input = await body(request);
            if (typeof input.title !== 'string' || input.title.length > 200) throw fail(400, 'Invalid title');
            store.create(id, input.title); send(201, { id });
          } else {
            const row = store.get(id);
            if (!row) throw fail(404, 'Document not found');
            if(snapshotId) {
              if(action!=='snapshots'||request.method!=='GET')throw fail(405,'Method not allowed');
              const historical=store.readSnapshot(id,Number(snapshotId));
              if(!historical)throw fail(404,'Snapshot not found');
              send(200,snapshotContent(historical));
            } else if (action === 'export' && request.method === 'GET') {
              const buffer = await exportWord(row);
              response.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }); response.end(buffer);
            } else if (action === 'snapshots' && request.method === 'GET') send(200, store.snapshots(id));
            else if (action === 'snapshots' && request.method === 'POST') send(201, { id: store.snapshot(id) });
            else throw fail(405, 'Method not allowed');
          }
        }
      } catch (error) { send(error.status ?? 500, { error: error.status ? error.message : 'Document service failed' }); }
      throw null; // Hocuspocus skips its default HTTP response after a handled request.
    },
  });
  const timer = setInterval(() => {
    for (const document of server.hocuspocus.documents.values()) for (const connection of document.connections.keys()) {
      void recheck(connection, true).catch(() => {});
    }
  }, 30_000);
  timer.unref();
  return { server, store, async close() { clearInterval(timer); await server.destroy(); store.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createCollaborationServer({ port: Number(process.env.PORT ?? 4310), host: process.env.HOST ?? '0.0.0.0',
    path: process.env.COLLAB_DB_PATH ?? './data/documents.sqlite', demo: process.env.COLLAB_DEMO === 'true',
    apiUrl: process.env.COLLAB_AUTH_API_URL ?? '', allowedOrigins: (process.env.COLLAB_ORIGINS ?? '').split(',').filter(Boolean) });
  await app.server.listen();
  console.log(`HAKCC collaboration listening on ${app.server.address.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
}
