import React,{useState} from 'react';
import type {AnalyticsTopic,SpacePeerConnections,SpaceTopicCoverage} from '../../services/apiClient';

export function PeerConnections({data,lang,nameOf,authorId,onPick}:{data:SpacePeerConnections;lang:'zh'|'en';nameOf:(id:string)=>string;authorId:string;onPick:(ids:string[],label:string)=>void}) {
  const zh=lang==='zh';const [kind,setKind]=useState<'existing'|'read'>('existing'),[limit,setLimit]=useState(20);
  const rows=kind==='existing'?data.connections:data.candidates;
  const quiet=data.members.filter(m=>m.peers===0&&(!authorId||m.id===authorId));
  return <div className="da-peer-panel">
    <div className="da-pending-filters"><button type="button" aria-pressed={kind==='existing'} onClick={()=>{setKind('existing');setLimit(20);}}>{zh?'已有交流':'Existing exchanges'} ({data.connections.length})</button><button type="button" aria-pressed={kind==='read'} onClick={()=>{setKind('read');setLimit(20);}}>{zh?'可邀请阅读':'Reading invitations'} ({data.candidateCount})</button></div>
    {!data.available&&<p role="status" className="da-notice">{zh?'词语分析暂不可用，已有交流仍可查看。':'Word analysis is unavailable; actual exchanges remain visible.'}</p>}
    {!!quiet.length&&kind==='existing'&&<p className="da-peer-quiet">{zh?'尚未直接交流：':'No direct exchanges yet: '}{quiet.map(m=>`${nameOf(m.id)}${m.notes===0?(zh?'（还没有笔记）':' (no notes yet)'):''}`).join('、')}</p>}
    {!rows.length?<p className="da-empty">{kind==='existing'?(zh?'这个范围还没有直接交流。':'No direct exchanges in this range.'):(zh?'暂没有共同关注词支持的阅读候选。':'No reading candidates supported by shared words.')}</p>:<ul className="da-peer-list">{rows.slice(0,limit).map(row=><li key={`${row.a}:${row.b}`}>
      <div><strong>{nameOf(row.a)} <span>↔</span> {nameOf(row.b)}</strong>{'words' in row?<><p>{zh?'共同提及：':'Both mention: '}{row.words.join(' · ')}</p><small>{zh?'此范围内尚无直接 Build-on；可先阅读双方笔记。':'No direct Build-on in this range; read both students’ Notes first.'}</small></>:<p>{nameOf(row.a)} → {nameOf(row.b)}：{row.aToB} · {nameOf(row.b)} → {nameOf(row.a)}：{row.bToA}</p>}</div>
      <button type="button" onClick={()=>onPick(row.noteIds,`${nameOf(row.a)} · ${nameOf(row.b)}`)}>{zh?'查看双方笔记':'Read both peers’ Notes'}</button>
    </li>)}</ul>}
    {rows.length>limit&&<button type="button" className="da-more" onClick={()=>setLimit(n=>n+20)}>{zh?'查看更多':'Show more'}</button>}
    {kind==='read'&&data.candidateCount>data.candidates.length&&<p className="da-chart-caption">{zh?'最多展示 80 组候选。':'Up to 80 candidate pairs are shown.'}</p>}
    <p className="da-chart-caption">{zh?'已有交流来自真实采用的 Build-on。共同词只是阅读线索，不表示观点一致，也不自动建立连接。':'Exchanges use actual adopted Build-on. Shared words invite reading; they do not imply agreement or create links.'}</p>
  </div>;
}

export function TopicCoverage({data,lang,onSave,onPick}:{data:SpaceTopicCoverage;lang:'zh'|'en';onSave:(topics:AnalyticsTopic[],revision:string|null)=>Promise<void>;onPick:(ids:string[],label:string)=>void}) {
  const zh=lang==='zh';const [editing,setEditing]=useState(false),[draft,setDraft]=useState<Array<{id:string;title:string;terms:string}>>([]),[revision,setRevision]=useState<string|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const edit=()=>{setDraft(data.config.topics.map(t=>({...t,terms:t.terms.join('，')})));setRevision(data.config.revision);setError('');setEditing(true);};
  const change=(i:number,key:'title'|'terms',value:string)=>setDraft(rows=>rows.map((r,j)=>i===j?{...r,[key]:value}:r));
  const save=async(e:React.FormEvent)=>{e.preventDefault();setError('');setSaving(true);try{await onSave(draft.map(t=>({...t,terms:t.terms.split(/[,，;；\n]+/).map(w=>w.trim()).filter(Boolean)})),revision);setEditing(false);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSaving(false);}};
  return <div className="da-topic-panel">
    <div className="da-topic-top"><span>{zh?'教师设定的讨论范围':'Teacher-defined discussion scope'}</span><button type="button" onClick={edit} disabled={editing}>{zh?'设置主题':'Set topics'}</button></div>
    {editing&&<form className="da-topic-editor" onSubmit={save}>
      <p>{zh?'每个主题填写任一关键词即可命中；用逗号分隔。最多 12 个主题，每组 20 个词，关键词 2–30 字。保存后同空间的教师共享。':'Any keyword can match a topic. Separate keywords with commas; up to 12 topics and 20 keywords per topic (2–30 characters). Saved topics are shared with teachers of this space.'}</p>
      {draft.map((t,i)=><div className="da-topic-draft" key={t.id}><label>{zh?`主题 ${i+1}`:`Topic ${i+1}`}<input aria-label={zh?`主题 ${i+1} 名称`:`Topic ${i+1} title`} required maxLength={60} value={t.title} onChange={e=>change(i,'title',e.target.value)} disabled={saving}/></label><label>{zh?'关键词':'Keywords'}<textarea aria-label={zh?`主题 ${i+1} 关键词`:`Topic ${i+1} keywords`} required maxLength={620} value={t.terms} onChange={e=>change(i,'terms',e.target.value)} disabled={saving}/></label><button type="button" disabled={saving} onClick={()=>setDraft(rows=>rows.filter((_,j)=>j!==i))}>{zh?'移除':'Remove'}</button></div>)}
      <div className="da-topic-editor-actions"><button type="button" disabled={draft.length>=12||saving} onClick={()=>setDraft(rows=>[...rows,{id:crypto.randomUUID(),title:'',terms:''}])}>{zh?'添加主题':'Add topic'}</button><button type="submit" disabled={saving}>{saving?(zh?'保存中…':'Saving…'):(zh?'保存主题':'Save topics')}</button><button type="button" disabled={saving} onClick={()=>setEditing(false)}>{zh?'取消':'Cancel'}</button></div>
      {error&&<p role="alert" className="da-notice">{error}</p>}
    </form>}
    {!data.config.topics.length&&!editing&&<p className="da-empty">{zh?'先设置本次讨论主题，再查看哪些内容已被提及、哪些还少有人讨论。':'Set the discussion topics to see what has been mentioned and what needs attention.'}</p>}
    {!data.available&&<p className="da-notice" role="status">{zh?'关键词匹配暂不可用，已保存的主题仍可编辑。':'Keyword matching is unavailable; saved topics can still be edited.'}</p>}
    {!!data.topics.length&&<><p className="da-chart-caption">{data.students} {zh?'位学生':'students'} · {data.docs} {zh?'篇笔记。条形表示提及主题的学生比例。':'notes. Bars show the share of students mentioning a topic.'}</p><div className="da-chart-scroll da-topic-visual"><svg className="da-topic-chart" viewBox={`0 0 720 ${data.topics.length*70+12}`} role="img" aria-label={zh?'主题提及范围':'Topic mentions'}>
      {data.topics.map((t,i)=><g key={t.id} className="da-keyword-row" transform={`translate(0,${i*70+12})`} role="button" tabIndex={0} aria-label={`${t.title}: ${t.students}/${data.students}`} onClick={()=>onPick(t.note_ids,t.title)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPick(t.note_ids,t.title);}}}>
        <rect x={0} y={-4} width={720} height={58} fill="transparent"/><title>{t.title+' · '+t.terms.join(', ')}</title><text x={0} y={16} className="da-change-word">{t.title.length>15?t.title.slice(0,15)+'…':t.title}</text><rect x={190} y={1} width={330} height={20} rx={5} className="da-bar-track"/><rect x={190} y={1} width={330*t.students/Math.max(1,data.students)} height={20} rx={5} fill="#6173b9"/>
        <text x={540} y={16} className="da-change-value">{t.students}/{data.students} {zh?'人':'students'} · {t.notes} {zh?'篇':'notes'}</text><text x={190} y={43} className="da-change-value">{t.terms.join(' · ').slice(0,65)}</text>
      </g>)}
    </svg></div>
      <div className="da-topic-mobile">{data.topics.map(t=><button type="button" key={t.id} onClick={()=>onPick(t.note_ids,t.title)}><span className="da-topic-mobile-title"><strong>{t.title}</strong><span>{t.students}/{data.students} {zh?'人':'students'} · {t.notes} {zh?'篇':'notes'}</span></span><span className="da-topic-mobile-track"><i style={{width:`${100*t.students/Math.max(1,data.students)}%`}}/></span><small>{t.terms.join(' · ')}</small></button>)}</div>
      {!!data.topics.some(t=>t.peer_note_ids.length)&&<div className="da-topic-peer-reads"><span>{zh?'可继续阅读的同伴主题：':'Peer topics to read: '}</span>{data.topics.filter(t=>t.peer_note_ids.length).map(t=><button type="button" key={t.id} onClick={()=>onPick(t.peer_note_ids,zh?`${t.title} · 同伴笔记`:`${t.title} · peer Notes`)}>{t.title}</button>)}</div>}
    </>}
    <p className="da-chart-caption">{zh?'命中任一关键词即计为提及；不判断赞同、理解或掌握。请查看原文确认。':'A keyword match counts as a mention, without judging agreement, understanding or mastery. Inspect the sources.'}</p>
  </div>;
}
