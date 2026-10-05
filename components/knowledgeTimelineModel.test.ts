import { describe, expect, it } from 'vitest';
import { filterTimeline, timelineLanes, timelineBuckets, timelineExport } from './knowledgeTimelineModel';
import type { KnowledgeHistory, TimelineItem } from '../services/apiClient';
const history:KnowledgeHistory={generatedAt:'2026-10-05',context:{courseId:'c',currentSpaceId:'s',scope:'course',canExport:true,membershipBasis:'current',spaces:[],groups:[{id:'g',name:'一组',memberIds:['a']}],participants:[{id:'a',name:'甲',code:'P-a',role:'student'},{id:'b',name:'乙',code:'P-b',role:'student'},{id:'t',name:'师',code:'P-t',role:'teacher'}]},structure:{notes:[{id:'n',title:'解释',authorId:'b',authorName:'乙',excerpt:'',type:'note',createdAt:'2026-09-01',aiGenerated:false}],relations:[]},items:[
 {id:'create',kind:'note',at:'2026-09-01T10:00:00Z',actorId:'b',actorName:'乙',noteId:'n',noteTitle:'解释'},
 {id:'edit',kind:'revision',at:'2026-09-03T10:00:00Z',actorId:'a',actorName:'甲',noteId:'n',noteTitle:'完善解释'},
 {id:'link',kind:'build_on',at:'2026-09-03T11:00:00Z',actorId:'b',actorName:'乙',noteId:'n',noteTitle:'解释',targetNoteId:'x',targetActorId:'a'},
] as TimelineItem[]};
describe('independent construction timeline',()=>{
 it('attributes revisions to the editor, and group filtering includes members’ edits in shared spaces',()=>{
  expect(filterTimeline(history,{groups:['g']}).map(e=>e.id)).toEqual(['edit','link']);
  const rows=timelineLanes(history.items,history,'people',false);
  expect(rows.find(r=>r.id==='a')?.events.map(e=>e.id)).toEqual(['edit']);
 });
 it('excluding a member removes their actions, their Notes and relations to them without mutating history',()=>{
  expect(filterTimeline(history,{excluded:['a']}).map(e=>e.id)).toEqual(['create']);
  expect(filterTimeline(history,{excluded:['b']})).toEqual([]);
  expect(history.items).toHaveLength(3);
 });
 it('retains empty time intervals and includes the last event',()=>{
  const buckets=timelineBuckets(history.items);
  expect(buckets.map(b=>b.key)).toEqual(['2026-09-01','2026-09-02','2026-09-03']);
  expect(buckets.at(-1)?.end).toBe('2026-09-03');
 });
 it('received Build-ons can appear in the recipient track without duplicating the unique event data',()=>{
  const own=timelineLanes(history.items,history,'people',false);
  const received=timelineLanes(history.items,history,'people',true);
  expect(own.find(r=>r.id==='a')?.events).toHaveLength(1);
  expect(received.find(r=>r.id==='a')?.events.map(e=>e.id)).toEqual(['edit','link']);
  expect(history.items).toHaveLength(3);
 });
 it('a long construction period keeps its earliest and latest records at an explicit monthly grain',()=>{
  const buckets=timelineBuckets([{...history.items[0],at:'2018-01-02T10:00:00Z'},history.items.at(-1)!]);
  expect(buckets[0].key).toBe('2018-01-01');
  expect(buckets[0].grain).toBe('month');
  expect(buckets.at(-1)!.end>='2026-09-03').toBe(true);
 });
 it('research output retains exact IDs, time and filters while replacing identities and blocking nonstaff export',()=>{
  const result=timelineExport(history,filterTimeline(history,{excluded:['b']}),{excluded:['b']},'people');
  expect(result.manifest.filters.excluded).toEqual(['P-b']);
  expect(result.manifest.membershipBasis).toBe('current');
  const full=timelineExport(history,history.items,{},'overall');
  expect(full.csv).toContain('source_table');
  expect(full.csv).toContain('note_revisions');
  expect(full.manifest.groupMembershipSnapshot).toEqual([{groupId:'g',memberCodes:['P-a']}]);
  expect(full.csv).toContain('P-a');expect(full.csv).not.toContain('甲');
  expect(()=>timelineExport({...history,context:{...history.context!,canExport:false}},[],{},'overall')).toThrow();
 });
});
