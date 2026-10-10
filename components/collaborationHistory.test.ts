// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({editable:[] as boolean[]}));
vi.mock('@tiptap/react',()=>({useEditor:(options:{editable:boolean;content:unknown})=>{state.editable.push(options.editable);return {content:options.content,commands:{setContent:()=>{}}};},EditorContent:({editor}:{editor:{content:unknown}})=>React.createElement('div',null,JSON.stringify(editor.content))}));
vi.mock('../hooks/useInteractionMotion',()=>({useInteractionMotion:()=>motion}));
const motion={enter:vi.fn(),stop:vi.fn()};
import CollaborationHistory from './CollaborationHistory';
import type {CollaborationAdapter,CollaborationSnapshotContent} from '../services/collaborativeDocuments';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root|undefined;
afterEach(()=>{act(()=>root?.unmount());document.body.innerHTML='';vi.clearAllMocks();state.editable=[];});
it('历史阅读忽略迟到的旧请求，切换显示保存正文且始终只读',async()=>{
 let resolveFirst!:(value:CollaborationSnapshotContent)=>void;
 const snapshot=(id:number,text:string)=>({id,version:id,created_at:'2026-10-10T00:00:00Z',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}});
 const adapter={snapshots:vi.fn(async()=>[snapshot(2,'new'),snapshot(1,'old')]),readSnapshot:vi.fn((id:number)=>id===2?new Promise<CollaborationSnapshotContent>(r=>resolveFirst=r):Promise.resolve(snapshot(1,'旧版证据')))} as unknown as CollaborationAdapter;
 const node=document.createElement('div');document.body.append(node);root=createRoot(node);
 await act(async()=>root!.render(React.createElement(CollaborationHistory,{adapter,revision:0,onClose:()=>{}})));
 const oldButton=[...node.querySelectorAll('button')].find(b=>b.textContent?.includes('版本 1'))!;
 await act(async()=>oldButton.click());expect(node.textContent).toContain('旧版证据');expect(state.editable.every(v=>v===false)).toBe(true);
 await act(async()=>resolveFirst(snapshot(2,'迟到的新版本')));expect(node.textContent).toContain('旧版证据');expect(node.textContent).not.toContain('迟到的新版本');
 expect(adapter.readSnapshot).toHaveBeenCalledTimes(2);
});
it('读取失败显示错误，不把当前共编内容当成历史版本',async()=>{
 const adapter={snapshots:async()=>[{id:1,version:1,created_at:'2026-10-10T00:00:00Z'}],readSnapshot:async()=>{throw new Error('404');}} as unknown as CollaborationAdapter;
 const node=document.createElement('div');document.body.append(node);root=createRoot(node);
 await act(async()=>root!.render(React.createElement(CollaborationHistory,{adapter,revision:0,onClose:()=>{}})));
 expect(node.querySelector('[role="alert"]')?.textContent).toContain('暂时无法打开');expect(node.querySelector('.collab-history-preview')?.textContent).toBe('');
});
