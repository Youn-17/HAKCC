import {useEffect,useRef,type RefObject} from 'react';
import type {Edge,Note} from '../types';
import {useInteractionMotion} from './useInteractionMotion';
export function useWorkspaceNoteMotion(root:RefObject<HTMLElement|null>,scope:string,loading:boolean,notes:Note[],edges:Edge[],highlight:ReadonlySet<string>,highlightKey:number,saved:{id:string;serial:number}|null) {
 const motion=useInteractionMotion();
 const known=useRef<{scope:string;ready:boolean;notes:Set<string>;edges:Set<string>}>({scope:'',ready:false,notes:new Set(),edges:new Set()});
 useEffect(()=>{
  const state=known.current;const ids=notes.filter(n=>!n.id.startsWith('temp-')).map(n=>n.id),edgeIds=edges.filter(e=>!e.id.startsWith('e-temp-')).map(e=>e.id);
  if(state.scope!==scope){motion.stop();known.current={scope,ready:false,notes:new Set(),edges:new Set()};}
  const current=known.current;
  if(loading){current.ready=false;return;}
  if(!current.ready){current.notes=new Set(ids);current.edges=new Set(edgeIds);current.ready=true;return;}
  const newNotes=new Set(ids.filter(id=>!current.notes.has(id))),newEdges=new Set(edgeIds.filter(id=>!current.edges.has(id)));
  ids.forEach(id=>current.notes.add(id));edgeIds.forEach(id=>current.edges.add(id));
  if(newNotes.size){
   for(const card of root.current?.querySelectorAll<HTMLElement>('[data-note-id]')??[]){if(newNotes.has(card.dataset.noteId!))motion.highlight(card,`note:${card.dataset.noteId}`);}
  }
  if(newEdges.size){
   const paths=[...(root.current?.querySelectorAll<SVGPathElement>('path[data-motion-edge]')??[])].filter(path=>newEdges.has(path.dataset.motionEdge!));
   if(paths.length)motion.draw(paths,'new-relations');
  }
 },[scope,loading,notes,edges,motion,root]);
 useEffect(()=>{
  if(!highlightKey)return;
  for(const card of root.current?.querySelectorAll<HTMLElement>('[data-note-id]')??[])if(highlight.has(card.dataset.noteId!))motion.highlight(card,`locate:${card.dataset.noteId}`);
 },[highlightKey,motion,root,highlight]);
 useEffect(()=>{if(saved){const card=[...(root.current?.querySelectorAll<HTMLElement>('[data-note-id]')??[])].find(el=>el.dataset.noteId===saved.id);if(card)motion.highlight(card,'note-saved');}},[saved,motion,root]);
}
