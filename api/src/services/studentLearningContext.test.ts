import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./accessControl', () => ({ enterableSpaceIds: vi.fn(async () => ['allowed-space']) }));
const h = vi.hoisted(() => ({ queries: [] as Array<{table: string; filters: Record<string, unknown>}>, rows: {} as Record<string, any[]> }));
vi.mock('../config/supabase', () => ({ supabase: { from: (table: string) => {
  const filters: Record<string, unknown> = {}; h.queries.push({table, filters});
  const q: any = { in: (k: string,v: unknown) => { filters[k] = v; return q; }, select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; }, is: (k: string,v: unknown) => { filters[k] = v; return q; }, order: () => q, limit: () => q,
    then: (resolve: any) => Promise.resolve({ data: h.rows[table] ?? [], error: null }).then(resolve) }; return q;
} } }));
import { loadStudentLearningContext } from './studentLearningContext';
beforeEach(() => { h.queries = []; h.rows = {}; });
describe('student course memory from owned source records', () => {
  it('uses the student’s own Note and questions with source IDs, without treating AI answers as student claims', async () => {
    h.rows.notes = [{ id: 'my-note', title: '蒸发实验', content: '<p>我认为温度会影响蒸发。</p>', updated_at: '2026-10-07' }];
    h.rows.agent_messages = [{ id: 'my-question', content: '我希望先比较两个杯子', created_at: '2026-10-06' }];
    const context = await loadStudentLearningContext({ userId: 'student-a', courseId: 'course-a', question: '蒸发实验怎样比较' });
    expect(context).toContain('my-note'); expect(context).toContain('温度会影响蒸发'); expect(context).toContain('my-question');
    expect(context).toContain('not validated measures of ability');
    expect(h.queries.find(q=>q.table==='notes')?.filters).toMatchObject({ author_id:'student-a', 'spaces.course_id':'course-a', deleted_at:null,space_id:['allowed-space'] });
    expect(h.queries.find(q=>q.table==='agent_messages')?.filters).toMatchObject({ 'agent_conversations.user_id':'student-a', 'agent_conversations.course_id':'course-a',role:'user' });
    expect(h.queries.find(q=>q.table==='note_conversation_messages')?.filters).toMatchObject({ sender_id:'student-a','note_conversation_threads.course_id':'course-a','note_conversation_threads.target_type':'ai',sender_kind:'user', 'note_conversation_threads.space_id':['allowed-space'], 'note_conversation_threads.deleted_at':null });
  });
  it('reloads current source content, so Note corrections are reflected across new conversations', async () => {
    h.rows.notes = [{ id:'my-note', title:'实验', content:'修正：还需要控制风速。',updated_at:'2026-10-07' }];
    const context = await loadStudentLearningContext({ userId:'student-a',courseId:'course-a',question:'继续实验' });
    expect(context).toContain('还需要控制风速');
    expect(context).not.toContain('温度会影响蒸发');
  });
});
