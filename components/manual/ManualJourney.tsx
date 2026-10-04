import React, { useState } from 'react';
import RemixIcon from '../RemixIcon';

const stages = [
  { id:'write', title:{zh:'提出解释',en:'Offer an explanation'}, name:'Note', description:{zh:'把一个明确的想法写出来，补充你的理由或证据，让同学有内容可以回应。',en:'Write a specific idea and its reasons or evidence, giving classmates something to respond to.'}, action:{zh:'学习撰写 Note',en:'Learn to write a Note'} },
  { id:'buildon', title:{zh:'回应与推进',en:'Respond and advance'}, name:'Build-on', description:{zh:'选择一条相关 Note，澄清、质疑或补充证据，说明你的贡献怎样推进原来的想法。',en:'Select a related Note. Clarify, challenge or add evidence, showing how your contribution moves the idea forward.'}, action:{zh:'学习 Build-on',en:'Learn about Build-on'} },
  { id:'riseabove', title:{zh:'形成新的理解',en:'Reach a new understanding'}, name:'Rise-above', description:{zh:'把不同解释放在一起，找出它们的联系与分歧，形成可以继续改进的新解释。',en:'Bring different explanations together, examine their connections and tensions, and form a new account to improve further.'}, action:{zh:'学习综合升华',en:'Learn about Rise-above'} },
] as const;

export default function ManualJourney({ zh, onNavigate }: { zh:boolean; onNavigate:(id:string)=>void }) {
  const [selected,setSelected]=useState(0);
  const stage=stages[selected];
  return <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/80 p-5 sm:p-7 dark:border-slate-700 dark:bg-slate-900/60">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-slate-500">{zh?'知识建构路径':'The knowledge-building path'}</p>
      <span className="font-mono text-[0.625rem] text-slate-400">01 → 03</span>
    </div>
    <svg viewBox="0 0 540 188" role="img" aria-label={zh?'一条 Note 通过 Build-on 连接不同想法，再汇聚成新的理解。':'A Note connects to other ideas through Build-on, then contributes to a new understanding.'} className="my-5 h-auto w-full text-slate-400">
      <path d="M110 94 H176 M330 94 H398" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <path d="m170 90 6 4-6 4m222-4 6 4-6 4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <g opacity={selected===0?1:0.45} className="transition-opacity duration-300">
        <rect x="18" y="55" width="92" height="76" rx="9" fill="var(--manual-paper)" stroke="var(--manual-accent)" strokeWidth="1.5"/>
        <path d="M33 75 H80 M33 90 H94 M33 103 H87 M33 116 H65" stroke="var(--manual-accent)" strokeWidth="2" strokeLinecap="round" opacity="0.65"/>
      </g>
      <g opacity={selected===1?1:0.45} className="transition-opacity duration-300">
        <path d="M207 88 C250 88 240 39 278 39 M207 88 C250 88 240 139 278 139" fill="none" stroke="var(--manual-accent)" strokeWidth="1.5"/>
        {[[179,66],[278,17],[278,117]].map(([x,y],i)=><g key={i}><rect x={x} y={y} width="50" height="43" rx="6" fill="var(--manual-paper)" stroke="var(--manual-accent)" strokeWidth="1.5"/><path d={`M${x+10} ${y+14} h28 m-28 9 h21 m-21 9 h25`} stroke="var(--manual-accent)" strokeWidth="1.5" opacity="0.6"/></g>)}
      </g>
      <g opacity={selected===2?1:0.45} className="transition-opacity duration-300">
        <path d="M413 147 Q413 113 458 82 M458 147 V82 M503 147 Q503 113 458 82" fill="none" stroke="var(--manual-accent)" strokeWidth="1.5"/>
        {[403,448,493].map(x=><rect key={x} x={x} y="143" width="20" height="17" rx="3" fill="var(--manual-paper)" stroke="var(--manual-accent)"/>)}
        <rect x="405" y="27" width="108" height="57" rx="8" fill="var(--manual-paper)" stroke="var(--manual-accent)" strokeWidth="1.5"/>
        <path d="M420 44 H488 M420 56 H497 M420 68 H469" stroke="var(--manual-accent)" strokeWidth="2" opacity="0.65"/>
      </g>
    </svg>
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-3" role="group" aria-label={zh?'选择知识建构阶段':'Choose a stage'}>
      {stages.map((item,index)=><button type="button" key={item.id} aria-pressed={selected===index} onClick={()=>setSelected(index)}
        className={`flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:block ${selected===index?'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white':'text-slate-500 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-800/50'}`}>
        <span className="font-mono text-[0.625rem] text-slate-400 sm:mr-1.5">0{index+1}</span><span className="text-xs font-semibold">{item.name}</span>
        <span className="text-[0.6875rem] sm:mt-1 sm:block">{zh?item.title.zh:item.title.en}</span>
      </button>)}
    </div>
    <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700" aria-live="polite">
      <p className="min-h-[4.5rem] text-sm leading-7 text-slate-600 dark:text-slate-300">{zh?stage.description.zh:stage.description.en}</p>
      <button type="button" onClick={()=>onNavigate(stage.id)} className="mt-2 flex min-h-10 items-center gap-2 text-xs font-semibold text-[var(--manual-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">{zh?stage.action.zh:stage.action.en}<RemixIcon name="arrow-right-line" size={16}/></button>
    </div>
    <p className="mt-3 text-[0.6875rem] leading-5 text-slate-500">{zh?'新的理解仍是一条可改进的 Note，讨论可以继续。':'A new understanding is still an improvable Note. The discussion continues.'}</p>
  </div>;
}
