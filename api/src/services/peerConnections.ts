import {buildDiscussion,type DiscussionFilter} from './discussionAnalytics';
import type {AnalyticsInput} from './spaceAnalytics';
export interface AuthorFocus {id:string;terms:Array<{word:string;note_ids:string[]}>}

/** Actual exchange is independent of lexical overlap. Candidate sources must belong to both peers. */
export function buildPeerConnections(input:AnalyticsInput,focus:AuthorFocus[],filter:DiscussionFilter={}) {
  const discussion=buildDiscussion(input,{...filter,authorId:null});
  const notes=new Map(discussion.notes.map(n=>[n.id,n]));
  const count=new Map<string,number>();for(const n of discussion.notes)count.set(n.authorId,(count.get(n.authorId)??0)+1);
  const pairs=new Map<string,{a:string;b:string;aToB:number;bToA:number;noteIds:string[]}>();
  for(const edge of discussion.edges){
    const parent=notes.get(edge.from)!,response=notes.get(edge.to)!;
    if(parent.authorId===response.authorId)continue;
    const [a,b]=[parent.authorId,response.authorId].sort();const key=JSON.stringify([a,b]);
    const pair=pairs.get(key)??{a,b,aToB:0,bToA:0,noteIds:[]};
    if(response.authorId===a)pair.aToB++;else pair.bToA++;
    pair.noteIds=[...new Set([...pair.noteIds,parent.id,response.id])];pairs.set(key,pair);
  }
  const memberIds=new Set(discussion.members.map(m=>m.id));
  const byWord=new Map<string,Array<{id:string;ids:string[]}>>();
  for(const author of focus){
    if(!memberIds.has(author.id))continue;
    for(const term of author.terms.slice(0,20)){
      const ids=term.note_ids.filter(id=>notes.get(id)?.authorId===author.id);if(!ids.length)continue;
      const key=term.word.toLocaleLowerCase();byWord.set(key,[...(byWord.get(key)??[]),{id:author.id,ids}]);
    }
  }
  const suggestions=new Map<string,{a:string;b:string;words:string[];noteIds:string[]}>();
  for(const [word,authors] of byWord)for(let i=0;i<authors.length;i++)for(let j=i+1;j<authors.length;j++){
    const first=authors[i],second=authors[j];if(first.id===second.id)continue;
    const [a,b]=[first.id,second.id].sort();if(filter.authorId&&a!==filter.authorId&&b!==filter.authorId)continue;
    const key=JSON.stringify([a,b]);if(pairs.has(key))continue;
    const pair=suggestions.get(key)??{a,b,words:[],noteIds:[]};
    if(!pair.words.includes(word))pair.words.push(word);
    pair.noteIds=[...new Set([...pair.noteIds,...first.ids,...second.ids])];suggestions.set(key,pair);
  }
  const candidates=[...suggestions.values()].sort((a,b)=>b.words.length-a.words.length||a.a.localeCompare(b.a)||a.b.localeCompare(b.b));
  return {
    members:discussion.members.map(m=>({...m,notes:count.get(m.id)??0,peers:[...pairs.values()].filter(p=>p.a===m.id||p.b===m.id).length})),
    connections:[...pairs.values()].filter(p=>!filter.authorId||p.a===filter.authorId||p.b===filter.authorId),
    candidates:candidates.slice(0,80).map(p=>({...p,words:p.words.slice(0,5),noteIds:[...p.noteIds.filter(id=>notes.get(id)?.authorId===p.a).slice(0,25),...p.noteIds.filter(id=>notes.get(id)?.authorId===p.b).slice(0,25)]})),candidateCount:candidates.length,
  };
}
