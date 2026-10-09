import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { createCollaborationServer } from '../src/server.mjs';
import { stateHash } from '../src/store.mjs';
import { exportWord } from '../src/export.mjs';

const secret = 'local-test-only-secret-never-used-in-production';
test('saved confirmation matches clients retaining deleted content for undo', () => {
  const client = new Y.Doc(); const server = new Y.Doc();
  client.on('update', update => Y.applyUpdate(server, update));
  const text = client.getText('format-test'); const undo = new Y.UndoManager(text);
  text.insert(0, '正文改为标题再恢复'); text.delete(0, 3);
  assert.equal(client.getText('format-test').toString(), server.getText('format-test').toString());
  assert.equal(stateHash(Y.encodeStateAsUpdate(client)), stateHash(Y.encodeStateAsUpdate(server)));
  undo.destroy(); client.destroy(); server.destroy();
});
async function until(predicate) {
  const end = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function personToken(person, audience = 'demo-document', expiresIn = '1h') {
  return jwt.sign({}, secret, { algorithm: 'HS256', issuer: 'hakcc-demo', subject: person, audience, expiresIn });
}
test('coediting, durable save, offline merge, read-only, authorization and restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hakcc-collab-test-'));
  const clients = [];
  let app = createCollaborationServer({ port: 0, path: join(dir, 'documents.sqlite'), secret, demo: true });
  const connect = async (person, options = {}) => {
    const doc = new Y.Doc();
    let authError = false;
    const provider = new HocuspocusProvider({ url: app.server.webSocketURL, name: 'demo-document', document: doc,
      token: options.token ?? personToken(person), WebSocketPolyfill: WebSocket,
      onAuthenticationFailed: () => { authError = true; } });
    clients.push({ doc, provider });
    await until(() => provider.isSynced || authError);
    return { doc, provider, authError };
  };
  try {
    await app.server.listen();
    const a = await connect('student-a'); const b = await connect('student-b');
    a.doc.getText('test').insert(0, '学生 A 的观点');
    b.doc.getText('test').insert(0, '学生 B 的证据');
    await until(() => a.doc.getText('test').toString() === b.doc.getText('test').toString() && a.doc.getText('test').length > 10);
    await until(() => app.store.get('demo-document').hash === stateHash(Y.encodeStateAsUpdate(a.doc)));
    // A deletion must change the saved-state hash even without advancing the insertion clock.
    const oldHash = app.store.get('demo-document').hash;
    a.doc.getText('test').delete(0, 1);
    await until(() => app.store.get('demo-document').hash !== oldHash);
    await until(() => b.doc.getText('test').toString() === a.doc.getText('test').toString());
    b.provider.disconnect();
    await until(() => b.provider.configuration.websocketProvider.status === 'disconnected');
    b.doc.getText('test').insert(0, '离线补充');
    a.doc.getText('test').insert(0, '在线修改');
    await b.provider.connect();
    await until(() => a.doc.getText('test').toString() === b.doc.getText('test').toString() && a.doc.getText('test').toString().includes('离线补充'));
    const viewer = await connect('viewer');
    assert.equal(viewer.provider.authorizedScope, 'readonly');
    viewer.doc.getText('test').insert(0, '不得保存');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(a.doc.getText('test').toString().includes('不得保存'), false);
    const invalid = await connect('student-a', { token: personToken('student-a', 'other-document') });
    assert.equal(invalid.authError, true);
    const expired = await connect('student-a', { token: personToken('student-a', 'demo-document', -1) });
    assert.equal(expired.authError, true);
    const anonymous = await fetch(`${app.server.httpURL}/internal/documents/demo-document/export`);
    assert.equal(anonymous.status, 401);
    // Export the same rich-text fragment used by Tiptap.
    const paragraph = new Y.XmlElement('paragraph'); const text = new Y.XmlText();
    text.insert(0, '协作文档 Word 导出测试'); paragraph.insert(0, [text]);
    a.doc.getXmlFragment('default').insert(0, [paragraph]);
    await until(() => app.store.get('demo-document').hash === stateHash(Y.encodeStateAsUpdate(a.doc)));
    const buffer = await exportWord(app.store.get('demo-document'));
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    const before = a.doc.getText('test').toString();
    for (const client of clients) { client.provider.destroy(); client.doc.destroy(); }
    clients.length = 0;
    await app.close();
    app = createCollaborationServer({ port: 0, path: join(dir, 'documents.sqlite'), secret, demo: true });
    await app.server.listen();
    const restored = await connect('student-a');
    assert.equal(restored.doc.getText('test').toString(), before);
    assert.equal(restored.doc.getXmlFragment('default').toString().includes('Word 导出测试'), true);
    assert.ok(app.store.snapshots('demo-document').length > 0);
  } finally {
    for (const client of clients) { client.provider.destroy(); client.doc.destroy(); }
    await app.close(); rmSync(dir, { recursive: true, force: true });
  }
});
test('demo identity cannot be enabled in production', () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.throws(() => createCollaborationServer({ secret, demo: true }), /forbidden/); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test('disk failure never acknowledges unsaved edits and restart recovers only durable state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hakcc-collab-disk-test-'));
  const app = createCollaborationServer({ port: 0, path: join(dir, 'documents.sqlite'), secret, demo: true });
  const doc = new Y.Doc(); let provider; let error = false;
  try {
    await app.server.listen();
    provider = new HocuspocusProvider({ url: app.server.webSocketURL, name: 'demo-document', document: doc,
      token: personToken('student-a'), WebSocketPolyfill: WebSocket,
      onStateless: ({ payload }) => { if (JSON.parse(payload).type === 'save-error') error = true; } });
    await until(() => provider.isSynced);
    doc.getText('test').insert(0, '已经保存');
    await until(() => app.store.get('demo-document').hash === stateHash(Y.encodeStateAsUpdate(doc)));
    const previous = app.store.get('demo-document');
    app.store.save = () => { throw new Error('Simulated disk full'); };
    doc.getText('test').insert(0, '不能显示已保存');
    await until(() => error);
    assert.equal(app.store.get('demo-document').hash, previous.hash);
    const durable = new Y.Doc(); Y.applyUpdate(durable, app.store.get('demo-document').state);
    assert.equal(durable.getText('test').toString(), '已经保存'); durable.destroy();
  } finally { provider?.destroy(); doc.destroy(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('rejecting a foreign browser origin leaves the service healthy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hakcc-collab-origin-test-'));
  const app = createCollaborationServer({ port: 0, path: join(dir, 'documents.sqlite'), secret, demo: true,
    allowedOrigins: ['http://localhost:3110'] });
  let socket;
  try {
    await app.server.listen();
    const status = await new Promise((resolve, reject) => {
      socket = new WebSocket(app.server.webSocketURL, { origin: 'https://foreign.example' });
      socket.on('error', () => {});
      socket.on('open', () => reject(new Error('Foreign origin was accepted')));
      socket.on('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode); });
    });
    assert.equal(status, 403); socket.terminate();
    assert.equal((await fetch(`${app.server.httpURL}/health`)).status, 200);
  } finally { socket?.terminate(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
