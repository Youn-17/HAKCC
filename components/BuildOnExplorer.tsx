import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Note, Edge } from '../types';
import { notes as notesApi, type KnowledgeHistory, type HistoryNote, type HistoryRelation } from '../services/apiClient';
import { notePreviewText } from './noteText';
import { layoutKnowledgeMap, localDay, traceIdeaPath } from './knowledgeExplorerModel';
import { BUILD_ON_MOVES, RELATION_COLORS, RELATION_LABELS } from './relationColors';
import KnowledgeMapCanvas from './KnowledgeMapCanvas';
import RemixIcon from './RemixIcon';

type Props={spaceId?:string;notes?:Note[];edges?:Edge[];currentUserId?:string;lang:'zh'|'en';initialNoteId?:string|null;onShowTimeline?:(id:string)=>void;onLocateNote?:(id:string)=>void;onClose:()=>void};
export default function BuildOnExplorer({spaceId,notes=[],edges=[],currentUserId,lang,initialNoteId,onShowTimeline,onLocateNote,onClose}:Props) {
  const zh=lang==='zh';
  const [history,setHistory]=useState<KnowledgeHistory|null>(null),[loading,setLoading]=useState(Boolean(spaceId)),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [query,setQuery]=useState(''),[author,setAuthor]=useState('all'),[branch,setBranch]=useState('all'),[layout,setLayout]=useState<'branches'|'time'>('branches');
  const [selectedId,setSelectedId]=useState<string|null>(initialNoteId??null),[pathId,setPathId]=useState<string|null>(null);
  const [relationTypes,setRelationTypes]=useState(new Set(BUILD_ON_MOVES.map(m=>m.type as string)));
  const [from,setFrom]=useState(''),[to,setTo]=useState('');
  const dialog=useRef<HTMLDivElement>(null);
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.querySelector<HTMLButtonElement>('[data-explorer-close]')?.focus();
    const keys=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();close.current();}
      if(event.key!=='Tab')return;
      const targets=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,summary,[tabindex="0"]')??[])].filter(el=>el.getClientRects().length>0);
      const first=targets[0],last=targets.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keys);
    return()=>{document.removeEventListener('keydown',keys);if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{
    if(!spaceId)return;let cancelled=false;setLoading(true);setError('');
    notesApi.timeline(spaceId).then(data=>{if(!cancelled)setHistory(data);}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Could not load history');}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[spaceId,reload]);
  const fallback=useMemo<{notes:HistoryNote[];relations:HistoryRelation[]}>(()=>({notes:notes.filter(n=>!['attachment','drawing','view'].includes(n.type)).map(n=>({id:n.id,title:n.title,excerpt:notePreviewText(n.content).slice(0,600),authorId:n.authorId??null,authorName:n.author,type:n.type,createdAt:n.createdAt??new Date(0).toISOString(),aiGenerated:Boolean(n.isAiGenerated)})),relations:edges.map(e=>({...e}))}),[notes,edges]);
  const structure:{notes:HistoryNote[];relations:HistoryRelation[]}=history?.structure??fallback;
  const byId=useMemo(()=>new Map<string,HistoryNote>(structure.notes.map(n=>[n.id,n] as const)),[structure]);
  const fullGraph=useMemo(()=>layoutKnowledgeMap(structure.notes,structure.relations),[structure]);
  const authors=useMemo(()=>[...new Map(structure.notes.filter(n=>n.authorId&&!n.aiGenerated).map(n=>[n.authorId!,n.authorName|| (zh?'同学':'Peer')])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[structure,zh]);
  const branchIds=branch==='all'?null:new Set(fullGraph.branches.find(b=>b.id===branch)?.nodeIds??[]);
  const pathIds=useMemo(()=>pathId?traceIdeaPath(pathId,structure.relations):null,[pathId,structure]);
  const matching=useMemo(()=>new Set(structure.notes.filter(n=>{
    if(branchIds&&!branchIds.has(n.id))return false;if(pathIds&&!pathIds.has(n.id))return false;
    if(from&&localDay(n.createdAt)<from)return false;if(to&&localDay(n.createdAt)>to)return false;
    if(author!=='all'&&(n.authorId!==author||n.aiGenerated))return false;
    return !query||`${n.title} ${n.excerpt} ${n.authorName}`.toLowerCase().includes(query.toLowerCase());
  }).map(n=>n.id)),[structure,branch,pathIds,from,to,author,query]);
  const scopeIds=useMemo(()=>{
    if(!query&&author==='all')return matching;
    // Search/author focus preserves the surrounding idea path, rather than severing its context.
    const ids=new Set(matching);for(const id of matching)for(const related of traceIdeaPath(id,structure.relations))if((!branchIds||branchIds.has(related))&&(!pathIds||pathIds.has(related)))ids.add(related);
    return ids;
  },[matching,query,author,structure,branch,pathIds]);
  const mapRelations=useMemo(()=>structure.relations.filter(r=>scopeIds.has(r.source)&&scopeIds.has(r.target)&&relationTypes.has(r.relationType??'extend')),[structure,scopeIds,relationTypes]);
  const graph=useMemo(()=>layoutKnowledgeMap(structure.notes.filter(n=>scopeIds.has(n.id)),mapRelations,layout),[structure,scopeIds,mapRelations,layout]);
  const selected=selectedId?byId.get(selectedId):null;
  const select=(id:string)=>{setSelectedId(id);if(pathId)setPathId(id);};
  const date=(at:string,withYear=false)=>new Date(at).toLocaleDateString(zh?'zh-CN':'en-GB',{year:withYear?'numeric':undefined,month:'short',day:'numeric'});
  const parents=selected?structure.relations.filter(r=>r.source===selected.id):[],children=selected?structure.relations.filter(r=>r.target===selected.id):[];
  const reset=()=>{setQuery('');setAuthor('all');setBranch('all');setPathId(null);setFrom('');setTo('');setRelationTypes(new Set(BUILD_ON_MOVES.map(m=>m.type)));};
  const relationList=(list:HistoryRelation[],direction:'before'|'after')=>list.map(r=>{
    const note=byId.get(direction==='before'?r.target:r.source);if(!note)return null;
    return <button type="button" key={r.id} className="knowledge-related-card" onClick={()=>select(note.id)}><span style={{color:RELATION_COLORS[r.relationType??'extend']}}>{RELATION_LABELS[lang][r.relationType??'extend']??r.relationType}</span><strong>{note.title}</strong><small>{note.aiGenerated?'AI partner':note.authorName}</small></button>;
  });
  return <div className="workspace-view-shell knowledge-explorer-shell" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={zh?'Build-on 网络':'Build-on network'} className="knowledge-explorer">
      <header className="knowledge-header">
        <div className="knowledge-heading"><span className="knowledge-heading-icon"><RemixIcon name="git-branch-line" size={23}/></span><div><div className="knowledge-eyebrow">{zh?'共同推进观点':'IDEAS IN PROGRESS'}</div><h2>{zh?'Build-on 网络':'Build-on network'}</h2></div></div>
        <button data-explorer-close className="knowledge-close" onClick={onClose} aria-label={zh?'关闭':'Close'}><RemixIcon name="close-line" size={21}/></button>
      </header>
      <div className="knowledge-subheader"><p>{zh?'从一条观点出发，看见它的依据、分支与汇合。':'Follow an idea through its foundations, branches and convergences.'}</p><div className="knowledge-summary"><span><b>{structure.notes.length}</b>{zh?'观点':'ideas'}</span><span><b>{structure.relations.length}</b>{zh?'关联':'relations'}</span><span><b>{(history?.items??[]).filter(i=>i.kind==='revision').length}</b>{zh?'修订':'revisions'}</span></div></div>
      <div className="knowledge-filterbar">
        <label className="knowledge-search"><RemixIcon name="search-line" size={16}/><input aria-label={zh?'搜索观点':'Search ideas'} value={query} onChange={e=>setQuery(e.target.value)} placeholder={zh?'搜索观点、内容或作者':'Search ideas, content or authors'}/>{query&&<button aria-label={zh?'清空搜索':'Clear search'} onClick={()=>setQuery('')}><RemixIcon name="close-line" size={14}/></button>}</label>
        <select aria-label={zh?'作者范围':'Author scope'} value={author} onChange={e=>setAuthor(e.target.value)}><option value="all">{zh?'全部作者':'All authors'}</option>{authors.map(([id,name])=><option key={id} value={id}>{id===currentUserId?(zh?'与我有关':'Involving me'):name}</option>)}</select>
        <select aria-label={zh?'观点脉络':'Idea branch'} value={branch} onChange={e=>{setBranch(e.target.value);setPathId(null);}}><option value="all">{zh?'全部脉络':'All branches'}</option>{fullGraph.branches.filter(b=>b.nodeIds.length>1).map(b=><option key={b.id} value={b.id}>{b.title.slice(0,20)} · {b.nodeIds.length}</option>)}</select>
        <label className="knowledge-date"><input type="date" aria-label={zh?'开始日期':'Start date'} value={from} onChange={e=>setFrom(e.target.value)}/><span>–</span><input type="date" aria-label={zh?'结束日期':'End date'} value={to} onChange={e=>setTo(e.target.value)}/></label>
        {(query||author!=='all'||branch!=='all'||pathId||from||to)&&<button className="knowledge-reset" onClick={reset}>{zh?'重置':'Reset'}</button>}
      </div>
      {pathId&&<div className="knowledge-path-banner"><RemixIcon name="route-line" size={15}/><span>{zh?'正在追踪':'Following'}：{byId.get(pathId)?.title}</span><button onClick={()=>setPathId(null)}>{zh?'显示全部':'Show all'}</button></div>}
      {loading&&<div className="knowledge-notice" role="status">{zh?'正在读取观点与演进记录…':'Loading ideas and progression…'}</div>}
      {error&&<div className="knowledge-notice is-error" role="alert">{error}<button onClick={()=>setReload(n=>n+1)}>{zh?'重试':'Retry'}</button></div>}
      {history?.coverage?.truncated&&<div className="knowledge-notice">{zh?'记录较多，当前展示各类最新的 2,000 条记录，早期脉络可能不完整。':'Showing up to 2,000 recent records per source; earlier paths may be incomplete.'}</div>}
      <div className={`knowledge-body ${selected?'has-selection':''}`}>
        <main className="knowledge-main">
          <>
            <div className="knowledge-map-toolbar"><div className="knowledge-relations" aria-label={zh?'关系类型':'Relation types'}>{BUILD_ON_MOVES.map(move=><button key={move.type} aria-pressed={relationTypes.has(move.type)} onClick={()=>setRelationTypes(previous=>{const next=new Set(previous);next.has(move.type)?next.delete(move.type):next.add(move.type);return next;})}><span style={{background:RELATION_COLORS[move.type]}}/>{RELATION_LABELS[lang][move.type]}</button>)}</div><select aria-label={zh?'网络布局':'Network layout'} value={layout} onChange={e=>setLayout(e.target.value as typeof layout)}><option value="branches">{zh?'分支布局':'Branch layout'}</option><option value="time">{zh?'时间布局':'Time layout'}</option></select></div>
            <KnowledgeMapCanvas graph={graph} relations={mapRelations} selectedId={selectedId} onSelect={id=>select(id)} lang={lang}/>
          </>

        </main>
        <aside className={`knowledge-inspector ${selected?'is-open':''}`} aria-label={zh?'观点详情':'Idea details'}>
          {!selected?<div className="knowledge-inspector-intro"><span><RemixIcon name="route-line" size={28}/></span><h3>{zh?'沿着观点，继续探索':'Follow an idea further'}</h3><p>{zh?'选择一条观点，查看它基于什么、被如何接续，再打开时间线回看发展过程。':'Select an idea to examine its foundations and Build-ons, then open the independent timeline.'}</p><div><RemixIcon name="arrow-right-line" size={15}/>{zh?'箭头从原观点指向接续观点':'Arrows point from an idea to its Build-ons'}</div></div>:<>
            <div className="knowledge-inspector-header"><span>{selected.aiGenerated?'AI PARTNER':(zh?'当前观点':'SELECTED IDEA')}</span><button aria-label={zh?'关闭观点详情':'Close idea details'} onClick={()=>{setSelectedId(null);}}><RemixIcon name="close-line" size={18}/></button></div>
            <h3>{selected.title}</h3><p className="knowledge-inspector-meta">{selected.aiGenerated?'AI partner':selected.authorName} · {date(selected.createdAt,true)}</p>
            <p className="knowledge-inspector-excerpt">{selected.excerpt}</p>
            <div className="knowledge-inspector-actions"><button aria-pressed={Boolean(pathId)} onClick={()=>setPathId(pathId?null:selected.id)}><RemixIcon name="route-line" size={15}/>{zh?'追踪此观点脉络':'Trace this idea'}</button>{onShowTimeline&&<button onClick={()=>onShowTimeline(selected.id)}><RemixIcon name="history-line" size={15}/>{zh?'在时间线中查看':'View in timeline'}</button>}</div>
            <h4>{zh?'基于哪些观点':'Built on'}<span>{parents.length}</span></h4>{parents.length?relationList(parents,'before'):<p className="knowledge-inspector-empty">{zh?'尚未建立上游关联。':'No upstream relation yet.'}</p>}
            <h4>{zh?'被怎样接续':'Built on by'}<span>{children.length}</span></h4>{children.length?relationList(children,'after'):<p className="knowledge-inspector-empty">{zh?'尚未有后续关联，可以从这里继续探究。':'No further relation yet. This idea is open to development.'}</p>}
            {onLocateNote&&<button className="knowledge-open-note" onClick={()=>onLocateNote(selected.id)}><RemixIcon name="focus-3-line" size={16}/>{zh?'在知识空间中打开':'Open in knowledge space'}<RemixIcon name="arrow-right-line" size={15}/></button>}
          </>}
        </aside>
      </div>
      <footer className="knowledge-footer"><span>{`${graph.nodes.length} ${zh?'条观点':'ideas'} · ${mapRelations.length} ${zh?'条关联':'relations'}`}</span><span>{zh?'原观点 → 接续观点':'Original idea → Build-on'}</span></footer>
    </div>
  </div>;
}
