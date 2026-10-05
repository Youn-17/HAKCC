import { describe, expect, it } from 'vitest';
import { buildKnowledgeHistory, readHistoryRows, readRevisionRows } from './knowledgeHistory';

const a = { id: 'a', title: '现在的标题', content: '<p>第三版解释</p>', author_id: 'u1', type: 'note', created_at: '2026-09-01T10:00:00Z' };
const b = { id: 'b', title: '补充证据', content: '<p>一个具体例子</p>', author_id: 'u2', type: 'note', created_at: '2026-09-02T10:00:00Z' };
const input = () => ({ notes: [a,b], relations: [{ id:'r', source_note_id:'b', target_note_id:'a', relation_type:'evidence', creator_id:'u2', created_at:b.created_at }], revisions: [
  { id:'v1', note_id:'a', revision_number:1, title:'最初的标题', content:'<p>最初解释</p>', editor_id:'u1', edited_at:'2026-09-03T10:00:00Z' },
  { id:'v2', note_id:'a', revision_number:2, title:'第二版标题', content:'<p>第二版解释</p>', editor_id:'u1', edited_at:'2026-09-04T10:00:00Z' },
], feedbacks: [], threads: [], names: new Map([['u1','甲'],['u2','乙']]), userId:'u1' });
describe('knowledge history from business records', () => {
  it('reconstructs creation and each actual revision instead of substituting today’s content', () => {
    const result=buildKnowledgeHistory(input());
    expect(result.items.find(x=>x.id==='note:a')).toMatchObject({noteTitle:'最初的标题',excerpt:'最初解释'});
    expect(result.items.find(x=>x.id==='revision:v1')).toMatchObject({kind:'revision',beforeExcerpt:'最初解释',excerpt:'第二版解释',noteTitle:'第二版标题',revisionNumber:1});
    expect(result.items.find(x=>x.id==='revision:v2')).toMatchObject({excerpt:'第三版解释',noteTitle:'现在的标题'});
    expect(result.structure.relations[0]).toMatchObject({source:'b',target:'a',relationType:'evidence'});
  });
  it('keeps only own private AI activity and excludes records linked to removed notes', () => {
    const data=input();
    Object.assign(data,{ feedbacks:[{id:'own',note_id:'a',user_id:'u1',created_at:a.created_at},{id:'peer',note_id:'a',user_id:'u2',created_at:a.created_at},{id:'gone',note_id:'deleted',user_id:'u1',created_at:a.created_at}],threads:[{id:'t1',note_id:'a',created_by:'u1',created_at:a.created_at},{id:'t2',note_id:'a',created_by:'u2',created_at:a.created_at}] });
    const result=buildKnowledgeHistory(data);
    expect(result.items.filter(x=>x.kind==='ai_feedback').map(x=>x.id)).toEqual(['fb:own']);
    expect(result.items.filter(x=>x.kind==='ai_chat').map(x=>x.id)).toEqual(['chat:t1']);
  });
  it('a missing intermediate revision never fabricates a before/after comparison', () => {
    const data=input(); data.revisions[1].revision_number=3;
    expect(buildKnowledgeHistory(data).items.find(x=>x.id==='revision:v1')?.snapshotComplete).toBe(false);
  });
});
it('pages through response caps and reports an explicit history boundary', async () => {
  const rows=Array.from({length:1200},(_,id)=>({id}));
  const ranges:Array<[number,number]>=[];
  const query=()=>({range:async (from:number,to:number)=>{ranges.push([from,to]);return {data:rows.slice(from,to+1),error:null};}});
  expect((await readHistoryRows(query)).rows).toHaveLength(1200);
  expect(ranges).toEqual([[0,499],[500,999],[1000,1499]]);
  expect(await readHistoryRows(query,750)).toMatchObject({truncated:true});
});

it('reads the recorded revision time from the deployed legacy created_at column when edited_at is absent', async () => {
  const requested: string[] = [];
  const at = '2026-09-03T10:00:00Z';
  const result = await readRevisionRows(field => ({ range: async () => {
    requested.push(field);
    return field === 'edited_at'
      ? { data: null, error: { message: 'column note_revisions.edited_at does not exist' } }
      : { data: [{ id: 'revision-1', edited_at: at }], error: null };
  } }));
  expect(requested).toEqual(['edited_at', 'created_at']);
  expect(result.timestampField).toBe('created_at');
  expect(result.rows[0].edited_at).toBe(at);
});

it('does not disguise other revision database errors as a timestamp compatibility issue', async () => {
  const requested: string[] = [];
  await expect(readRevisionRows(field => ({ range: async () => {
    requested.push(field);
    return { data: null, error: { message: 'permission denied for table note_revisions' } };
  } }))).rejects.toThrow('permission denied');
  expect(requested).toEqual(['edited_at']);
});
