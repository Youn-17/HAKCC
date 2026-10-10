import React,{useEffect,useRef,useState} from 'react';
import {EditorContent,useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import {TableKit} from '@tiptap/extension-table';
import type {CollaborationAdapter,CollaborationSnapshot,CollaborationSnapshotContent} from '../services/collaborativeDocuments';
import {useInteractionMotion} from '../hooks/useInteractionMotion';
import RemixIcon from './RemixIcon';
/** Read-only historical documents never join the live Yjs room. */
export default function CollaborationHistory({adapter,revision,onClose}:{adapter:CollaborationAdapter;revision:number;onClose():void}){
 const [versions,setVersions]=useState<CollaborationSnapshot[]>([]),[selected,setSelected]=useState<number|null>(null),[snapshot,setSnapshot]=useState<CollaborationSnapshotContent|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reading,setReading]=useState(false);
 const pane=useRef<HTMLElement>(null);const motion=useInteractionMotion();
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;pane.current?.querySelector<HTMLButtonElement>('header button')?.focus();motion.enter(pane.current?[pane.current]:[],'version-panel');return()=>{motion.stop();if(previous?.isConnected)previous.focus();};},[motion]);
 useEffect(()=>{let live=true;setLoading(true);setError('');adapter.snapshots!().then(items=>{if(live){setVersions(items);setSelected(previous=>items.some(v=>v.id===previous)?previous:items[0]?.id??null);}}).catch(()=>{if(live)setError('暂时无法读取版本，请关闭后重试。');}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[adapter,revision]);
 useEffect(()=>{let live=true;setSnapshot(null);setError('');if(selected==null){setReading(false);return;}
  setReading(true);adapter.readSnapshot!(selected).then(value=>{if(live)setSnapshot(value);}).catch(()=>{if(live)setError('这个版本暂时无法打开，可能已超过保留期限。');}).finally(()=>{if(live)setReading(false);});return()=>{live=false;};
 },[adapter,selected]);
 useEffect(()=>{if(snapshot){const target=pane.current?.querySelector<HTMLElement>('.collab-history-preview');if(target)motion.enter([target],'version-preview');}},[snapshot,motion]);
 return <aside ref={pane} className="collab-history" aria-label="版本记录">
  <header><div><h2>版本记录</h2><span>历史版本只读，当前文档继续同步</span></div><button aria-label="关闭版本记录" onClick={onClose}><RemixIcon name="close-line" size={18}/></button></header>
  {error&&<p role="alert">{error}</p>}
  <div className="collab-history-list" aria-label="已保存版本">{loading?<p role="status">正在读取版本…</p>:versions.length?versions.map(v=><button key={v.id} aria-pressed={selected===v.id} onClick={()=>setSelected(v.id)}><RemixIcon name="history-line" size={16}/><span><strong>版本 {v.version}</strong><time>{new Date(v.created_at).toLocaleString()}</time></span></button>):<p>暂无版本快照</p>}</div>
  <section className="collab-history-preview" aria-label="历史版本正文" aria-busy={reading}>{reading?<p role="status">正在打开版本…</p>:snapshot?<SnapshotDocument snapshot={snapshot}/>:null}</section>
  <button className="collab-history-return" onClick={onClose}>返回当前文档<RemixIcon name="arrow-right-line" size={16}/></button>
 </aside>;
}
function SnapshotDocument({snapshot}:{snapshot:CollaborationSnapshotContent}){
 const editor=useEditor({extensions:[StarterKit,Image.configure({allowBase64:true}),TableKit],content:snapshot.content,editable:false,immediatelyRender:false});
 useEffect(()=>{editor?.commands.setContent(snapshot.content,{emitUpdate:false});},[editor,snapshot]);
 return <><p>版本 {snapshot.version} · 只读预览</p><EditorContent editor={editor}/></>;
}
