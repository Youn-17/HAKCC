// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const motion=vi.hoisted(()=>({highlight:vi.fn(),draw:vi.fn(),stop:vi.fn()}));
vi.mock('./useInteractionMotion',()=>({useInteractionMotion:()=>motion}));
import {useWorkspaceNoteMotion} from './useWorkspaceNoteMotion';
import type {Note,Edge} from '../types';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root|undefined;
afterEach(()=>{act(()=>root?.unmount());document.body.innerHTML='';vi.clearAllMocks();});
it('初始历史静态显示，临时 Note/连线不提示；确认后提示一次，重复定位和实际保存单独反馈',()=>{
 const node=document.createElement('div');document.body.append(node);root=createRoot(node);
 let scope='space:view';let ids=['existing'];let edges:string[]=[];let highlights=new Set<string>();let key=0;let saved:{id:string;serial:number}|null=null;
 const container={current:node};
 function Harness(){useWorkspaceNoteMotion(container,scope,false,ids.map(id=>({id})) as Note[],edges.map(id=>({id})) as Edge[],highlights,key,saved);return React.createElement('div',null,...ids.map(id=>React.createElement('div',{'data-note-id':id,key:id})),React.createElement('svg',null,...edges.map(id=>React.createElement('path',{'data-motion-edge':id,key:id}))));}
 const render=()=>act(()=>root!.render(React.createElement(Harness)));
 render();expect(motion.highlight).not.toHaveBeenCalled();expect(motion.draw).not.toHaveBeenCalled();
 ids.push('temp-1');edges.push('e-temp-1');render();expect(motion.highlight).not.toHaveBeenCalled();expect(motion.draw).not.toHaveBeenCalled();
 ids=['existing','confirmed'];edges=['edge-confirmed'];render();expect(motion.highlight.mock.calls.at(-1)?.[1]).toBe('note:confirmed');expect(motion.draw.mock.calls.at(-1)?.[0][0].dataset.motionEdge).toBe('edge-confirmed');
 render();expect(motion.highlight).toHaveBeenCalledTimes(1);expect(motion.draw).toHaveBeenCalledTimes(1);
 highlights=new Set(['existing']);key=1;render();key=2;render();expect(motion.highlight.mock.calls.filter(c=>c[1]==='locate:existing')).toHaveLength(2);
 saved={id:'existing',serial:1};render();expect(motion.highlight.mock.calls.at(-1)?.[1]).toBe('note-saved');
 scope='other:view';ids=['old-history'];edges=['old-edge'];saved=null;highlights=new Set();render();expect(motion.draw).toHaveBeenCalledTimes(1);expect(motion.stop).toHaveBeenCalled();
});
