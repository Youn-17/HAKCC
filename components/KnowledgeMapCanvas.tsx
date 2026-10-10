import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryRelation } from '../services/apiClient';
import { CARD_HEIGHT, CARD_WIDTH, type layoutKnowledgeMap } from './knowledgeExplorerModel';
import { RELATION_COLORS, RELATION_LABELS } from './relationColors';
import RemixIcon from './RemixIcon';
import {useInteractionMotion} from '../hooks/useInteractionMotion';

type Graph=ReturnType<typeof layoutKnowledgeMap>;
type Camera={x:number;y:number;zoom:number};
export default function KnowledgeMapCanvas({graph,relations,selectedId,onSelect,lang}: {graph:Graph;relations:HistoryRelation[];selectedId:string|null;onSelect:(id:string)=>void;lang:'zh'|'en'}) {
  const zh=lang==='zh';
  const stage=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null);
  const [size,setSize]=useState({width:900,height:600});
  const [camera,setCamera]=useState<Camera>({x:32,y:32,zoom:.8});
  const [hover,setHover]=useState<string|null>(null);
  const [offsets,setOffsets]=useState<Record<string,{x:number;y:number}>>({});
  const drag=useRef<{id?:string;x:number;y:number;camera:Camera;origin:{x:number;y:number};moved:boolean}|null>(null);
  const moved=useRef(false);
  useEffect(()=>{const el=stage.current;if(!el)return;const observer=new ResizeObserver(()=>setSize({width:el.clientWidth,height:el.clientHeight}));observer.observe(el);return()=>observer.disconnect();},[]);
  const fit=useCallback((readable=false)=>{
    const fitting=Math.min((size.width-64)/graph.width,(size.height-64)/graph.height,1);
    const zoom=Math.max(readable ? .8 : .08,fitting);
    setCamera({zoom,x:Math.max(32,(size.width-graph.width*zoom)/2),y:graph.height*zoom>size.height?32:(size.height-graph.height*zoom)/2});
  },[graph.width,graph.height,size]);
  useEffect(()=>{setOffsets({});fit(true);},[graph,fit]);
  const zoomAt=useCallback((factor:number,x=size.width/2,y=size.height/2)=>setCamera(c=>{
    const zoom=Math.max(.08,Math.min(2.5,c.zoom*factor));return{x:x-(x-c.x)*zoom/c.zoom,y:y-(y-c.y)*zoom/c.zoom,zoom};
  }),[size]);
  useEffect(()=>{const el=stage.current;if(!el)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const box=el.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*.0015),e.clientX-box.left,e.clientY-box.top);};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[zoomAt]);
  const counts=useMemo(()=>{const counts=new Map<string,{incoming:number;outgoing:number}>();for(const r of relations){const source=counts.get(r.source)??{incoming:0,outgoing:0};source.incoming++;counts.set(r.source,source);const target=counts.get(r.target)??{incoming:0,outgoing:0};target.outgoing++;counts.set(r.target,target);}return counts;},[relations]);
  const positions=new Map(graph.nodes.map(n=>[n.id,{...n,...offsets[n.id]}]));
  const motion=useInteractionMotion();
  useEffect(()=>{
    motion.stop('relationship-focus');
    if(selectedId)motion.draw([...(svg.current?.querySelectorAll<SVGPathElement>('path[data-motion-related="true"]')??[])],'relationship-focus');
    return()=>motion.stop('relationship-focus');
  },[selectedId,graph,motion]);
  const active=hover??selectedId;
  const neighbors=new Set([active]);
  if(active)for(const r of relations){if(r.source===active)neighbors.add(r.target);if(r.target===active)neighbors.add(r.source);}
  const start=(event:React.PointerEvent,id?:string)=>{
    if(event.button!==0)return;
    const origin=id?positions.get(id)!:{x:0,y:0};
    drag.current={id,x:event.clientX,y:event.clientY,camera,origin,moved:false};moved.current=false;
    svg.current?.setPointerCapture(event.pointerId);
  };
  const move=(event:React.PointerEvent)=>{
    const current=drag.current;if(!current)return;
    const dx=event.clientX-current.x,dy=event.clientY-current.y;
    if(Math.abs(dx)+Math.abs(dy)>5){current.moved=true;moved.current=true;}
    if(!current.moved)return;
    if(current.id)setOffsets(p=>({...p,[current.id!]:{x:current.origin.x+dx/current.camera.zoom,y:current.origin.y+dy/current.camera.zoom}}));
    else setCamera({...current.camera,x:current.camera.x+dx,y:current.camera.y+dy});
  };
  const finish=(event:React.PointerEvent)=>{const current=drag.current;if(event.type!=='pointercancel'&&current?.id&&!current.moved)onSelect(current.id);drag.current=null;if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);};
  const center=(id:string)=>{const p=positions.get(id);if(!p)return;setCamera(c=>{const left=p.x*c.zoom+c.x,top=p.y*c.zoom+c.y;if(left>=16&&top>=16&&left+CARD_WIDTH*c.zoom<=size.width-16&&top+CARD_HEIGHT*c.zoom<=size.height-16)return c;return {...c,x:size.width/2-(p.x+CARD_WIDTH/2)*c.zoom,y:size.height/2-(p.y+CARD_HEIGHT/2)*c.zoom};});};
  // Selection from the history or inspector should be visible in the map as well.
  useEffect(()=>{if(selectedId)center(selectedId);},[selectedId,graph,size]);
  const date=(at:string)=>new Date(at).toLocaleDateString(zh?'zh-CN':'en-GB',{month:'short',day:'numeric'});
  return <div ref={stage} className="knowledge-map-stage">
    {graph.nodes.length===0?<div className="knowledge-empty"><RemixIcon name="mind-map" size={32}/><h3>{zh?'当前范围没有观点':'No ideas in this scope'}</h3><p>{zh?'调整筛选，或先在知识空间中贡献一条 Note。':'Adjust the filters or contribute a Note to this space.'}</p></div>:<>
      <svg ref={svg} className="knowledge-map-svg" aria-label={zh?'观点关系地图':'Idea relationship map'} tabIndex={0}
        onPointerDown={e=>{if((e.target as Element).closest('.knowledge-node'))return;start(e);}}
        onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
        onKeyDown={e=>{if(e.target!==e.currentTarget)return;const delta=70;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();setCamera(c=>({...c,x:c.x+(e.key==='ArrowLeft'?delta:e.key==='ArrowRight'?-delta:0),y:c.y+(e.key==='ArrowUp'?delta:e.key==='ArrowDown'?-delta:0)}));}if(e.key==='+'||e.key==='=')zoomAt(1.2);if(e.key==='-')zoomAt(1/1.2);}}>
        <defs>{Object.entries(RELATION_COLORS).map(([type,color])=><marker key={type} id={`progress-arrow-${type}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={color}/></marker>)}</defs>
        <g transform={`translate(${camera.x},${camera.y}) scale(${camera.zoom})`}>
          {graph.branches.filter(b=>b.nodeIds.length>1).map(b=><text key={b.id} x="60" y={b.y} className="knowledge-branch-label">{b.title.slice(0,32)} · {b.nodeIds.length} {zh?'条观点':'ideas'}</text>)}
          {relations.map(r=>{
            const parent=positions.get(r.target),child=positions.get(r.source);if(!parent||!child)return null;
            const forward=child.x>parent.x;
            const x1=parent.x+(forward?CARD_WIDTH:CARD_WIDTH/2),y1=parent.y+CARD_HEIGHT/2;
            const x2=child.x+(forward?0:CARD_WIDTH/2),y2=child.y+CARD_HEIGHT/2;
            const bend=forward?Math.max(38,(x2-x1)/2):Math.max(90,Math.abs(y2-y1)/2);
            const path=forward?`M${x1},${y1} C${x1+bend},${y1} ${x2-bend},${y2} ${x2-5},${y2}`:`M${x1},${y1} C${x1+bend},${y1} ${x2+bend},${y2} ${x2+4},${y2}`;
            const type=r.relationType??'extend',highlight=active===r.source||active===r.target;
            return <g key={r.id} className="knowledge-map-edge" opacity={active&&!highlight ? .12 : 1}>
              <path data-motion-related={selectedId===r.source||selectedId===r.target} d={path} fill="none" stroke={RELATION_COLORS[type]??'#8a96ac'} strokeWidth={highlight?2.8:1.7} markerEnd={`url(#progress-arrow-${type})`}/>
              {highlight&&<g transform={`translate(${(x1+x2)/2},${(y1+y2)/2})`}><rect x="-26" y="-12" width="52" height="24" rx="10" className="knowledge-edge-label-bg"/><text textAnchor="middle" y="4" fill={RELATION_COLORS[type]} fontSize="11">{RELATION_LABELS[lang][type]??type}</text></g>}
            </g>;
          })}
          {graph.nodes.map(n=>{
            const p=positions.get(n.id)!;const selected=n.id===selectedId;const {incoming=0,outgoing=0}=counts.get(n.id)??{};
            return <foreignObject key={n.id} x={p.x} y={p.y} width={CARD_WIDTH} height={CARD_HEIGHT} className="knowledge-node" opacity={active&&!neighbors.has(n.id) ? .35 : 1}>
              <button type="button" className={`knowledge-idea-card ${selected?'is-selected':''} ${n.aiGenerated?'is-ai':''}`} aria-pressed={selected} aria-label={n.title|| (zh?'未命名 Note':'Untitled Note')}
                onPointerDown={e=>{e.stopPropagation();start(e,n.id);}} onClick={e=>{if(e.detail===0||!moved.current)onSelect(n.id);}}
                onMouseEnter={()=>setHover(n.id)} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover(n.id)} onBlur={()=>setHover(null)}>
                <span className="knowledge-card-meta"><span>{n.aiGenerated?'AI partner':n.authorName||(zh?'同学':'Peer')}</span><time>{date(n.createdAt)}</time></span>
                <strong>{n.title||(zh?'未命名 Note':'Untitled Note')}</strong>
                <span className="knowledge-card-excerpt">{n.excerpt|| (zh?'打开原 Note 查看内容':'Open the original Note')}</span>
                <span className="knowledge-card-links"><span><RemixIcon name="git-branch-line" size={12}/>{incoming} {zh?'依据':'before'}</span><span>{outgoing} {zh?'接续':'after'}<RemixIcon name="arrow-right-line" size={12}/></span></span>
              </button>
            </foreignObject>;
          })}
        </g>
      </svg>
      <div className="knowledge-map-help">{zh?'拖动画布或卡片 · 滚轮缩放 · 点击查看脉络':'Drag canvas or cards · Scroll to zoom · Select an idea'}</div>
      <div className="knowledge-map-controls">
        <button onClick={()=>zoomAt(1/1.2)} aria-label={zh?'缩小网络':'Zoom out'}><RemixIcon name="subtract-line" size={17}/></button>
        <button onClick={()=>fit()} aria-label={zh?'显示完整网络':'Fit whole map'}>{Math.round(camera.zoom*100)}%</button>
        <button onClick={()=>zoomAt(1.2)} aria-label={zh?'放大网络':'Zoom in'}><RemixIcon name="add-line" size={17}/></button>
        <button onClick={()=>{setOffsets({});fit(true);}} aria-label={zh?'重置网络布局':'Reset layout'}><RemixIcon name="focus-3-line" size={17}/></button>
      </div>
      <button className="knowledge-minimap" aria-label={zh?'导航缩略图：点击移动视野':'Navigation minimap: click to move'} onClick={e=>{if(e.detail===0){fit();return;}const box=e.currentTarget.getBoundingClientRect();const x=(e.clientX-box.left)/box.width*graph.width,y=(e.clientY-box.top)/box.height*graph.height;setCamera(c=>({...c,x:size.width/2-x*c.zoom,y:size.height/2-y*c.zoom}));}}>
        <svg viewBox={`0 0 ${graph.width} ${graph.height}`} preserveAspectRatio="none" aria-hidden="true">{graph.nodes.map(n=><rect key={n.id} x={positions.get(n.id)!.x} y={positions.get(n.id)!.y} width={CARD_WIDTH} height={CARD_HEIGHT} rx="12" fill={n.id===selectedId?'#000080':'#b7c2d6'}/>)}<rect x={-camera.x/camera.zoom} y={-camera.y/camera.zoom} width={size.width/camera.zoom} height={size.height/camera.zoom} fill="#637aca15" stroke="#637aca" strokeWidth={Math.max(2,graph.width/140)}/></svg>
      </button>
    </>}
  </div>;
}
