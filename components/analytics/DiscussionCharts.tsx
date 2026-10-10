import React from 'react';
import type { SpaceKeywordChanges } from '../../services/apiClient';

type Lang = 'zh' | 'en';
const activate = (event: React.KeyboardEvent, action: () => void) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
};

export function KeywordChangeChart({data,lang,onPick}:{data:SpaceKeywordChanges;lang:Lang;onPick:(ids:string[],label:string)=>void}) {
  const zh=lang==='zh';
  if(!data.available) return <p className="da-empty">{zh?'关键词暂时无法生成，请稍后重试。':'Keywords are unavailable. Try again later.'}</p>;
  if(!data.terms.length) return <p className="da-empty">{zh?'这个范围还没有可比较的关键词。':'No keywords to compare in this range.'}</p>;
  const comparable=data.periods.before.docs>0 && data.periods.after.docs>0;
  return <>
    <div className="da-periods"><span><i className="da-before-dot" />{zh?'前段':'Earlier'} · {data.periods.before.docs} {zh?'篇':'notes'}</span><span><i className="da-after-dot" />{zh?'后段':'Later'} · {data.periods.after.docs} {zh?'篇':'notes'}</span></div>
    {!comparable && <p className="da-notice">{zh?'其中一段没有笔记，暂不比较变化幅度。':'One period has no notes; changes are not compared.'}</p>}
    <div className="da-chart-scroll"><svg viewBox={`0 0 760 ${data.terms.length*62+32}`} role="img" aria-label={zh?'关键词前后变化':'Keyword changes'} className="da-change-chart">
      {data.terms.map((t,i)=>{
        const before=t.before.notes/Math.max(1,data.periods.before.docs),after=t.after.notes/Math.max(1,data.periods.after.docs);
        const ids=[...new Set([...t.before.note_ids,...t.after.note_ids])];
        const pick=()=>onPick(ids,t.word);
        return <g key={t.word} transform={`translate(0,${i*62+20})`} role="button" tabIndex={0} aria-label={t.word} onClick={pick} onKeyDown={e=>activate(e,pick)} className="da-keyword-row">
          <text x="8" y="16" className="da-change-word">{t.word.slice(0,12)}</text>
          <rect x="150" y="0" width="350" height="11" rx="5" className="da-bar-track" />
          <rect x="150" y="0" width={before*350} height="11" rx="5" fill="#94a3b8" />
          <rect x="150" y="18" width="350" height="11" rx="5" className="da-bar-track" />
          <rect x="150" y="18" width={after*350} height="11" rx="5" fill="#4556a6" />
          <text x="516" y="10" className="da-change-value">{Math.round(before*100)}% · {t.before.count} {zh?'次':'times'}</text>
          <text x="516" y="28" className="da-change-value">{Math.round(after*100)}% · {t.after.count} {zh?'次':'times'}</text>
          <text x="680" y="19" className="da-change-value">{comparable?`${t.delta>0?'+':''}${Math.round(t.delta*100)} ${zh?'百分点':'pp'}`:'—'}</text>
          <title>{t.word}</title>
        </g>;
      })}
    </svg></div>
  </>;
}
