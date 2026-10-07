import { expect, it, vi } from 'vitest';
const list = vi.hoisted(() => vi.fn());
vi.mock('../services/apiClient', () => ({ notes: { list }, relations: {} }));
import { loadCanvasNotes } from './useSpaceData';
it('loads every page beyond 200 Notes and keeps spaces above the layout limit readable', async () => {
  const rows = Array.from({ length: 2101 }, (_, i) => ({ id: `note-${i}` }));
  list.mockImplementation(async (_id, { limit, offset }) => ({ notes: rows.slice(offset, offset + limit) }));
  const result = await loadCanvasNotes('synthetic-space');
  expect(result.notes).toEqual(rows);
  expect(list.mock.calls.map(c => c[1].offset)).toEqual([0, 500, 1000, 1500, 2000]);
});
