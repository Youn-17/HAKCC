import { notePreviewText } from './noteText';

type Row = Record<string, any>;
type HistoryInput = { notes: Row[]; relations: Row[]; revisions: Row[]; feedbacks: Row[]; threads: Row[]; names: Map<string,string>; userId: string };
export type KnowledgeHistoryItem = {
  id:string; kind:'note'|'build_on'|'revision'|'ai_feedback'|'ai_chat'; at:string;
  actorId:string|null; actorName:string|null; noteId:string|null; noteTitle:string|null;
  targetNoteId?:string|null; targetNoteTitle?:string|null; targetActorId?:string|null; targetActorName?:string|null;
  relationType?:string|null; triggerType?:string|null; status?:string|null; aiGenerated?:boolean;
  excerpt?:string; beforeExcerpt?:string; revisionNumber?:number; changeSummary?:string; snapshotComplete?:boolean;
  excerptScope?:'original'|'current'|'revision';
};

/** Public Note history plus only the caller's private AI activity. No raw HTML leaves this module. */
export function buildKnowledgeHistory(input: HistoryInput) {
  const { names, userId }=input;
  const notes=input.notes.filter(n=>!n.deleted_at && !['attachment','drawing','view'].includes(n.type));
  const byId=new Map(notes.map(n=>[n.id,n]));
  const revisionsByNote=new Map<string,Row[]>();
  for(const r of input.revisions) {
    if(!byId.has(r.note_id)) continue;
    const list=revisionsByNote.get(r.note_id)??[]; list.push(r); revisionsByNote.set(r.note_id,list);
  }
  for(const list of revisionsByNote.values()) list.sort((a,b)=>a.revision_number-b.revision_number);
  const name=(id:string)=>names.get(id)??null;
  const excerpt=(content?:string)=>notePreviewText(content).slice(0,600);
  const items:KnowledgeHistoryItem[]=[];
  for(const n of notes) {
    const revisions=revisionsByNote.get(n.id)??[];
    const original=revisions[0]?.revision_number===1 ? revisions[0] : n;
    items.push({id:`note:${n.id}`,kind:'note',at:n.created_at,actorId:n.author_id??null,actorName:name(n.author_id),noteId:n.id,noteTitle:original.title??null,excerpt:excerpt(original.content),excerptScope:original===n?'current':'original',snapshotComplete:!revisions.length||revisions[0].revision_number===1,aiGenerated:Boolean(n.is_ai_generated)});
    revisions.forEach((r,index)=>{
      const next=revisions[index+1];
      const complete=!next || next.revision_number===r.revision_number+1;
      const after=next??n;
      items.push({id:`revision:${r.id}`,kind:'revision',at:r.edited_at,actorId:r.editor_id??null,actorName:name(r.editor_id),noteId:n.id,noteTitle:complete?after.title:n.title,revisionNumber:r.revision_number,changeSummary:r.change_summary??'',snapshotComplete:complete,excerptScope:'revision',beforeExcerpt:excerpt(r.content),...(complete?{excerpt:excerpt(after.content)}:{})});
    });
  }
  const relations=input.relations.filter(r=>byId.has(r.source_note_id)&&byId.has(r.target_note_id));
  for(const r of relations) {
    const src=byId.get(r.source_note_id)!;const dst=byId.get(r.target_note_id)!;
    items.push({id:`rel:${r.id}`,kind:'build_on',at:r.created_at,actorId:r.creator_id??src.author_id??null,actorName:name(r.creator_id??src.author_id),noteId:src.id,noteTitle:src.title,targetNoteId:dst.id,targetNoteTitle:dst.title,targetActorId:dst.author_id??null,targetActorName:name(dst.author_id),relationType:r.relation_type,excerpt:excerpt(src.content),excerptScope:'current',aiGenerated:Boolean(src.is_ai_generated)});
  }
  for(const f of input.feedbacks) {
    const n=byId.get(f.note_id);if(!n||f.user_id!==userId)continue;
    items.push({id:`fb:${f.id}`,kind:'ai_feedback',at:f.created_at,actorId:f.user_id,actorName:name(f.user_id),noteId:n.id,noteTitle:n.title,triggerType:f.trigger_type,status:f.status});
  }
  for(const t of input.threads) {
    const n=byId.get(t.note_id);if(!n||t.created_by!==userId)continue;
    items.push({id:`chat:${t.id}`,kind:'ai_chat',at:t.created_at,actorId:t.created_by,actorName:name(t.created_by),noteId:n.id,noteTitle:n.title});
  }
  items.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  return {items,structure:{
    notes:notes.map(n=>({id:n.id,title:n.title??'',excerpt:excerpt(n.content),authorId:n.author_id??null,authorName:name(n.author_id),type:n.type,createdAt:n.created_at,aiGenerated:Boolean(n.is_ai_generated)})),
    relations:relations.map(r=>({id:r.id,source:r.source_note_id,target:r.target_note_id,relationType:r.relation_type,creatorId:r.creator_id,createdAt:r.created_at,aiSuggested:Boolean(r.ai_suggested)})),
  }};
}

/** Page explicitly: Supabase's response cap must not silently turn a full map into its first page. */
export async function readHistoryRows(query:()=>{range:(from:number,to:number)=>PromiseLike<{data:Row[]|null;error:{message:string}|null}>}, cap=2000) {
  const rows:Row[]=[];
  while(rows.length<=cap) {
    const size=Math.min(500,cap+1-rows.length);
    const {data,error}=await query().range(rows.length,rows.length+size-1);
    if(error) throw new Error(error.message);
    rows.push(...(data??[]));
    if(!data||data.length<size)break;
  }
  return {rows:rows.slice(0,cap),truncated:rows.length>cap};
}

/** Legacy deployments record a revision's insertion time as created_at. Normalize it
 * to edited_at at the query seam, and never substitute a Note's current updated_at. */
export async function readRevisionRows(query:(field:'edited_at'|'created_at')=>ReturnType<Parameters<typeof readHistoryRows>[0]>) {
  try {
    return {...await readHistoryRows(()=>query('edited_at')),timestampField:'edited_at' as const};
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('column note_revisions.edited_at does not exist')) throw error;
    return {...await readHistoryRows(()=>query('created_at')),timestampField:'created_at' as const};
  }
}
