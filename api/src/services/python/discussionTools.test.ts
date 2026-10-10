import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {TEXT_WORKER_SOURCE} from './textWorkerSource';
const python=process.env.HAKCC_PYTHON||'python3';
const available=spawnSync(python,['-c','import jieba,wordcloud']).status===0;
function run(op:string,payload:unknown){const r=spawnSync(python,['-u','-c',TEXT_WORKER_SOURCE],{input:JSON.stringify({id:1,op,payload})+'\n',encoding:'utf8',timeout:20000});expect(r.status).toBe(0);const message=JSON.parse(r.stdout.trim().split('\n').at(-1)!);expect(message.ok).toBe(true);return message.result;}
describe.skipIf(!available)('Python discussion tools',()=>{
 it('每人关注词带本人来源，姓名和指定停用词排除',()=>{
  const r=run('focus',{names:['Amy'],extra_words:['检索练习'],extra_stop:['证据'],docs:[{id:'a1',authorId:'a',text:'Amy 检索练习 证据'},{id:'b1',authorId:'b',text:'检索练习'}]});
  expect(r.authors.find((a:{id:string})=>a.id==='a').terms).toEqual([expect.objectContaining({word:'检索练习',note_ids:['a1']})]);
 });
 it('教师主题按任一关键词命中，英文有词界；个人覆盖保留同伴阅读来源，空主题也显示',()=>{
  const r=run('topics',{author_id:'a',docs:[{id:'a1',authorId:'a',text:'检索练习与记忆'},{id:'b1',authorId:'b',text:'Retrieval practice'},{id:'b2',authorId:'b',text:'said'}],topics:[{id:'t1',title:'检索练习',terms:['检索练习','retrieval']},{id:'t2',title:'AI',terms:['AI']}]});
  expect(r.topics[0]).toMatchObject({notes:1,students:1,note_ids:['a1'],peer_note_ids:['b1']});
  expect(r.topics[1]).toMatchObject({notes:0,students:0,note_ids:[],peer_note_ids:[]});
  expect(r.docs).toBe(1);
 });
});
