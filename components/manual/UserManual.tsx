import React, { useEffect, useMemo, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import { DemoStyles } from './ManualDemos';
import ManualMedia from './ManualMedia';
import ManualJourney from './ManualJourney';
import { buildLessons, searchSections } from './manualLayout';
import {
  MANUAL_SECTIONS, MANUAL_INTRO, MANUAL_FOOTER,
  type Block, type ManualSection,
} from './manualContent';

/**
 * 在线使用手册。
 *
 * 内容来自作者原来那份 HTML 手册，搬进来的理由是它在外面就是一份死文件：
 * 平台改了它不会跟着改，学生也不会想起来去开。放进 dashboard 之后，
 * 它和「更新日志」「求助」在同一个地方 —— 手册说明「该怎么用」，
 * 更新日志说明「什么时候变的」，求助兜住剩下的。
 *
 * 教师看到的是同一份加上第 11 节。教师需要知道学生看见什么，
 * 单独维护两份迟早会漂。
 */

interface Props {
  lang: 'zh' | 'en';
  role: 'student' | 'teacher' | 'admin';
}

/** 行内标记：**加粗** 和 `等宽`。不走 HTML，内容里就不会混进标签。 */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-slate-900 dark:text-slate-100">{m[1]}</strong>);
    } else {
      out.push(
        <code key={`${keyPrefix}-c${i}`}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {m[2]}
        </code>,
      );
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const P: React.FC<{ text: string; k: string }> = ({ text, k }) => (
  <p className="text-[0.875rem] leading-[1.95] text-slate-600 dark:text-slate-300">
    {inline(text, k)}
  </p>
);

const CALLOUT_STYLE = {
  tip: {
    box: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50',
    label: 'text-[var(--manual-accent)]',
    icon: 'lightbulb-line',
  },
  warn: {
    box: 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900',
    label: 'text-slate-700 dark:text-slate-200',
    icon: 'error-warning-line',
  },
} as const;

const BlockView: React.FC<{ block: Block; zh: boolean; k: string }> = ({ block, zh, k }) => {
  const pick = (b: { zh: string; en: string }) => (zh ? b.zh : b.en);

  switch (block.kind) {
    case 'p':
      return <P text={zh ? block.zh : block.en} k={k} />;

    case 'h3':
      return (
        <h3 className="mt-7 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {zh ? block.zh : block.en}
        </h3>
      );

    case 'steps':
      return (
        <ol className="max-w-[70ch] space-y-2">
          {(zh ? block.zh : block.en).map((s, i) => (
            <li key={i} className="flex gap-3 text-sm leading-[1.85] text-slate-600 dark:text-slate-300">
              <span className="mt-[5px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-slate-100 text-[0.6875rem] font-bold text-[var(--manual-accent)] dark:bg-slate-800">
                {i + 1}
              </span>
              <span>{inline(s, `${k}-${i}`)}</span>
            </li>
          ))}
        </ol>
      );

    case 'list':
      return (
        <ul className="max-w-[70ch] space-y-1.5">
          {(zh ? block.zh : block.en).map((s, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-[1.85] text-slate-600 dark:text-slate-300">
              <span className="mt-[11px] h-[3px] w-[3px] shrink-0 rounded-full bg-slate-400 dark:bg-slate-600" />
              <span>{inline(s, `${k}-${i}`)}</span>
            </li>
          ))}
        </ul>
      );

    case 'table':
      return (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700" tabIndex={0}>
          <table className="w-full min-w-[24rem] border-collapse text-left text-[0.8125rem]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/50">
                {block.head.map((h, i) => (
                  <th key={i} className="px-3 py-2.5 font-semibold text-slate-500 dark:text-slate-400">
                    {pick(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                  {row.map((cell, c) => (
                    <td key={c} className={`px-3 py-2.5 align-top leading-[1.7] ${
                      c === 0 ? 'whitespace-nowrap font-medium text-slate-800 dark:text-slate-200' : 'text-slate-600 dark:text-slate-400'
                    }`}>
                      {inline(pick(cell), `${k}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'callout': {
      const s = CALLOUT_STYLE[block.tone];
      return (
        <aside className={`max-w-[70ch] border-l-2 px-4 py-3 ${s.box}`}>
          <p className={`mb-2 flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] ${s.label}`}>
            <RemixIcon name={s.icon} size={13} />
            {pick(block.label)}
          </p>
          <div className="space-y-2">
            {(zh ? block.zh : block.en).map((line, i) => (
              <p key={i} className="text-[0.8125rem] leading-[1.8] text-slate-600 dark:text-slate-300">
                {inline(line, `${k}-${i}`)}
              </p>
            ))}
          </div>
        </aside>
      );
    }

    case 'figure':
    case 'clip':
    case 'demo':
      return <ManualMedia items={[block]} zh={zh} renderCaption={text=>inline(text,k)}/>;

    case 'faq':
      return (
        <div className="max-w-[70ch] divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {block.items.map((item, i) => (
            <details key={i} className="group px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-[0.875rem] font-medium text-slate-800 marker:content-none dark:text-slate-200">
                <RemixIcon
                  name="arrow-right-s-line"
                  size={15}
                  className="shrink-0 text-slate-400 transition-transform group-open:rotate-90"
                />
                {pick(item.q)}
              </summary>
              <div className="mt-2.5 space-y-2 pl-[23px]">
                {(zh ? item.a.zh : item.a.en).map((line, j) => (
                  <p key={j} className="text-[0.8125rem] leading-[1.8] text-slate-600 dark:text-slate-300">
                    {inline(line, `${k}-${i}-${j}`)}
                  </p>
                ))}
              </div>
            </details>
          ))}
        </div>
      );

    default:
      return null;
  }
};

const UserManual: React.FC<Props> = ({ lang, role }) => {
  const zh = lang === 'zh';
  const isTeacher = role === 'teacher' || role === 'admin';
  const sections = useMemo(() => MANUAL_SECTIONS.filter(s => !s.teacherOnly || isTeacher), [isTeacher]);
  const lessons = useMemo(() => new Map(sections.map(s=>[s.id,buildLessons(s.blocks)])), [sections]);
  const [active,setActive] = useState('intro');
  const [query,setQuery] = useState('');
  const [directoryOpen,setDirectoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const directoryRef = useRef<HTMLDivElement>(null);
  const directoryButton = useRef<HTMLButtonElement>(null);
  const matches = useMemo(()=>searchSections(sections,query,lang),[sections,query,lang]);
  const activeIndex = sections.findIndex(s=>s.id===active);
  const activeSection = sections[activeIndex];

  useEffect(()=>{
    const root=scrollRef.current;
    if(!root) return;
    const visible=new Set<string>();
    const order=['intro',...sections.map(s=>s.id)];
    const observer=new IntersectionObserver(entries=>{
      entries.forEach(e=>{const id=e.target.getAttribute('data-manual-section')!;if(e.isIntersecting)visible.add(id);else visible.delete(id);});
      const first=order.find(id=>visible.has(id));
      if(first) setActive(first);
    },{root,threshold:0,rootMargin:'-24px 0px -75% 0px'});
    root.querySelectorAll('[data-manual-section]').forEach(el=>observer.observe(el));
    return ()=>observer.disconnect();
  },[sections]);

  useEffect(()=>{
    if(!directoryOpen) return;
    const outside=(e:PointerEvent)=>{if(e.target instanceof Node && !directoryRef.current?.contains(e.target))setDirectoryOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setDirectoryOpen(false);directoryButton.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[directoryOpen]);

  const goTo=(id:string)=>{
    const root=scrollRef.current;
    const section=root?.querySelector<HTMLElement>(`#manual-${id}`);
    if(root && section){
      root.scrollTo({top:section.getBoundingClientRect().top-root.getBoundingClientRect().top+root.scrollTop-24,behavior:'instant'});
      section.querySelector<HTMLElement>('h1, h2')?.focus({preventScroll:true});
    }
    setActive(id);setDirectoryOpen(false);
  };

  const groups=[
    { label:zh?'开始使用':'Getting started', ids:['login','home','canvas'] },
    { label:zh?'写笔记和讨论':'Writing and discussion', ids:['write','buildon','ai','feedback','riseabove','reading','graph'] },
    { label:zh?'回看与支持':'Review and support', ids:['analytics','activities','help','teacher','faq'] },
  ];
  const button='inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 active:scale-[0.98] dark:hover:bg-slate-800';

  return <div className="manual-reader flex h-full min-h-0 flex-col overflow-hidden bg-white text-slate-800 [--manual-accent:#435f78] [--manual-paper:#fff] dark:bg-slate-950 dark:text-slate-100 dark:[--manual-accent:#afc8dc] dark:[--manual-paper:#0f172a]">
    <DemoStyles/>
    <nav aria-label={zh?'手册导航':'Manual navigation'} className="relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950 lg:px-8">
      <button type="button" onClick={()=>goTo('intro')} className={`${button} -ml-3 text-slate-800 dark:text-slate-100`}>
        <RemixIcon name="book-open-line" size={20}/><span>{zh?'使用手册':'User manual'}</span>
      </button>
      <div className="hidden min-w-0 flex-1 items-center gap-3 border-l border-slate-200 pl-4 sm:flex dark:border-slate-700">
        <span className="shrink-0 font-mono text-[0.625rem] text-slate-400">{activeSection?.num || '00'}</span>
        <span className="truncate text-xs text-slate-500">{activeSection ? (zh?activeSection.title.zh:activeSection.title.en) : (zh?'开始之前':'Before you start')}</span>
      </div>
      <div ref={directoryRef} className="relative shrink-0">
        <button ref={directoryButton} type="button" aria-expanded={directoryOpen} aria-controls="manual-directory" onClick={()=>{setDirectoryOpen(v=>!v);setQuery('');}} className={`${button} border border-slate-200 dark:border-slate-700`}>
          <RemixIcon name="search-line" size={16}/>{zh?'目录与搜索':'Contents & search'}<RemixIcon name={directoryOpen?'arrow-up-s-line':'arrow-down-s-line'} size={16}/>
        </button>
        {directoryOpen && <div id="manual-directory" className="absolute right-0 top-full mt-2 max-h-[70dvh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <label htmlFor="manual-search" className="mb-2 block text-xs font-semibold">{zh?'查找章节或操作':'Find a chapter or action'}</label>
          <input id="manual-search" autoFocus type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={zh?'例如：支架、忘记密码、采纳':'Try: scaffold, forgot password, accept'} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-950"/>
          <p role="status" className="mt-2 text-xs text-slate-500">{zh?`找到 ${matches.length} 个章节，搜索包含正文内容。`:`${matches.length} chapters. Search includes the instructions.`}</p>
          {!query.trim() && <button type="button" onClick={()=>goTo('intro')} className={`${button} mt-3 w-full justify-start`}>{zh?'00 · 开始之前':'00 · Before you start'}</button>}
          <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {matches.map(s=><button key={s.id} type="button" onClick={()=>goTo(s.id)} className={`${button} w-full justify-start py-3 text-left`}>
              <span className="shrink-0 font-mono text-[0.625rem] text-slate-400">{s.num}</span><span>{zh?s.title.zh:s.title.en}</span>
              {s.teacherOnly&&<span className="ml-auto text-[0.625rem] text-slate-500">{zh?'教师':'Teacher'}</span>}
            </button>)}
          </div>
          {!matches.length&&<div className="py-8 text-center"><p className="text-sm text-slate-500">{zh?'没有找到，试试功能名或更短的关键词。':'No matches. Try a feature name or a shorter keyword.'}</p><button type="button" className={`${button} mt-3`} onClick={()=>setQuery('')}>{zh?'查看全部章节':'Show all chapters'}</button></div>}
        </div>}
      </div>
    </nav>
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-manual-scroll>
      <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-8 sm:px-7 lg:px-10 lg:pt-12">
        <header id="manual-intro" data-manual-section="intro">
          <div className="grid items-center gap-8 xl:grid-cols-[0.9fr_1.1fr] xl:gap-12">
            <div>
              <p className="mb-5 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[var(--manual-accent)]"><span className="h-px w-6 bg-current"/>HAKCC · {zh?'学习与协作指南':'A guide to learning together'}</p>
              <h1 tabIndex={-1} className="text-3xl font-semibold leading-[1.3] tracking-tight outline-none sm:text-4xl">{zh?'这门课怎么用 HAKCC':'How this course uses HAKCC'}<br/><span className="text-slate-500 dark:text-slate-400">{zh?'从登录到写出一条综合升华':'From signing in to your first rise-above'}</span></h1>
              <p className="mt-5 max-w-[55ch] text-sm leading-8 text-slate-600 dark:text-slate-300">{zh?'每一节先写步骤，旁边配截图、录屏或示意动画。录屏来自演示课程，可以全屏看。':'Each section gives the steps first, with screenshots, recordings or small animations beside them. The recordings come from a demo course and can be watched full screen.'}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button type="button" onClick={()=>goTo('home')} className={`${button} bg-[var(--manual-accent)] px-5 text-white hover:bg-slate-700 dark:text-slate-950 dark:hover:bg-slate-300`}>{zh?'进入课程，从这里开始':'Start with your course'}<RemixIcon name="arrow-right-line" size={16}/></button>
                <button type="button" onClick={()=>goTo('faq')} className={`${button} text-slate-600 dark:text-slate-300`}>{zh?'遇到问题，直接查找':'Find help with a problem'}</button>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[0.6875rem] text-slate-500">
                <span className="flex items-center gap-1.5"><RemixIcon name="image-line" size={14}/>{zh?'截图可以放大':'Screenshots enlarge'}</span>
                <span className="flex items-center gap-1.5"><RemixIcon name="play-circle-line" size={14}/>{zh?'录屏可以全屏':'Recordings go full screen'}</span>
                <span className="flex items-center gap-1.5"><RemixIcon name="node-tree" size={14}/>{zh?'动画讲原理':'Animations show how it works'}</span>
              </div>
            </div>
            <ManualJourney zh={zh} onNavigate={goTo}/>
          </div>
          <div className="my-10 border-y border-slate-200 py-6 dark:border-slate-800">
            <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
              <div><p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{zh?'按你现在要做的事阅读':'Read for the task in front of you'}</p><p className="mt-2 text-xs leading-6 text-slate-500">{zh?'不必一次读完。每一节都可以单独打开。':'You do not need to read everything. Each chapter works on its own.'}</p></div>
              <div className="space-y-3">{groups.map(group=><div key={group.label} className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                <span className="pt-2 text-[0.6875rem] font-medium text-slate-400">{group.label}</span>
                <div className="flex flex-wrap gap-x-1 gap-y-0.5">{group.ids.map(id=>{const s=sections.find(x=>x.id===id);return s?<button key={id} type="button" onClick={()=>goTo(id)} className={`${button} min-h-9 px-2 text-slate-600 dark:text-slate-300`}><span className="font-mono text-[0.5625rem] text-slate-400">{s.num}</span>{zh?s.title.zh.split('：')[0]:s.title.en.split(':')[0]}</button>:null;})}</div>
              </div>)}</div>
            </div>
          </div>
          <details className="group border-b border-slate-200 pb-6 dark:border-slate-800">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold marker:content-none">{zh?'开始之前：这门课在做什么':'Before you start: what this course is doing'}<RemixIcon name="add-line" size={18} className="shrink-0 transition-transform group-open:rotate-45"/></summary>
            <div className="mt-4 max-w-[76ch] space-y-4">{MANUAL_INTRO.map((b,i)=><BlockView key={i} block={b} zh={zh} k={`intro-${i}`}/>)}</div>
          </details>
        </header>

        {sections.map((section:ManualSection,si)=><section key={section.id} id={`manual-${section.id}`} data-manual-section={section.id} className="mt-12 lg:mt-16">
          <div className="mb-7 flex items-start gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
            <span className="pt-1 font-mono text-xs text-[var(--manual-accent)]">{section.num}</span>
            <div className="min-w-0 flex-1"><h2 tabIndex={-1} className="text-xl font-semibold leading-snug tracking-tight outline-none sm:text-2xl">{zh?section.title.zh:section.title.en}</h2>
              <p className="mt-2 text-[0.6875rem] text-slate-500">{section.teacherOnly?(zh?'教师与管理员专属':'For teachers and administrators'):(zh?'学生与教师共同使用':'For students and teachers')}</p>
            </div>
            <button type="button" onClick={()=>goTo('intro')} aria-label={zh?'回到手册开头':'Back to manual overview'} className={`${button} -mt-1 shrink-0 text-slate-400`}><RemixIcon name="arrow-up-line" size={17}/></button>
          </div>
          <div className="space-y-9">
            {lessons.get(section.id)!.map((lesson,li)=><div key={li} className="min-w-0">
              {lesson.heading&&<h3 className="mb-4 text-base font-semibold tracking-tight text-slate-800 dark:text-slate-100">{zh?lesson.heading.zh:lesson.heading.en}</h3>}
              <div className={lesson.media.length&&lesson.body.length?'grid items-start gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] xl:gap-9':'space-y-5'}>
                {!!lesson.body.length&&<div className="min-w-0 max-w-[72ch] space-y-4">{lesson.body.map(({block,index})=><BlockView key={index} block={block} zh={zh} k={`${section.id}-${index}`}/>)}</div>}
                {!!lesson.media.length&&<div className={lesson.body.length?'min-w-0':'max-w-[62rem]'}><ManualMedia items={lesson.media.map(m=>m.block)} zh={zh} renderCaption={text=>inline(text,`${section.id}-${li}-caption`)}/></div>}
              </div>
              {!!lesson.details.length&&<div className="mt-5 space-y-4">{lesson.details.map(({block,index})=><BlockView key={index} block={block} zh={zh} k={`${section.id}-${index}`}/>)}</div>}
            </div>)}
          </div>
          {si<sections.length-1&&<div className="mt-7 flex justify-end"><button type="button" onClick={()=>goTo(sections[si+1].id)} className={`${button} text-[var(--manual-accent)]`}><span className="text-slate-400">{zh?'下一节':'Next'}</span>{zh?sections[si+1].title.zh:sections[si+1].title.en}<RemixIcon name="arrow-right-line" size={16}/></button></div>}
        </section>)}
        <footer className="mt-14 border-t border-slate-200 pt-6 text-xs leading-7 text-slate-500 dark:border-slate-800">{zh?MANUAL_FOOTER.zh:MANUAL_FOOTER.en}</footer>
      </div>
    </div>
  </div>;
};

export default UserManual;
