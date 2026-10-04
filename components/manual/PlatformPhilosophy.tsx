import React, { useEffect, useMemo, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import {
  PHILOSOPHY_INTRO, PHILOSOPHY_SECTIONS, REFERENCES,
  type Bilingual, type Reference,
} from './philosophyContent';

/**
 * 平台理念页。
 *
 * 和使用手册是姊妹页：手册回答「怎么用」，这里回答「凭什么这样设计」。
 * 结构是 章节 → 主张 → 落实 → 文献。文献卡片把「这篇说了什么」和
 * 「我们据此做了什么」并排放，读者不必来回翻——文献和功能的对应关系
 * 就是这一页要交付的东西。
 */

interface Props {
  lang: 'zh' | 'en';
}

const pick = (b: Bilingual, zh: boolean) => (zh ? b.zh : b.en);

/** 行内 `等宽` 标记，和手册一致；不走 HTML。 */
function inline(text: string, k: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined
      ? <strong key={`${k}-b${i}`} className="font-semibold text-slate-900 dark:text-slate-100">{m[1]}</strong>
      : <code key={`${k}-c${i}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-700 dark:bg-slate-800 dark:text-slate-300">{m[2]}</code>);
    last = m.index + m[0].length; i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const REF_BY_ID = new Map(REFERENCES.map(r => [r.id, r]));

const RefCard: React.FC<{ ref_: Reference; zh: boolean; k: string }> = ({ ref_, zh, k }) => {
  const link = ref_.doi ? `https://doi.org/${ref_.doi}` : ref_.url;
  return (
    <article id={`ref-${ref_.id}`} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60 sm:p-5">
      <header className="mb-3">
        <p className="text-[0.8125rem] leading-6 text-slate-800 dark:text-slate-100">
          <span className="font-semibold">{ref_.authors}</span> ({ref_.year}). {ref_.title}.{' '}
          <span className="italic text-slate-600 dark:text-slate-300">{ref_.venue}</span>.
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem]">
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 font-mono text-[var(--manual-accent)] underline decoration-[var(--manual-accent)]/40 underline-offset-2 hover:decoration-[var(--manual-accent)]">
              <RemixIcon name="external-link-line" size={12} />{ref_.doi ? `doi:${ref_.doi}` : (zh ? '原文' : 'Source')}
            </a>
          )}
          {ref_.status && (
            <span className="rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              {pick(ref_.status, zh)}
            </span>
          )}
        </div>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-slate-400">{zh ? '这篇文献说了什么' : 'What the paper says'}</p>
          <p className="text-[0.8125rem] leading-[1.85] text-slate-600 dark:text-slate-300">{inline(pick(ref_.said, zh), `${k}-s`)}</p>
        </div>
        <div className="md:border-l md:border-slate-200 md:pl-4 md:dark:border-slate-700">
          <p className="mb-1 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--manual-accent)]">{zh ? '我们据此做了什么' : 'What we did with it'}</p>
          <p className="text-[0.8125rem] leading-[1.85] text-slate-700 dark:text-slate-200">{inline(pick(ref_.applied, zh), `${k}-a`)}</p>
        </div>
      </div>
    </article>
  );
};

const PlatformPhilosophy: React.FC<Props> = ({ lang }) => {
  const zh = lang === 'zh';
  const [active, setActive] = useState('intro');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current; if (!root) return;
    const visible = new Set<string>();
    const order = ['intro', ...PHILOSOPHY_SECTIONS.map(s => s.id), 'refs'];
    const ob = new IntersectionObserver(entries => {
      entries.forEach(e => { const id = e.target.getAttribute('data-phil-section')!; if (e.isIntersecting) visible.add(id); else visible.delete(id); });
      const first = order.find(id => visible.has(id)); if (first) setActive(first);
    }, { root, threshold: 0, rootMargin: '-24px 0px -75% 0px' });
    root.querySelectorAll('[data-phil-section]').forEach(el => ob.observe(el));
    return () => ob.disconnect();
  }, []);

  const goTo = (id: string) => {
    const root = scrollRef.current; const el = root?.querySelector<HTMLElement>(`#phil-${id}`);
    if (root && el) root.scrollTo({ top: el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 24, behavior: 'instant' });
    setActive(id);
  };

  /** 文献总表按首作者姓氏排序，和论文参考文献的习惯一致 */
  const sortedRefs = useMemo(() => [...REFERENCES].sort((a, b) => a.authors.localeCompare(b.authors, 'en')), []);

  const navBtn = (id: string, label: string, num?: string) => (
    <button key={id} type="button" onClick={() => goTo(id)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.8125rem] transition-colors ${
        active === id
          ? 'bg-[var(--manual-accent)]/10 font-semibold text-[var(--manual-accent)]'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
      {num && <span className="font-mono text-[0.625rem] text-slate-400">{num}</span>}
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-white text-slate-800 [--manual-accent:#435f78] dark:bg-slate-950 dark:text-slate-100 dark:[--manual-accent:#afc8dc]">
      <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-slate-200 p-4 dark:border-slate-800 lg:block">
        <p className="mb-2 px-3 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-slate-400">{zh ? '章节' : 'Sections'}</p>
        <nav className="space-y-0.5">
          {navBtn('intro', zh ? '为什么有这一页' : 'Why this page')}
          {PHILOSOPHY_SECTIONS.map(s => navBtn(s.id, pick(s.title, zh).split(/[：:]/)[0], s.num))}
          {navBtn('refs', zh ? `参考文献（${REFERENCES.length}）` : `References (${REFERENCES.length})`)}
        </nav>
      </aside>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-8 sm:px-7 lg:px-10 lg:pt-12">
          <header id="phil-intro" data-phil-section="intro">
            <p className="mb-5 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[var(--manual-accent)]">
              <span className="h-px w-6 bg-current" />HAKCC · {zh ? '平台理念' : 'Design rationale'}
            </p>
            <h1 className="text-3xl font-semibold leading-[1.3] tracking-tight sm:text-4xl">
              {zh ? '每一项设计，' : 'Every design decision,'}<br />
              <span className="text-slate-500 dark:text-slate-400">{zh ? '凭什么这样做。' : 'and the grounds for it.'}</span>
            </h1>
            <p className="mt-5 max-w-[62ch] text-sm leading-8 text-slate-600 dark:text-slate-300">{pick(PHILOSOPHY_INTRO, zh)}</p>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {[
                { n: PHILOSOPHY_SECTIONS.length, zh: '个章节', en: 'sections' },
                { n: PHILOSOPHY_SECTIONS.reduce((a, s) => a + s.principles.length, 0), zh: '条主张', en: 'claims' },
                { n: REFERENCES.length, zh: '篇核对过的文献', en: 'verified references' },
              ].map(x => (
                <div key={x.en} className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                  <p className="text-2xl font-semibold tabular-nums tracking-tight">{x.n}</p>
                  <p className="text-xs text-slate-500">{zh ? x.zh : x.en}</p>
                </div>
              ))}
            </div>
          </header>

          {PHILOSOPHY_SECTIONS.map(section => (
            <section key={section.id} id={`phil-${section.id}`} data-phil-section={section.id} className="mt-14 lg:mt-20">
              <div className="mb-6 flex items-start gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
                <span className="pt-1 font-mono text-xs text-[var(--manual-accent)]">{section.num}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{pick(section.title, zh)}</h2>
                  <p className="mt-3 max-w-[70ch] text-sm leading-[1.95] text-slate-600 dark:text-slate-300">{pick(section.lead, zh)}</p>
                </div>
              </div>

              <div className="space-y-10">
                {section.principles.map((p, pi) => (
                  <div key={pi} className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] xl:gap-9">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">{pick(p.claim, zh)}</h3>
                      <p className="mb-2 mt-4 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-slate-400">{zh ? '在平台上怎么落实' : 'How it lands in the interface'}</p>
                      <ul className="space-y-2">
                        {p.how.map((h, hi) => (
                          <li key={hi} className="flex gap-2.5 text-[0.8125rem] leading-[1.8] text-slate-600 dark:text-slate-300">
                            <span className="mt-[10px] h-[3px] w-[3px] shrink-0 rounded-full bg-[var(--manual-accent)]" />
                            <span>{inline(pick(h, zh), `${section.id}-${pi}-${hi}`)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="min-w-0 space-y-3">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-slate-400">{zh ? '文献依据' : 'Grounding'}</p>
                      {p.refs.map(id => { const r = REF_BY_ID.get(id); return r ? <RefCard key={id} ref_={r} zh={zh} k={`${section.id}-${pi}-${id}`} /> : null; })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section id="phil-refs" data-phil-section="refs" className="mt-14 lg:mt-20">
            <div className="mb-6 border-b border-slate-200 pb-5 dark:border-slate-800">
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{zh ? '参考文献' : 'References'}</h2>
              <p className="mt-2 text-xs text-slate-500">{zh ? '按首作者排序。每条均核对过出处、卷期与页码；点击可打开原文或 DOI。' : 'Sorted by first author. Each entry checked against its source; click to open the DOI or original.'}</p>
            </div>
            <ol className="space-y-3">
              {sortedRefs.map((r, i) => {
                const link = r.doi ? `https://doi.org/${r.doi}` : r.url;
                return (
                  <li key={r.id} className="flex gap-3 text-[0.8125rem] leading-[1.8] text-slate-700 dark:text-slate-300">
                    <span className="w-6 shrink-0 pt-px font-mono text-[0.6875rem] text-slate-400 tabular-nums">{i + 1}</span>
                    <span>
                      {r.authors} ({r.year}). {r.title}. <i>{r.venue}</i>.
                      {link && <> <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono text-[0.75em] text-[var(--manual-accent)] underline underline-offset-2">{r.doi ? `doi:${r.doi}` : (zh ? '原文' : 'link')}</a></>}
                      {r.status && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[0.6875rem] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{pick(r.status, zh)}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PlatformPhilosophy;
