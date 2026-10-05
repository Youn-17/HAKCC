import { describe, it, expect } from 'vitest';
import { layoutKnowledgeMap, traceIdeaPath, dailyActivity } from './knowledgeExplorerModel';
import type { HistoryNote, HistoryRelation, TimelineItem } from '../services/apiClient';
const note=(id:string,day=1):HistoryNote=>({id,title:id,authorId:id,authorName:id,excerpt:'',type:'note',createdAt:`2026-09-${String(day).padStart(2,'0')}T10:00:00Z`,aiGenerated:false});
const edge=(source:string,target:string):HistoryRelation=>({id:source+target,source,target,relationType:'extend',createdAt:'2026-09-02T00:00:00Z'});
describe('idea progression map',()=>{
  it('places the source idea before its Build-ons, with branches and a merge',()=>{
    const graph=layoutKnowledgeMap(['a','b','c','d'].map(x=>note(x)),[edge('b','a'),edge('c','a'),edge('d','b'),edge('d','c')]);
    const byId=new Map(graph.nodes.map(n=>[n.id,n]));
    expect(byId.get('a')!.x).toBeLessThan(byId.get('b')!.x);
    expect(byId.get('b')!.x).toEqual(byId.get('c')!.x);
    expect(byId.get('d')!.x).toBeGreaterThan(byId.get('c')!.x);
    expect(byId.get('b')!.y).not.toEqual(byId.get('c')!.y);
    expect(layoutKnowledgeMap(['a','b','c','d'].map(x=>note(x)),[edge('b','a'),edge('c','a'),edge('d','b'),edge('d','c')])).toEqual(graph);
  });
  it('handles reciprocal relations without infinite depth or dropping nodes',()=>{
    const graph=layoutKnowledgeMap([note('a'),note('b')],[edge('b','a'),edge('a','b')]);
    expect(graph.nodes).toHaveLength(2); expect(Number.isFinite(graph.width)).toBe(true);
  });
  it('focuses on ancestors and descendants, without including unrelated sibling branches',()=>{
    expect([...traceIdeaPath('b',[edge('b','a'),edge('c','a'),edge('d','b')])].sort()).toEqual(['a','b','d']);
  });
  it('retains empty calendar days so gaps in activity remain visible',()=>{
    const items=[{id:'a',kind:'note',at:'2026-09-01T10:00:00Z',actorId:'me'},{id:'b',kind:'build_on',at:'2026-09-04T10:00:00Z',actorId:'peer',targetActorId:'me'}] as TimelineItem[];
    expect(dailyActivity(items,'me').map(d=>[d.key,d.total,d.mine])).toEqual([['2026-09-01',1,1],['2026-09-02',0,0],['2026-09-03',0,0],['2026-09-04',1,1]]);
  });
});
