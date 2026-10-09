import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { TEXT_WORKER_SOURCE } from './textWorkerSource';
const python=process.env.HAKCC_PYTHON || 'python3';
const available=spawnSync(python,['-c','import jieba,wordcloud'],{encoding:'utf8'}).status===0;
describe.skipIf(!available)('Python keyword changes',()=>{
  it('同一词表比较前后两段，按涉及笔记的比例消除笔记数量差异，词能追溯到原文',()=>{
    const req={id:1,op:'changes',payload:{names:[],docs:[{id:'a',period:'before',text:'检索练习'},{id:'b',period:'after',text:'检索练习'},{id:'c',period:'after',text:'检索练习 间隔练习'}]}};
    const run=spawnSync(python,['-u','-c',TEXT_WORKER_SOURCE],{input:JSON.stringify(req)+'\n',encoding:'utf8',timeout:20000});
    expect(run.status).toBe(0);
    const result=JSON.parse(run.stdout.trim().split('\n').at(-1)!);
    expect(result.ok).toBe(true);
    const term=result.result.terms.find((t:{word:string})=>t.word==='检索练习');
    expect(term.before).toMatchObject({count:1,notes:1,note_ids:['a']});
    expect(term.after).toMatchObject({count:2,notes:2,note_ids:['b','c']});
    expect(term.delta).toBe(0);
    expect(result.result.periods.before.docs).toBe(1);
    expect(result.result.periods.after.docs).toBe(2);
  });
  it('课程词典和成员姓名按请求隔离，排除词支持英文大小写，笔记数不因来源列表截取而截断',()=>{
    const requests=[
      {id:1,op:'keywords',payload:{docs:[{id:'x',text:'星河课程 检索练习 Amy'}],names:['星河课程','Amy']}},
      {id:2,op:'keywords',payload:{docs:[{id:'y',text:'星河课程 检索练习 Amy'}],names:[],extra_words:['星河课程'],extra_stop:['AMY']}},
      {id:3,op:'keywords',payload:{docs:Array.from({length:250},(_,i)=>({id:String(i),text:'检索练习'})),names:[]}},
    ];
    const run=spawnSync(python,['-u','-c',TEXT_WORKER_SOURCE],{input:requests.map(r=>JSON.stringify(r)).join('\n')+'\n',encoding:'utf8',timeout:20000});
    expect(run.status).toBe(0);
    const results=run.stdout.trim().split('\n').map(line=>JSON.parse(line)).filter(r=>r.id!==null);
    expect(results[0].result.terms.map((t:{word:string})=>t.word)).not.toContain('Amy');
    expect(results[1].result.terms.map((t:{word:string})=>t.word)).toContain('星河课程');
    expect(results[1].result.terms.map((t:{word:string})=>t.word)).not.toContain('Amy');
    expect(results[2].result.terms[0]).toMatchObject({word:'检索练习',count:250,notes:250});
  });

});
