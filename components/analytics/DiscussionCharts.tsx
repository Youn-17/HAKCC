import React, { useId, useMemo, useState } from 'react';
import type { SpaceDiscussion, SpaceKeywordChanges } from '../../services/apiClient';
import { RELATION_COLORS, RELATION_LABELS } from '../relationColors';

type Lang = 'zh' | 'en';
const activate = (event: React.KeyboardEvent, action: () => void) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
};

/** Actual Note relations, displayed from the parent to the response. */
export function RelayChart({ data, lang, titleOf, nameOf, selectedId, onPick }: {
  data: SpaceDiscussion; lang: Lang; titleOf: (id:string)=>string; nameOf: (id:string)=>string;
  selectedId: string | null; onPick: (ids:string[], label:string)=>void;
}) {
  const marker = useId().replace(/:/g,'');
  const [limit,setLimit] = useState(80);
  const layout = useMemo(()=>{
    const notes=data.notes.slice(0,limit), ids=new Set(notes.map(n=>n.id));
    const edges=data.edges.filter(e=>ids.has(e.from) && ids.has(e.to));
    const incoming=new Set(edges.map(e=>e.to));
    const adjacent=new Map<string,string[]>();
    for(const e of edges) adjacent.set(e.from,[...(adjacent.get(e.from)??[]),e.to]);
    const level=new Map<string,number>();
    const visit=(root:string)=>{
      level.set(root,0); const queue=[root];
      for(let i=0;i<queue.length;i++) for(const id of adjacent.get(queue[i])??[]) if(!level.has(id)) {level.set(id,Math.min(5,level.get(queue[i])!+1));queue.push(id);}
    };
    for(const n of notes) if(!incoming.has(n.id) && !level.has(n.id)) visit(n.id);
    for(const n of notes) if(!level.has(n.id)) visit(n.id); // Cyclic chains have no root.
    const rows=new Map<number,number>();
    const positions=new Map(notes.map(n=>{
      const column=level.get(n.id)!,row=rows.get(column)??0;rows.set(column,row+1);
      return [n.id,{x:24+column*270,y:28+row*130}];
    }));
    return {notes,edges,positions,width:Math.max(720,Math.max(0,...level.values())*270+280),height:Math.max(360,Math.max(0,...rows.values())*130+50)};
  },[data,limit]);
  if(!data.notes.length) return <p className="da-empty">{lang==='zh'?'这个范围还没有学生笔记。':'No student notes in this range.'}</p>;
  return <>
    <div className="da-graph-scroll">
      <svg className="da-relay" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={lang==='zh'?'Note 观点接力图':'Note relay graph'}>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="context-stroke" /></marker></defs>
        {layout.edges.map((e,i)=>{
          const a=layout.positions.get(e.from)!,b=layout.positions.get(e.to)!;
          const forward=b.x>a.x;
          const start={x:a.x+(forward?220:110),y:a.y+(forward?48:94)};
          const end={x:b.x+(forward?0:110),y:b.y+(forward?48:0)};
          const bend=forward ? (end.x-start.x)/2 : 70;
          const d=forward ? `M${start.x},${start.y} C${start.x+bend},${start.y} ${end.x-bend},${end.y} ${end.x},${end.y}` : `M${start.x},${start.y} C${start.x+bend},${start.y+30} ${end.x+bend},${end.y-30} ${end.x},${end.y}`;
          return <g key={`${e.from}:${e.to}:${i}`}><path d={d} fill="none" stroke={RELATION_COLORS[e.type]??'#94a3b8'} strokeWidth="1.8" opacity=".75" markerEnd={`url(#${marker})`}><title>{RELATION_LABELS[lang][e.type]??e.type}</title></path>
            {forward && <text x={(start.x+end.x)/2} y={(start.y+end.y)/2-7} textAnchor="middle" className="da-edge-label">{RELATION_LABELS[lang][e.type]??e.type}</text>}
          </g>;
        })}
        {layout.notes.map(n=>{
          const p=layout.positions.get(n.id)!;
          return <g key={n.id} transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0} aria-label={titleOf(n.id)} className={`da-relay-node ${n.selected?'da-own':''} ${selectedId===n.id?'da-picked':''}`}
            onClick={()=>onPick([n.id],titleOf(n.id))} onKeyDown={e=>activate(e,()=>onPick([n.id],titleOf(n.id)))}>
            <rect width="220" height="94" rx="12" />
            <text x="16" y="27" className="da-node-author">{nameOf(n.authorId).slice(0,22)}</text>
            <text x="16" y="51" className="da-node-title">{titleOf(n.id).slice(0,17)}{titleOf(n.id).length>17?'…':''}</text>
            <text x="16" y="75" className="da-node-date">{new Date(n.createdAt).toLocaleDateString(lang==='zh'?'zh-CN':'en-US')}</text>
            <title>{titleOf(n.id)}</title>
          </g>;
        })}
      </svg>
    </div>
    {layout.notes.length<data.notes.length && <button className="da-more" onClick={()=>setLimit(n=>n+80)}>{lang==='zh'?`已显示 ${layout.notes.length}/${data.notes.length} 条，继续展开`:`Showing ${layout.notes.length}/${data.notes.length}; show more`}</button>}
  </>;
}

export function KeywordChangeChart({data,lang,onPick}:{data:SpaceKeywordChanges;lang:Lang;onPick:(ids:string[],label:string)=>void}) {
  const zh=lang==='zh';
  if(!data.available) return <p className="da-empty">{zh?'关键词暂时无法生成，请稍后重试。':'Keywords are unavailable. Try again later.'}</p>;
  if(!data.terms.length) return <p className="da-empty">{zh?'这个范围还没有可比较的关键词。':'No keywords to compare in this range.'}</p>;
  const comparable=data.periods.before.docs>0 && data.periods.after.docs>0;
  return <>
    <div className="da-periods"><span><i className="da-before-dot" />{zh?'前段':'Earlier'} · {data.periods.before.docs} {zh?'篇':'notes'}</span><span><i className="da-after-dot" />{zh?'后段':'Later'} · {data.periods.after.docs} {zh?'篇':'notes'}</span></div>
    {!comparable && <p className="da-notice">{zh?'其中一段没有笔记，暂不比较变化幅度。':'One period has no notes; changes are not compared.'}</p>}
    <div className="da-chart-scroll"><svg viewBox={`0 0 760 ${data.terms.length*62+32}`} role="img" aria-label={zh?'关键词前后变化':'Keyword changes'} className="da-change-chart">
      {data.terms.map((t,i)=>{
        const before=t.before.notes/Math.max(1,data.periods.before.docs),after=t.after.notes/Math.max(1,data.periods.after.docs);
        const ids=[...new Set([...t.before.note_ids,...t.after.note_ids])];
        const pick=()=>onPick(ids,t.word);
        return <g key={t.word} transform={`translate(0,${i*62+20})`} role="button" tabIndex={0} aria-label={t.word} onClick={pick} onKeyDown={e=>activate(e,pick)} className="da-keyword-row">
          <text x="8" y="16" className="da-change-word">{t.word.slice(0,12)}</text>
          <rect x="150" y="0" width="350" height="11" rx="5" className="da-bar-track" />
          <rect x="150" y="0" width={before*350} height="11" rx="5" fill="#94a3b8" />
          <rect x="150" y="18" width="350" height="11" rx="5" className="da-bar-track" />
          <rect x="150" y="18" width={after*350} height="11" rx="5" fill="#4556a6" />
          <text x="516" y="10" className="da-change-value">{Math.round(before*100)}% · {t.before.count} {zh?'次':'times'}</text>
          <text x="516" y="28" className="da-change-value">{Math.round(after*100)}% · {t.after.count} {zh?'次':'times'}</text>
          <text x="680" y="19" className="da-change-value">{comparable?`${t.delta>0?'+':''}${Math.round(t.delta*100)} ${zh?'百分点':'pp'}`:'—'}</text>
          <title>{t.word}</title>
        </g>;
      })}
    </svg></div>
  </>;
}
