import React,{useState} from 'react';
import type {SpaceDiscussion} from '../../services/apiClient';
const TYPES:Record<string,[string,string]>={extend:['延伸','Extend'],question:['提问','Question'],challenge:['质疑','Challenge'],evidence:['补充证据','Evidence'],clarify:['澄清','Clarify'],synthesize:['综合','Synthesize'],riseabove:['升华','Rise-above']};
/** Group related Notes without inventing semantic progression. Each cycle is visited once. */
export function discussionThreads(data:SpaceDiscussion) {
  const noteIds=new Set(data.notes.map(n=>n.id));
  const adjacent=new Map<string,Set<string>>();
  for(const e of data.edges){if(!noteIds.has(e.from)||!noteIds.has(e.to))continue;for(const [a,b] of [[e.from,e.to],[e.to,e.from]]){if(!adjacent.has(a))adjacent.set(a,new Set());adjacent.get(a)!.add(b);}}
  const visited=new Set<string>(),threads:SpaceDiscussion['notes'][]=[];
  for(const note of data.notes){
    if(visited.has(note.id)||!adjacent.has(note.id))continue;
    const ids=new Set([note.id]),queue=[note.id];visited.add(note.id);
    for(let i=0;i<queue.length;i++)for(const id of adjacent.get(queue[i])??[])if(!visited.has(id)){visited.add(id);ids.add(id);queue.push(id);}
    threads.push(data.notes.filter(n=>ids.has(n.id)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)));
  }
  return threads;
}
export function DiscussionThreads({data,lang,titleOf,nameOf,anonymous,onPick}:{data:SpaceDiscussion;lang:'zh'|'en';titleOf:(id:string)=>string;nameOf:(id:string)=>string;anonymous:boolean;onPick:(ids:string[],label:string)=>void}) {
  const zh=lang==='zh',threads=discussionThreads(data);const [active,setActive]=useState<string|null>(null),[limit,setLimit]=useState(30);
  const thread=threads.find(t=>t.some(n=>n.id===active))??threads[0];
  if(!thread)return <p className="da-empty">{zh?'这个范围还没有接续讨论。单独的待回应笔记可在“待推进议题”查看。':'No connected discussions in this range. See Open discussions for unanswered standalone notes.'}</p>;
  const ids=new Set(thread.map(n=>n.id)),edges=data.edges.filter(e=>ids.has(e.from)&&ids.has(e.to));
  const unanswered=new Set(data.pending.filter(p=>p.reason==='unanswered').map(p=>p.noteId));
  const questions=thread.filter(n=>edges.some(e=>e.to===n.id&&['question','challenge'].includes(e.type))&&unanswered.has(n.id));
  return <div className="da-threads">
    <label className="da-thread-choice">{zh?'选择讨论':'Choose discussion'}<select aria-label={zh?'选择讨论':'Choose discussion'} value={thread[0].id} onChange={e=>{setActive(e.target.value);setLimit(30);onPick([],zh?'选择一条回应查看原文':'Select a response to read its source');}}>{threads.map(t=><option key={t[0].id} value={t[0].id}>{titleOf(t[0].id)} · {t.length} {zh?'篇笔记':'notes'}</option>)}</select></label>
    <div className="da-thread-overview"><strong>{new Set(thread.map(n=>n.authorId)).size} {zh?'位学生':'students'} · {thread.length} {zh?'篇笔记':'notes'}</strong><span>{questions.length} {zh?'条提问 / 质疑尚未见他人后续':'questions / challenges without a peer follow-up'}</span></div>
    <ol className="da-thread-timeline">{thread.slice(0,limit).map((n,i)=>{
      const parents=edges.filter(e=>e.to===n.id);return <li key={n.id} className={n.selected?'da-thread-own':''}>
        <span className="da-thread-number">{i+1}</span><div className="da-thread-card"><div className="da-thread-meta">{nameOf(n.authorId)} · {new Date(n.createdAt).toLocaleString(zh?'zh-CN':'en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}{n.selected&&<span>{zh?'本人':'Selected student'}</span>}</div>
          <h3>{titleOf(n.id)}</h3>{parents.map((e,j)=><p className="da-thread-parent" key={j}><span>{TYPES[e.type]?.[zh?0:1]??(zh?'回应':'Response')}</span> {zh?'回应':'Responds to'} “{titleOf(e.from)}”</p>)}
          {!parents.length&&<p className="da-thread-parent">{zh?'此范围内的讨论起点':'Starting Note in this range'}</p>}
          {!anonymous&&<p className="da-thread-excerpt">{n.excerpt|| (zh?'这条笔记没有可分析的学生正文。':'No student-authored text to analyze.')}</p>}
          <div className="da-thread-bottom">{questions.some(q=>q.id===n.id)&&<span>{zh?'提问待接续':'Question to follow up'}</span>}<button type="button" onClick={()=>onPick([n.id],titleOf(n.id))}>{zh?'查看来源':'Read source'}</button></div>
        </div>
      </li>;
    })}</ol>
    {thread.length>limit&&<button type="button" className="da-more" onClick={()=>setLimit(n=>n+30)}>{zh?'继续阅读':'Read more'}</button>}
    <p className="da-chart-caption">{zh?'按笔记创建时间排列，正文为当前版本。标签来自已采用的关系，需读原文确认；数量不表示观点质量。':'Ordered by Note creation time, with current text. Labels use adopted relations; inspect the sources. Counts do not measure idea quality.'}</p>
  </div>;
}
