import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('.scratch/collab-pilot'); mkdirSync(dir, { recursive: true });
const baseUrl = process.env.COLLAB_DEMO_URL || 'http://localhost:3110';
const browser = await chromium.launch({ headless: true });
const errors = [];
const make = async person => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  let offline = false;
  const sockets = [];
  if (person === 'student-b') await context.routeWebSocket('**/collab', route => {
    if (offline) { void route.close({ code: 1001, reason: 'Test offline' }); return; }
    sockets.push({ client: route, server: route.connectToServer() });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const url = new URL(baseUrl); url.searchParams.set('person', person);
  await page.goto(url.href);
  await page.getByTestId('collab-editor').waitFor();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  return { context, page, editor: page.getByTestId('collab-editor'), setConnectionOffline: async value => {
    offline = value;
    if (value) for (const socket of sockets.splice(0)) await Promise.all([socket.client.close({ code: 1001 }), socket.server.close({ code: 1001 })]);
  } };
};
try {
  const a = await make('student-a'); const b = await make('student-b');
  const stamp = Date.now().toString();
  const first = `学生 A 的观点 ${stamp}`; const second = `学生 B 补充证据 ${stamp}`;
  await a.editor.click(); await a.page.keyboard.press('ControlOrMeta+End'); await a.page.keyboard.press('Enter'); await a.page.keyboard.insertText(first);
  await b.editor.getByText(first).waitFor();
  await b.editor.click(); await b.page.keyboard.press('ControlOrMeta+End'); await b.page.keyboard.press('Enter'); await b.page.keyboard.insertText(second);
  await a.editor.getByText(second).waitFor();
  await a.page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  const viewer = await make('viewer');
  assert.equal(await viewer.editor.getAttribute('contenteditable'), 'false');
  assert.equal(await viewer.page.getByRole('button', { name: '加粗', exact: true }).isDisabled(), true);
  // Chromium's HTTP offline switch can leave an existing WebSocket open: sever that actual link.
  await b.setConnectionOffline(true);
  await b.page.getByRole('status').filter({ hasText: '离线' }).waitFor({ timeout: 10000 });
  const offline = `离线修改 ${stamp}`;
  await b.editor.click(); await b.page.keyboard.press('ControlOrMeta+End'); await b.page.keyboard.press('Enter'); await b.page.keyboard.insertText(offline);
  assert.equal((await a.editor.innerText()).includes(offline), false);
  await b.setConnectionOffline(false);
  await a.editor.getByText(offline).waitFor({ timeout: 20000 });
  await a.page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await a.page.getByRole('button', { name: '保存版本', exact: true }).click();
  const downloaded = a.page.waitForEvent('download');
  await a.page.getByRole('button', { name: '导出 Word', exact: true }).click();
  await (await downloaded).saveAs(resolve(dir, 'coedited.docx'));
  await a.page.screenshot({ path: resolve(dir, 'two-student-editing.png'), fullPage: true });
  await viewer.page.screenshot({ path: resolve(dir, 'readonly.png'), fullPage: true });
  await a.page.reload();
  await a.page.getByTestId('collab-editor').getByText(offline).waitFor();
  assert.deepEqual(errors, []);
  writeFileSync(resolve(dir, 'browser-check.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
    coediting: true, readonly: true, offlineMerge: true, reload: true, export: true, snapshots: true, errors }, null, 2));
  console.log('PASS: two independent students, read-only, offline merge, reload, snapshot and Word export');
} finally { await browser.close(); }
