import {describe,it,expect} from 'vitest';
import {validateTopics} from './analyticsTopics';
describe('teacher-defined topics',()=>{
 it('清理关键词并拒绝空主题、重复 ID 和超限输入',()=>{
  expect(validateTopics([{id:'t1',title:'  检索练习 ',terms:[' Retrieval ','retrieval','检索练习']}])).toEqual([{id:'t1',title:'检索练习',terms:['Retrieval','检索练习']}]);
  expect(()=>validateTopics([{id:'t1',title:'',terms:['检索练习']}])).toThrow();
  expect(()=>validateTopics([{id:'t1',title:'a',terms:['AI']},{id:'t1',title:'b',terms:['AI']}])).toThrow();
  expect(()=>validateTopics(Array.from({length:13},(_,i)=>({id:String(i),title:'x',terms:['AI']})))).toThrow();
 });
});
