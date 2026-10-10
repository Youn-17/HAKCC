import {describe,it,expect} from 'vitest';
import {buildPeerConnections} from './peerConnections';
import type {AnalyticsInput} from './spaceAnalytics';
const note=(id:string,authorId:string)=>({id,authorId,title:id,content:'检索练习',createdAt:'2026-10-08T00:00:00Z',updatedAt:null,authorName:null,type:'note',aiGenerated:false,views:[]});
const input:AnalyticsInput={members:['a','b','c','quiet'].map(id=>({id,name:id,avatar:null,isStaff:false})),notes:[note('a1','a'),note('b1','b'),note('c1','c')],relations:[{source:'b1',target:'a1',type:'extend',createdAt:'2026-10-08T01:00:00Z',aiSuggested:false,aiAccepted:null}],feedbacks:[],aiUse:new Map(),scaffolds:new Map(),now:new Date()};
describe('peer reading invitations',()=>{
 it('区分已有交流和共同关注候选，来源包含双方；零笔记成员保留，个人只看自己的连接',()=>{
  const focus=['a','b','c'].map(id=>({id,terms:[{word:'检索练习',note_ids:[id+'1']}]}));
  const whole=buildPeerConnections(input,focus);
  expect(whole.connections).toEqual([expect.objectContaining({a:'a',b:'b',aToB:0,bToA:1,noteIds:['a1','b1']})]);
  expect(whole.candidates.map(c=>[c.a,c.b])).toEqual([['a','c'],['b','c']]);
  expect(whole.members.find(m=>m.id==='quiet')).toMatchObject({notes:0,peers:0});
  const personal=buildPeerConnections(input,focus,{authorId:'a'});
  expect(personal.candidates).toEqual([expect.objectContaining({a:'a',b:'c',words:['检索练习'],noteIds:['a1','c1']})]);
 });
});
