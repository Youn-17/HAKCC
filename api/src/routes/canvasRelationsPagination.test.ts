import 'express-async-errors';
import { it, expect, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
const mock = vi.hoisted(() => ({ offsets: [] as number[], rows: Array.from({ length: 1051 }, (_, i) => ({ id: `r-${i}`, source_note_id: `n-${i+1}`, target_note_id: `n-${i}`, relation_type: 'extend' })) }));
vi.mock('../middleware/auth', () => ({ verifyJWT: (req: any, _res: any, next: () => void) => { req.user = { id: 'synthetic-member' }; next(); } }));
vi.mock('../services/accessControl', () => ({ ensureSpaceAccess: vi.fn(), ensureNoteAccess: vi.fn() }));
vi.mock('../config/supabase', () => ({ supabase: { from: () => { const q: any = {}; for (const name of ['select', 'eq', 'order']) q[name] = () => q; q.range = async (offset: number, end: number) => { mock.offsets.push(offset); return { data: mock.rows.slice(offset, end + 1), error: null }; }; return q; } } }));
import router from './relations';
it('returns all canvas relationships beyond the Supabase default page', async () => {
  const app = express(); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.on('listening', r));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/spaces/synthetic-space/relations`);
    expect(response.status).toBe(200);
    const { relations } = await response.json();
    expect(relations).toHaveLength(1051);
    expect(mock.offsets).toEqual([0, 500, 1000]);
    expect(relations[1050]).toMatchObject({ id: 'r-1050', source_note_id: 'n-1051', target_note_id: 'n-1050' });
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
