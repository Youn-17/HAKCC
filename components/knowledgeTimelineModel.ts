import type { KnowledgeHistory, TimelineItem } from '../services/apiClient';
import { localDay } from './knowledgeExplorerModel';
export type TimelineView='overall'|'notes'|'people';
export type TimelineFilters={query?:string;groups?:string[];spaces?:string[];people?:string[];excluded?:string[];notes?:string[];from?:string;to?:string;kinds?:string[];includeTeachers?:boolean;includeAi?:boolean;privateAi?:boolean;received?:boolean};
export function filterTimeline(history:KnowledgeHistory, filters:TimelineFilters) {
 const notes=new Map(history.structure?.notes.map(n=>[n.id,n]));
 const excluded=new Set(filters.excluded);const roles=new Map(history.context?.participants.map(p=>[p.id,p.role]));
 const members=new Set(history.context?.groups.filter(g=>filters.groups?.includes(g.id)).flatMap(g=>g.memberIds));
 return history.items.filter(e=>{
  if(!Number.isFinite(Date.parse(e.at)))return false;
  const note=notes.get(e.noteId??''),target=notes.get(e.targetNoteId??'');
  const involved=[e.actorId,e.targetActorId,note?.authorId,target?.authorId].filter(Boolean) as string[];
  if(involved.some(id=>excluded.has(id)))return false;
  if(filters.includeTeachers===false&&involved.some(id=>roles.get(id)==='teacher'))return false;
  if(filters.includeAi===false&&(e.aiGenerated||note?.aiGenerated||target?.aiGenerated))return false;
  if(!filters.privateAi&&['ai_feedback','ai_chat'].includes(e.kind))return false;
  if(filters.kinds?.length&&!filters.kinds.includes(e.kind))return false;
  if(filters.spaces?.length&&!filters.spaces.includes(e.spaceId??''))return false;
  if(filters.groups?.length){if(e.groupId){if(!filters.groups.includes(e.groupId))return false;}else if(!involved.some(id=>members.has(id)))return false;}
  if(filters.people?.length&&!filters.people.includes(e.actorId??'')&&!(filters.received&&e.kind==='build_on'&&filters.people.includes(e.targetActorId??'')))return false;
  if(filters.notes?.length&&!filters.notes.includes(e.noteId??'')&&!filters.notes.includes(e.targetNoteId??''))return false;
  const day=localDay(e.at);if(filters.from&&day<filters.from)return false;if(filters.to&&day>filters.to)return false;
  const query=filters.query?.trim().toLowerCase();
  return !query||`${e.noteTitle??''} ${e.targetNoteTitle??''} ${e.excerpt??''} ${e.actorName??''}`.toLowerCase().includes(query);
 }).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
}
export type TimelineLane={id:string;label:string;code?:string;events:TimelineItem[]};
export function timelineLanes(events:TimelineItem[],history:KnowledgeHistory,view:Exclude<TimelineView,'overall'>,received:boolean,empty=false) {
 const rows=new Map<string,TimelineLane>();
 const notes=new Map(history.structure?.notes.map(n=>[n.id,n]));const people=new Map(history.context?.participants.map(p=>[p.id,p]));
 if(view==='people'&&empty)for(const p of people.values())rows.set(p.id,{id:p.id,label:p.name,code:p.code,events:[]});
 for(const e of events){
  const ids=view==='notes'?[e.noteId,...(e.kind==='build_on'?[e.targetNoteId]:[])]:[e.actorId,...(received&&e.kind==='build_on'?[e.targetActorId]:[])];
  for(const id of new Set(ids.filter(Boolean) as string[])){
   const row=rows.get(id)??{id,label:view==='notes'?(notes.get(id)?.title??e.noteTitle??id):(people.get(id)?.name??e.actorName??id),code:people.get(id)?.code,events:[]};
   row.events.push(e);rows.set(id,row);
  }
 }
 return [...rows.values()].sort((a,b)=>(a.events[0]?.at??'9999').localeCompare(b.events[0]?.at??'9999')||a.label.localeCompare(b.label));
}
export function timelineBuckets(events:TimelineItem[]) {
 if(!events.length)return [];
 const days=events.map(e=>localDay(e.at)).sort();const first=new Date(days[0]+'T12:00:00'),last=new Date(days.at(-1)!+'T12:00:00');
 const span=(last.getTime()-first.getTime())/86400000;
 const grain=span<=90?'day':span<=630?'week':'month';
 if(grain==='month')first.setDate(1);
 const buckets:Array<{key:string;end:string;grain:typeof grain}>=[];
 for(let cursor=new Date(first);cursor<=last;){const start=new Date(cursor),next=new Date(cursor);
  if(grain==='month')next.setMonth(next.getMonth()+1);else next.setDate(next.getDate()+(grain==='week'?7:1));
  const end=new Date(next);end.setDate(end.getDate()-1);
  buckets.push({key:localDay(start.toISOString()),end:localDay(end.toISOString()),grain});cursor=next;
 }
 return buckets;
}
const csvCell=(value:unknown)=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function timelineExport(history:KnowledgeHistory,events:TimelineItem[],filters:TimelineFilters,view:TimelineView) {
 if(!history.context?.canExport)throw new Error('Course staff access required');
 const codes=new Map(history.context.participants.map(p=>[p.id,p.code]));
 const code=(id:string|null|undefined)=>id?(codes.get(id)??'unresolved'):'';
 const headers=['event_id','source_table','source_id','at','kind','actor_code','note_id','note_type','note_author_code','target_note_id','target_actor_code','relation_type','revision_number','space_id','group_id','ai_generated','snapshot_complete'];
 const notes=new Map(history.structure?.notes.map(n=>[n.id,n]));
 const tables={note:'notes',build_on:'relations',revision:'note_revisions',ai_feedback:'note_ai_feedbacks',ai_chat:'note_conversation_threads'};
 const rows=events.map(e=>[e.id,tables[e.kind],e.id.replace(/^[^:]+:/,''),e.at,e.kind,code(e.actorId),e.noteId,notes.get(e.noteId??'')?.type,code(notes.get(e.noteId??'')?.authorId),e.targetNoteId,code(e.targetActorId),e.relationType,e.revisionNumber,e.spaceId,e.groupId,Boolean(e.aiGenerated||notes.get(e.noteId??'')?.aiGenerated),e.snapshotComplete??'']);
 const exportFilters={...filters,people:filters.people?.map(code),excluded:filters.excluded?.map(code)};
 return {csv:'\uFEFF'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),manifest:{schema:'hakcc-timeline-events-v1',generatedAt:history.generatedAt,exportedAt:new Date().toISOString(),courseId:history.context.courseId,scope:history.context.scope,view,filters:exportFilters,eventCount:events.length,coverage:history.coverage??null,membershipBasis:history.context.membershipBasis,visibleSpaceIds:history.context.spaces.map(s=>s.id),groupMembershipSnapshot:history.context.groups.map(g=>({groupId:g.id,memberCodes:g.memberIds.map(code)})),participantRoles:history.context.participants.map(p=>({code:p.code,role:p.role})),identityScheme:'P + SHA256(user UUID + course UUID), first 8 hex characters',contentIncluded:false}};
}
