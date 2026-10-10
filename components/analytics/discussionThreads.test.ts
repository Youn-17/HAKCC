import {describe,it,expect} from 'vitest';
import {discussionThreads} from './DiscussionThreads';
import type {SpaceDiscussion} from '../../services/apiClient';
it('循环与合流都只读一次，忽略断开的关系；每段按创建时间阅读',()=>{
 const notes=['a','b','c','d'].map((id,i)=>({id,title:id,authorId:id,createdAt:`2026-10-0${4-i}T00:00:00Z`,type:'note',excerpt:id,selected:false}));
 const data:SpaceDiscussion={members:[],notes,edges:[{from:'a',to:'b',type:'question',createdAt:''},{from:'b',to:'c',type:'evidence',createdAt:''},{from:'c',to:'a',type:'extend',createdAt:''},{from:'outside',to:'d',type:'extend',createdAt:''}],pending:[]};
 expect(discussionThreads(data).map(t=>t.map(n=>n.id))).toEqual([['c','b','a']]);
});
