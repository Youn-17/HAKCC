import { describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rows: [] as any[], pages: [] as number[] }));
vi.mock('../config/supabase', () => ({ supabase: { from: () => {
  let offset = 0; let end = 999;
  const q: any = { select:()=>q,eq:()=>q,order:()=>q,range:(a:number,b:number)=>{offset=a;end=b;h.pages.push(a);return q;},then:(done:any)=>Promise.resolve({ data:h.rows.slice(offset,end+1),error:null }).then(done) }; return q;
} } }));
import { loadModelConversationHistory } from './loadConversationHistory';
import { modelContextBudget } from './modelContextBudget';
describe('long history pagination', () => {
  it('reads beyond PostgREST’s 1000-row page and restores chronological order', async () => {
    h.rows = Array.from({length:1205},(_,i)=>({id:`m${1204-i}`,created_at:String(1204-i),role:i%2?'assistant':'user',content:`完整讨论 ${1204-i}`}));h.pages=[];
    const history=await loadModelConversationHistory('workspace','own-thread',modelContextBudget('deepseek','deepseek-flash'));
    expect(h.pages).toEqual([0,1000]);expect(history).toHaveLength(1205);
    expect(history[0].content).toBe('完整讨论 0');expect(history.at(-1)?.content).toBe('完整讨论 1204');
  });
});
