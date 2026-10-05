import type { HistoryNote, HistoryRelation, TimelineItem } from '../services/apiClient';

export const CARD_WIDTH=238;
export const CARD_HEIGHT=120;
export type PlacedIdea=HistoryNote & {x:number;y:number;branchId:string};
const ordered=(a:HistoryNote,b:HistoryNote)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);

/** Stored source builds on target. Progression is drawn target → source, without changing that contract. */
export function traceIdeaPath(id:string,relations:HistoryRelation[]) {
  const found=new Set([id]);
  for(const direction of ['ancestors','descendants'] as const) {
    const adjacency=new Map<string,string[]>();
    for(const r of relations){const from=direction==='ancestors'?r.source:r.target;const to=direction==='ancestors'?r.target:r.source;adjacency.set(from,[...(adjacency.get(from)??[]),to]);}
    const visited=new Set([id]);const queue=[id];
    for(let i=0;i<queue.length;i++)for(const next of adjacency.get(queue[i])??[])if(!visited.has(next)){visited.add(next);found.add(next);queue.push(next);}
  }
  return found;
}

/** Linear graph analysis: strongly connected ideas share a level, so reciprocal relations cannot inflate depth. */
export function layoutKnowledgeMap(input:HistoryNote[],inputRelations:HistoryRelation[],mode:'branches'|'time'='branches') {
  const notes=[...input].sort(ordered);const byId=new Map(notes.map(n=>[n.id,n]));
  const relations=inputRelations.filter(r=>byId.has(r.source)&&byId.has(r.target));
  const children=new Map<string,string[]>(),parents=new Map<string,string[]>();
  for(const n of notes){children.set(n.id,[]);parents.set(n.id,[]);}
  for(const r of relations){children.get(r.target)!.push(r.source);parents.get(r.source)!.push(r.target);}
  const visited=new Set<string>(),finish:string[]=[];
  for(const n of notes) {
    if(visited.has(n.id))continue;
    const stack:Array<[string,boolean]>=[[n.id,false]];
    while(stack.length){const [id,done]=stack.pop()!;if(done){finish.push(id);continue;}if(visited.has(id))continue;visited.add(id);stack.push([id,true]);for(const next of children.get(id)??[])if(!visited.has(next))stack.push([next,false]);}
  }
  const component=new Map<string,number>();let componentCount=0;
  for(const id of finish.reverse()) {
    if(component.has(id))continue;const queue=[id];component.set(id,componentCount);
    for(let i=0;i<queue.length;i++)for(const next of parents.get(queue[i])??[])if(!component.has(next)){component.set(next,componentCount);queue.push(next);}
    componentCount++;
  }
  const outgoing=Array.from({length:componentCount},()=>new Set<number>());
  const indegree=Array(componentCount).fill(0),ranks=Array(componentCount).fill(0);
  for(const r of relations){const a=component.get(r.target)!,b=component.get(r.source)!;if(a!==b&&!outgoing[a].has(b)){outgoing[a].add(b);indegree[b]++;}}
  const ready=indegree.flatMap((d,i)=>d===0?[i]:[]);
  for(let i=0;i<ready.length;i++)for(const next of outgoing[ready[i]]){ranks[next]=Math.max(ranks[next],ranks[ready[i]]+1);if(--indegree[next]===0)ready.push(next);}
  const weakVisited=new Set<string>();const groups:string[][]=[];
  for(const n of notes){if(weakVisited.has(n.id))continue;const group=[n.id];weakVisited.add(n.id);for(let i=0;i<group.length;i++)for(const next of [...children.get(group[i])!,...parents.get(group[i])!])if(!weakVisited.has(next)){weakVisited.add(next);group.push(next);}groups.push(group);}
  groups.sort((a,b)=>b.length-a.length||ordered(byId.get(a[0])!,byId.get(b[0])!));
  const nodes:PlacedIdea[]=[];const placed=new Map<string,PlacedIdea>();
  const branches:Array<{id:string;rootId:string;title:string;nodeIds:string[];y:number;height:number}>=[];
  let baseY=60,width=CARD_WIDTH+120;
  let standalone=0;
  for(const group of groups) {
    const sorted=group.map(id=>byId.get(id)!).sort(ordered);
    const root=sorted.find(n=>!parents.get(n.id)!.length)??sorted[0];
    if(group.length===1&&!parents.get(root.id)!.length&&!children.get(root.id)!.length) {
      const x=60+(standalone%3)*310,y=baseY+Math.floor(standalone/3)*152;
      const p={...root,x,y,branchId:root.id};nodes.push(p);placed.set(root.id,p);
      branches.push({id:root.id,rootId:root.id,title:root.title,nodeIds:group,y:y-30,height:152});
      width=Math.max(width,x+CARD_WIDTH+60);standalone++;continue;
    }
    const branchId=root.id;const columns=new Map<number,HistoryNote[]>();
    const dates=[...new Set(sorted.map(n=>localDay(n.createdAt)))].sort();
    const dateColumns=new Map(dates.map((day,index)=>[day,index]));
    const minRank=Math.min(...group.map(id=>ranks[component.get(id)!]));
    for(const n of sorted){const column=mode==='time'?dateColumns.get(localDay(n.createdAt))!:ranks[component.get(n.id)!]-minRank;columns.set(column,[...(columns.get(column)??[]),n]);}
    let height=0;
    for(const [column,list] of [...columns].sort((a,b)=>a[0]-b[0])) {
      const parentY=(n:HistoryNote)=>{const ys=parents.get(n.id)!.map(id=>placed.get(id)?.y).filter((y):y is number=>y!==undefined);return ys.length?ys.reduce((a,b)=>a+b,0)/ys.length:baseY;};
      list.sort((a,b)=>parentY(a)-parentY(b)||ordered(a,b));
      list.forEach((n,index)=>{const p={...n,x:60+column*310,y:baseY+index*152,branchId};nodes.push(p);placed.set(n.id,p);height=Math.max(height,(index+1)*152);width=Math.max(width,p.x+CARD_WIDTH+60);});
    }
    branches.push({id:branchId,rootId:root.id,title:root.title,nodeIds:group,y:baseY-30,height});baseY+=height+94;
  }
  return {nodes,branches,width,height:Math.max(260,baseY+Math.ceil(standalone/3)*152-34)};
}

export function localDay(iso:string){const d=new Date(iso);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function involvesMe(item:Pick<TimelineItem,'actorId'|'targetActorId'>,me:string){return item.actorId===me||item.targetActorId===me;}
export function dailyActivity(items:TimelineItem[],me?:string) {
  const counts=new Map<string,{total:number;mine:number}>();
  for(const it of items){if(!Number.isFinite(Date.parse(it.at)))continue;const key=localDay(it.at);const c=counts.get(key)??{total:0,mine:0};c.total++;if(me&&involvesMe(it,me))c.mine++;counts.set(key,c);}
  const keys=[...counts.keys()].sort();if(!keys.length)return [];
  const start=new Date(keys[0]+'T12:00:00'),end=new Date(keys.at(-1)!+'T12:00:00');
  // Keep real gaps, with a bounded calendar window for long-running communities.
  if((end.getTime()-start.getTime())/86400000>365)start.setTime(end.getTime()-365*86400000);
  const result:Array<{key:string;total:number;mine:number}>=[];
  for(const cursor=new Date(start);cursor<=end;cursor.setDate(cursor.getDate()+1)){const key=localDay(cursor.toISOString());result.push({key,...(counts.get(key)??{total:0,mine:0})});}
  return result;
}
