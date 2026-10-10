import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import { spaceAnalytics, type SpaceDiscussion, type DiscussionOptions } from '../../services/apiClient';
import { anonymousNames } from './analyticsModel';
import { WordCloud } from './AnalyticsCharts';
import { KeywordChangeChart } from './DiscussionCharts';
import { exportAnalysisChart } from './exportChart';
import {DiscussionThreads} from './DiscussionThreads';
import {PeerConnections,TopicCoverage} from './DiscussionFocus';
import { useAnalyticsMotion } from '../../hooks/useAnalyticsMotion';
import './spaceAnalytics.css';

type Lang='zh'|'en';
type Tool='cloud'|'changes'|'relay'|'pending'|'peers'|'topics';
interface Props {
  spaceId:string; lang:Lang; viewId:string|null; viewName:string; spaceTitle?:string;
  onClose:()=>void; onLocateNote:(id:string)=>void;
  noteTitles:Map<string,{title:string;authorId?:string|null}>;
}
interface Filters {tool:Tool; authorId:string; onlyView:boolean; from:string; through:string; split:string; anonymous:boolean; extraWords:string; extraStop:string}
const DEFAULT:Filters={tool:'cloud',authorId:'',onlyView:false,from:'',through:'',split:'',anonymous:false,extraWords:'',extraStop:''};
const TOOLS: Array<{id:Tool;icon:string;zh:string;en:string;hintZh:string;hintEn:string}>=[
  {id:'cloud',icon:'font-size-2',zh:'词云',en:'Word cloud',hintZh:'点击词语，查看相关笔记。',hintEn:'Click a word to read its source notes.'},
  {id:'changes',icon:'bar-chart-grouped-line',zh:'关键词变化',en:'Keyword changes',hintZh:'比较前后两段，条形表示涉及该词的笔记比例。',hintEn:'Compare two periods. Bars show the share of notes mentioning each word.'},
  {id:'relay',icon:'chat-history-line',zh:'讨论脉络',en:'Discussion threads',hintZh:'沿一段讨论阅读后续回应、质疑与证据，查看还需接续的位置。',hintEn:'Read a discussion’s responses, questions and evidence, and find openings for follow-up.'},
  {id:'peers',icon:'group-line',zh:'同伴连接',en:'Peer connections',hintZh:'查看已有交流与可邀请阅读的同伴笔记。',hintEn:'Inspect actual exchanges and invite peers to read related Notes.'},
  {id:'topics',icon:'list-check-2',zh:'主题覆盖',en:'Topic coverage',hintZh:'按教师设定的关键词组，查看全体或个人提及的讨论范围。',hintEn:'Inspect whole-community or individual mentions of teacher-defined topic keywords.'},
  {id:'pending',icon:'question-answer-line',zh:'待推进议题',en:'Open discussions',hintZh:'查看尚无人回应的笔记和提问后未见后续的讨论。',hintEn:'Find notes without responses and questions without follow-ups.'},
];
function loadFilters(spaceId:string):Filters {
  try {const saved=JSON.parse(sessionStorage.getItem(`discussion:${spaceId}`)??'{}');return {...DEFAULT,...saved,tool:TOOLS.some(t=>t.id===saved.tool)?saved.tool:'cloud'};}catch{return DEFAULT;}
}
function dateInstant(day:string,next=false):string|null {
  if(!day) return null;
  const date=new Date(`${day}T00:00:00`);
  if(!Number.isFinite(date.getTime())) return null;
  if(next) date.setDate(date.getDate()+1);
  return date.toISOString();
}
function useLoad<T>(load:()=>Promise<T>,key:string,enabled=true) {
  const [state,setState]=useState<{data:T|null;error:string|null;loading:boolean}>({data:null,error:null,loading:true});
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let alive=true;
    setState({data:null,error:null,loading:enabled});
    if(enabled) load().then(data=>{if(alive)setState({data,error:null,loading:false});}).catch(error=>{if(alive)setState({data:null,error:error instanceof Error?error.message:String(error),loading:false});});
    return()=>{alive=false;};
    // The serialized query captures each input to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,enabled,revision]);
  return {...state,reload:()=>setRevision(n=>n+1)};
}

const SpaceAnalytics:React.FC<Props>=({spaceId,lang,viewId,viewName,spaceTitle,onClose,onLocateNote,noteTitles})=>{
  const zh=lang==='zh';
  const [filter,setFilter]=useState<Filters>(()=>loadFilters(spaceId));
  const update=<K extends keyof Filters>(key:K,value:Filters[K])=>setFilter(f=>({...f,[key]:value}));
  const [selection,setSelection]=useState<{ids:string[];label:string}|null>(null);
  const [settings,setSettings]=useState(false);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const filterId=React.useId();
  const [draftWords,setDraftWords]=useState(filter.extraWords),[draftStop,setDraftStop]=useState(filter.extraStop);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  const chartRef=useRef<HTMLDivElement>(null);
  const pageRef=useRef<HTMLElement>(null);
  const historyToken=useRef(`discussion-${spaceId}-${Math.random().toString(36).slice(2)}`);
  const returning=useRef(false);
  const mounted=useRef(false);
  const historyAdded=useRef(false);
  useEffect(()=>{
    mounted.current=true;
    if(!historyAdded.current){
      const previous=window.history.state;
      window.history.pushState({...previous,...(typeof previous?.idx==='number'?{idx:previous.idx+1}:{}),hakccAnalysis:historyToken.current},'',window.location.href);
      historyAdded.current=true;
    }
    const back=()=>closeRef.current();
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){returning.current=true;window.history.back();closeRef.current();}
      if(e.key==='Tab'){
        const elements=Array.from(pageRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,textarea,[tabindex="0"]')??[]).filter(el=>el.getClientRects().length>0);
        const first=elements[0],last=elements.at(-1);
        if(first && ((!e.shiftKey && document.activeElement===last)||(e.shiftKey && (document.activeElement===first||document.activeElement===pageRef.current)))){e.preventDefault();(e.shiftKey?last:first)?.focus();}
      }
    };
    window.addEventListener('popstate',back);window.addEventListener('keydown',key);
    const siblings=Array.from(pageRef.current?.parentElement?.children??[]).filter((el):el is HTMLElement=>el instanceof HTMLElement && el!==pageRef.current);
    const inertBefore=siblings.map(el=>el.inert);
    siblings.forEach(el=>{el.inert=true;});
    const focused=document.activeElement as HTMLElement|null;pageRef.current?.focus();
    return()=>{
      window.removeEventListener('popstate',back);window.removeEventListener('keydown',key);
      mounted.current=false;
      // StrictMode runs setup/cleanup/setup; defer disposal so it retains one entry.
      queueMicrotask(()=>{
        if(!mounted.current && !returning.current && window.history.state?.hakccAnalysis===historyToken.current){returning.current=true;window.history.back();}
      });
      siblings.forEach((el,i)=>{el.inert=inertBefore[i];});
      focused?.focus();
    };
  },[]);
  useEffect(()=>{try{sessionStorage.setItem(`discussion:${spaceId}`,JSON.stringify(filter));}catch{/* Storage may be disabled. */}},[spaceId,filter]);
  const close=()=>{returning.current=true;if(window.history.state?.hakccAnalysis===historyToken.current)window.history.back();onClose();};
  const opts:DiscussionOptions={viewId:filter.onlyView?viewId:null,authorId:filter.authorId||null,from:dateInstant(filter.from),until:dateInstant(filter.through,true)};
  const rangeInvalid=!!opts.from && !!opts.until && opts.from>=opts.until;
  const key=JSON.stringify({spaceId,...opts});
  const discussionOpts={...opts,authorId:['peers','topics'].includes(filter.tool)?null:opts.authorId};
  const discussion=useLoad(()=>spaceAnalytics.discussion(spaceId,discussionOpts),JSON.stringify({spaceId,...discussionOpts}),!rangeInvalid);
  const textOpts={...opts,extraWords:filter.extraWords,extraStop:filter.extraStop};
  const textKey=JSON.stringify({spaceId,...textOpts});
  const cloud=useLoad(()=>spaceAnalytics.wordCloud(spaceId,{...textOpts,width:900,height:440}),textKey,filter.tool==='cloud'&&!rangeInvalid);
  const changesOpts={...textOpts,splitAt:dateInstant(filter.split)};
  const changes=useLoad(()=>spaceAnalytics.changes(spaceId,changesOpts),JSON.stringify({spaceId,...changesOpts}),filter.tool==='changes'&&!rangeInvalid);
  const peers=useLoad(()=>spaceAnalytics.peers(spaceId,textOpts),textKey,filter.tool==='peers'&&!rangeInvalid);
  const topics=useLoad(()=>spaceAnalytics.topics(spaceId,opts),key,filter.tool==='topics'&&!rangeInvalid);
  useEffect(()=>setSelection(null),[key,filter.tool,filter.extraWords,filter.extraStop,filter.split,filter.anonymous]);
  const data=discussion.data;
  const names=useMemo(()=>new Map(data?.members.map(m=>[m.id,m.name])??[]),[data]);
  const anonymous=useMemo(()=>anonymousNames(data?.members??[],lang),[data,lang]);
  const nameOf=useCallback((id:string)=>filter.anonymous?(anonymous.get(id)??(zh?'同学':'Student')):(names.get(id)??(zh?'未知成员':'Unknown')),[filter.anonymous,anonymous,names,zh]);
  const noteIndex=useMemo(()=>new Map(data?.notes.map((n,i)=>[n.id,i+1])??[]),[data]);
  const noteOf=useMemo(()=>new Map(data?.notes.map(n=>[n.id,n])??[]),[data]);
  const titleOf=(id:string)=>filter.anonymous?`${zh?'笔记':'Note'} ${noteIndex.get(id)??''}`:(noteOf.get(id)?.title||noteTitles.get(id)?.title||(zh?'无标题':'Untitled'));
  const pick=(ids:string[],label:string)=>setSelection({ids,label});
  const active=TOOLS.find(t=>t.id===filter.tool)!;
  const related=selection?.ids.map(id=>noteOf.get(id)).filter((n):n is SpaceDiscussion['notes'][number]=>!!n)??[];
  const requestError=discussion.error||(filter.tool==='cloud'?cloud.error:filter.tool==='changes'?changes.error:filter.tool==='peers'?peers.error:filter.tool==='topics'?topics.error:null);
  const busy=discussion.loading||(filter.tool==='cloud'?cloud.loading:filter.tool==='changes'?changes.loading:filter.tool==='peers'?peers.loading:filter.tool==='topics'?topics.loading:false);
  const content=filter.tool==='cloud'?cloud.data:filter.tool==='changes'?changes.data:filter.tool==='peers'?peers.data:filter.tool==='topics'?topics.data:data;
  useAnalyticsMotion(pageRef,{tool:filter.tool,busy,content:rangeInvalid||requestError?null:content,selection:selection?JSON.stringify(selection):'',settings});
  const refresh=()=>{discussion.reload();if(filter.tool==='cloud')cloud.reload();if(filter.tool==='changes')changes.reload();if(filter.tool==='peers')peers.reload();if(filter.tool==='topics')topics.reload();};
  const [exportError,setExportError]=useState('');
  const exportChart=async()=>{setExportError('');try{await exportAnalysisChart(chartRef.current?.querySelector('svg')??null,`discussion-${filter.tool}.png`);}catch{setExportError(zh?'图片未能导出，请重试。':'Could not export the image. Try again.');}};
  return <main ref={pageRef} tabIndex={-1} aria-label={zh?'讨论分析':'Discussion analytics'} className="discussion-analysis" data-analysis-tool={filter.tool}>
    <header className="da-header" data-analysis-motion="chrome">
      <button type="button" className="da-back" aria-label={zh?'返回空间':'Back to space'} onClick={close}><RemixIcon name="arrow-left-line" size={18}/><span>{zh?'返回空间':'Back to space'}</span></button>
      <div className="da-heading"><span>{spaceTitle||(zh?'知识空间':'Knowledge space')}</span><h1>{zh?'讨论分析':'Discussion analytics'}</h1></div>
      <div className="da-header-actions"><button type="button" className="da-filter-toggle" aria-label={zh?'筛选':'Filters'} aria-expanded={filtersOpen} aria-controls={filterId} onClick={()=>setFiltersOpen(open=>!open)}><RemixIcon name="filter-3-line" size={18}/><span>{zh?'筛选':'Filters'}</span></button><label className="da-anonymous"><input type="checkbox" aria-label={zh?'匿名显示':'Anonymise'} checked={filter.anonymous} onChange={e=>update('anonymous',e.target.checked)}/><span>{zh?'匿名显示':'Anonymise'}</span></label>
        <button type="button" className="da-icon-btn" aria-label={zh?'刷新':'Refresh'} onClick={refresh}><RemixIcon name="refresh-line" size={18}/></button>
      </div>
    </header>
    <div className="da-shell">
      <nav className="da-tools" aria-label={zh?'分析工具':'Analysis tools'} data-analysis-motion="chrome"><span className="da-nav-label">{zh?'工具':'TOOLS'}</span>
        {TOOLS.map(t=><button type="button" key={t.id} aria-current={filter.tool===t.id?'page':undefined} onClick={()=>update('tool',t.id)}><span className="da-tool-icon"><RemixIcon name={t.icon} size={20}/></span><span>{zh?t.zh:t.en}</span></button>)}
        <p className="da-nav-foot">{zh?'从讨论中查看原文，回到画布继续。':'Explore the discussion, then return to its notes.'}</p>
      </nav>
      <div className="da-workspace">
        <section id={filterId} className={`da-filters${filtersOpen?' da-filters-open':''}`} aria-label={zh?'筛选':'Filters'} data-analysis-motion="chrome">
          <label>{zh?'范围':'Scope'}<select aria-label={zh?'范围':'Scope'} value={filter.onlyView&&viewId?'view':'all'} onChange={e=>update('onlyView',e.target.value==='view')}><option value="all">{zh?'整个空间':'Whole space'}</option>{viewId&&<option value="view">{viewName}</option>}</select></label>
          <label>{zh?'对象':'People'}<select aria-label={zh?'对象':'People'} value={filter.authorId} onChange={e=>update('authorId',e.target.value)}><option value="">{zh?'所有学生':'All students'}</option>{data?.members.map(m=><option key={m.id} value={m.id}>{nameOf(m.id)}</option>)}</select></label>
          <label>{zh?'开始日期':'From'}<input aria-label={zh?'开始日期':'From'} type="date" value={filter.from} max={filter.through||undefined} onChange={e=>update('from',e.target.value)}/></label>
          <label>{zh?'结束日期':'Through'}<input aria-label={zh?'结束日期':'Through'} type="date" value={filter.through} min={filter.from||undefined} onChange={e=>update('through',e.target.value)}/></label>
          {(filter.from||filter.through||filter.authorId||filter.onlyView)&&<button type="button" className="da-clear" onClick={()=>setFilter(f=>({...f,authorId:'',onlyView:false,from:'',through:'',split:''}))}>{zh?'清除筛选':'Clear filters'}</button>}
        </section>
        <div className="da-content">
          <section className="da-main-panel" aria-busy={busy}>
            <div className="da-panel-heading"><div><h2>{zh?active.zh:active.en}</h2><p>{zh?active.hintZh:active.hintEn}</p></div>
              <div className="da-panel-actions">{(['cloud','changes','peers'].includes(filter.tool))&&<button type="button" onClick={()=>setSettings(s=>!s)} aria-expanded={settings}><RemixIcon name="equalizer-line" size={16}/>{zh?'词语设置':'Word settings'}</button>}
                {['cloud','changes','topics'].includes(filter.tool)&&<button type="button" className="da-export" onClick={exportChart} disabled={busy||!!requestError||rangeInvalid}><RemixIcon name="download-2-line" size={16}/>{zh?'导出图片':'Export image'}</button>}
              </div>
            </div>
            {settings&&(['cloud','changes','peers'].includes(filter.tool))&&<form className="da-word-settings" data-analysis-motion="settings" onSubmit={e=>{e.preventDefault();setFilter(f=>({...f,extraWords:draftWords,extraStop:draftStop}));setSettings(false);}}><label>{zh?'保留为完整词语':'Keep as whole words'}<textarea aria-label={zh?'保留词语':'Keep whole words'} maxLength={1200} value={draftWords} onChange={e=>setDraftWords(e.target.value)} placeholder={zh?'如：检索练习，课程专名':'Course terms, separated by commas'}/></label><label>{zh?'排除词语':'Exclude words'}<textarea aria-label={zh?'排除词语':'Exclude words'} maxLength={1200} value={draftStop} onChange={e=>setDraftStop(e.target.value)}/></label><button type="submit">{zh?'应用':'Apply'}</button></form>}
            {filter.tool==='changes'&&<div className="da-comparison"><label>{zh?'前后分界日期':'Comparison date'}<input type="date" aria-label={zh?'前后分界日期':'Comparison date'} value={filter.split} min={filter.from||undefined} max={filter.through||undefined} onChange={e=>update('split',e.target.value)}/></label><span>{filter.split?(zh?'所选日期零点起计入后段。':'The later period starts at midnight on this date.'):(zh?'未指定时，按当前笔记日期的中点分段。':'Defaults to the midpoint of the selected note dates.')}</span></div>}
            {exportError&&<p className="da-notice" role="alert">{exportError}</p>}
            <div className="da-chart" ref={chartRef}>
              {rangeInvalid?<p className="da-empty" role="alert">{zh?'结束日期不能早于开始日期。':'End date cannot precede start date.'}</p>:requestError?<div className="da-empty" role="alert">{zh?'读取失败：':'Could not load: '}{requestError}<button type="button" className="da-more" onClick={refresh}>{zh?'重试':'Retry'}</button></div>:busy?<div className="da-loading" role="status"><RemixIcon name={active.icon} size={30}/><span>{zh?'正在读取…':'Loading…'}</span><span className="da-loading-dots" aria-hidden="true">{[0,1,2].map(i=><i key={i} className="da-loading-dot"/>)}</span></div>:data?<div className={`da-result da-result-${filter.tool}`} data-analysis-motion="result" key={filter.tool}>
                {filter.tool==='cloud'&&cloud.data&&<><WordCloud data={cloud.data} lang={lang} selected={selection?.label??null} onPick={word=>word?pick(cloud.data!.terms.find(t=>t.word===word)?.note_ids??[],word):setSelection(null)}/><p className="da-chart-caption">{zh?`${cloud.data.docs} 篇学生笔记 · 不计教师、AI 生成笔记及标记的 AI 摘录`:`${cloud.data.docs} student notes · teacher notes, AI-generated notes and marked AI excerpts excluded`}</p></>}
                {filter.tool==='changes'&&changes.data&&<><KeywordChangeChart data={changes.data} lang={lang} onPick={pick}/><p className="da-chart-caption">{zh?'按笔记创建时间分段，分析当前正文；变化不代表掌握程度。':'Periods use note creation dates and current text; changes do not measure mastery.'}</p></>}
                {filter.tool==='relay'&&<DiscussionThreads key={key} data={data} lang={lang} titleOf={titleOf} nameOf={nameOf} anonymous={filter.anonymous} onPick={pick}/>}
                {filter.tool==='peers'&&peers.data&&<PeerConnections key={key} data={peers.data} lang={lang} nameOf={nameOf} authorId={filter.authorId} onPick={pick}/>}
                {filter.tool==='topics'&&topics.data&&<TopicCoverage data={topics.data} lang={lang} onPick={pick} onSave={async(values,revision)=>{await spaceAnalytics.saveTopics(spaceId,values,revision);topics.reload();setSelection(null);}}/>}
                {filter.tool==='pending'&&<PendingDiscussions data={data} lang={lang} titleOf={titleOf} nameOf={nameOf} onPick={pick}/>}
              </div>:null}
            </div>
          </section>
          <aside className="da-sources" aria-label={zh?'相关笔记':'Source notes'}><div className="da-sources-heading"><RemixIcon name="file-text-line" size={18}/><h2>{zh?'相关笔记':'Source notes'}</h2>{selection&&<span className="da-sources-total" aria-live="polite">{related.length}</span>}</div>
            {!selection?<div className="da-sources-empty"><RemixIcon name="cursor-line" size={26}/><p>{zh?'点击词语、观点或议题，查看来源。':'Select a word, note or discussion to see its sources.'}</p></div>:<><div className="da-selection-label">{selection.label}</div><p className="da-source-count">{related.length} {zh?'篇笔记':'notes'}{related.length>=50&&(zh?' · 来源列表已截取':' · source list limited')}</p>{filter.anonymous&&<p className="da-notice">{zh?'匿名模式隐藏标题和正文。':'Titles and text are hidden in anonymous mode.'}</p>}
              {related.map(n=><article key={n.id} className="da-source-note"><span className="da-source-author">{nameOf(n.authorId)} · {new Date(n.createdAt).toLocaleDateString(zh?'zh-CN':'en-US')}</span><h3>{titleOf(n.id)}</h3>{!filter.anonymous&&<p>{n.excerpt}</p>}<button type="button" onClick={()=>{close();onLocateNote(n.id);}}><RemixIcon name="focus-3-line" size={14}/>{zh?'回到画布':'Locate on canvas'}</button></article>)}
              {!related.length&&<p className="da-empty">{zh?'这个范围没有相关笔记。':'No source notes in this range.'}</p>}
            </>}
          </aside>
        </div>
      </div>
    </div>
  </main>;
};

function PendingDiscussions({data,lang,titleOf,nameOf,onPick}:{data:SpaceDiscussion;lang:Lang;titleOf:(id:string)=>string;nameOf:(id:string)=>string;onPick:(ids:string[],label:string)=>void}) {
  const [kind,setKind]=useState<'all'|'unanswered'|'question'>('all');
  const zh=lang==='zh';const notes=new Map(data.notes.map(n=>[n.id,n]));
  const rows=data.pending.filter(p=>kind==='all'||p.reason===kind);
  return <><div className="da-pending-filters">{(['all','unanswered','question'] as const).map(k=><button key={k} type="button" aria-pressed={kind===k} onClick={()=>setKind(k)}>{k==='all'?(zh?'全部':'All'):k==='unanswered'?(zh?'无人回应':'No response'):(zh?'提问待接续':'Questions to follow up')}</button>)}</div>
    <p className="da-chart-caption">{zh?'“提问待接续”依据关系标记筛选，需对照原文确认。':'Question candidates use relation labels; check the original notes.'}</p>
    {!rows.length?<p className="da-empty">{zh?'这个范围没有待推进的议题。':'No open discussions in this range.'}</p>:<ul className="da-pending-list">{rows.map(p=>{const n=notes.get(p.noteId);if(!n)return null;return <li key={`${p.noteId}:${p.reason}`}><button type="button" onClick={()=>onPick([n.id,...data.edges.filter(e=>e.from===n.id).map(e=>e.to)],titleOf(n.id))}><span className={`da-reason ${p.reason==='question'?'da-question':''}`}>{p.reason==='unanswered'?(zh?'无人回应':'No response'):(zh?'提问待接续':'Question')}</span><strong>{titleOf(n.id)}</strong><span>{nameOf(n.authorId)} · {new Date(n.createdAt).toLocaleDateString(zh?'zh-CN':'en-US')}</span><RemixIcon name="arrow-right-s-line" size={18}/></button></li>;})}</ul>}
  </>;
}
export default SpaceAnalytics;
