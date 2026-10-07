import React, { memo, useEffect, useId, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import { DEMOS } from './ManualDemos';
import type { MediaBlock } from './manualLayout';

/**
 * 资源版本号。**换了任何一张截图或录屏，就把它加一。**
 *
 * public/ 下的文件是原样发布的，文件名不带哈希；缓存头是 4 小时。
 * 也就是说换了图但地址不变，四小时内所有打开过手册的人看到的还是旧图 ——
 * 已经出过一次：更新日志那张截图明明换了，页面上纹丝不动。
 * 地址后面挂上版本号，改一次图就能立刻生效，同时保住长缓存。
 */
const ASSET_V = '10';
const asset = (path: string) => `${path}?v=${ASSET_V}`;

const control = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 active:scale-[0.98] dark:hover:bg-slate-800';
const plain = (text: string) => text.replace(/\*\*|`/g, '');

function ImageViewer({ src, label, zh, onClose }: { src: string; label: string; zh: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} aria-label={zh ? '截图查看器' : 'Screenshot viewer'} onClose={onClose}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    className="fixed inset-0 m-auto max-h-[94dvh] w-[96vw] max-w-[1440px] overflow-hidden rounded-2xl border border-slate-300 bg-white p-0 text-slate-800 shadow-xl backdrop:bg-slate-950/70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
    <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
      <p className="min-w-0 truncate text-xs">{label}</p>
      <div className="flex shrink-0 items-center">
        <button type="button" className={control} aria-pressed={zoom} onClick={() => setZoom(v=>!v)}>{zoom ? (zh ? '适应窗口' : 'Fit image') : (zh ? '原始尺寸' : 'Actual size')}</button>
        <button type="button" autoFocus className={control} onClick={onClose} aria-label={zh ? '关闭截图' : 'Close screenshot'}><RemixIcon name="close-line" size={20}/></button>
      </div>
    </div>
    <div className="max-h-[80dvh] overflow-auto bg-slate-100 p-3 dark:bg-slate-950" tabIndex={0} aria-label={zh ? '截图，可滚动查看' : 'Scrollable screenshot'}>
      <img src={asset(src)} alt={label} className={zoom ? 'mx-auto h-auto max-w-none' : 'mx-auto max-h-[76dvh] max-w-full object-contain'} />
    </div>
    <p className="px-4 py-2 text-xs text-slate-500">{zh ? '按 Esc 关闭；使用「原始尺寸」查看界面细节。' : 'Press Esc to close. Use Actual size to inspect interface details.'}</p>
  </dialog>;
}

function Screenshot({ src, label, zh }: { src: string; label: string; zh: boolean }) {
  const [loaded,setLoaded] = useState(false);
  const [error,setError] = useState(false);
  const [portrait,setPortrait] = useState(false);
  const [open,setOpen] = useState(false);
  return <>
    <div className="relative h-full w-full overflow-auto" tabIndex={portrait ? 0 : undefined} aria-label={portrait ? (zh ? '长截图，向下滚动查看' : 'Tall screenshot, scroll to explore') : undefined}>
      {!loaded && !error && <div aria-label={zh ? '正在加载截图' : 'Loading screenshot'} className="absolute inset-0 animate-pulse bg-slate-200/60 motion-reduce:animate-none dark:bg-slate-800"/>}
      {error ? <div role="status" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-slate-500">
        <RemixIcon name="image-line" size={28}/><p>{zh ? '截图暂时无法加载，操作说明仍可阅读。' : 'This screenshot is unavailable. The written instructions remain available.'}</p>
        <a href={asset(src)} target="_blank" rel="noopener noreferrer" className={control}>{zh ? '打开原图' : 'Open image'}</a>
      </div> : <button type="button" disabled={!loaded} onClick={()=>setOpen(true)} aria-label={zh ? `放大截图：${label}` : `Enlarge screenshot: ${label}`}
        className={`flex w-full cursor-zoom-in justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500 ${portrait ? 'min-h-full items-start py-4' : 'h-full items-center'}`}>
        <img src={asset(src)} alt={label} loading="lazy" decoding="async"
          onLoad={e=>{setLoaded(true);setPortrait(e.currentTarget.naturalHeight/e.currentTarget.naturalWidth > 1.4);}} onError={()=>setError(true)}
          className={portrait ? 'h-auto w-full max-w-[280px]' : 'max-h-full w-full object-contain'}/>
      </button>}
    </div>
    {loaded && <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[0.625rem] text-slate-600 shadow-sm">
      <RemixIcon name="zoom-in-line" size={13}/>{portrait ? (zh ? '滚动浏览 · 点击放大' : 'Scroll · click to enlarge') : (zh ? '点击放大' : 'Click to enlarge')}
    </div>}
    {open && <ImageViewer src={src} label={label} zh={zh} onClose={()=>setOpen(false)}/>}
  </>;
}

function Recording({ src, label, zh }: { src: string; label: string; zh: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [waiting,setWaiting] = useState(false);
  const [failed,setFailed] = useState(false);
  useEffect(()=>{
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(([entry])=>{ if(!entry.isIntersecting) video.pause(); },{threshold:0.1});
    const onVisibility = ()=>{if(document.hidden) video.pause();};
    observer.observe(video);document.addEventListener('visibilitychange',onVisibility);
    return ()=>{observer.disconnect();document.removeEventListener('visibilitychange',onVisibility);video.pause();};
  },[]);
  if(failed) return <div role="status" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500">
    <p>{zh ? '录屏暂时无法播放，可以打开视频文件重试。' : 'The recording could not play. Open the video file to try again.'}</p>
    <a className={control} href={asset(`${src}.mp4`)} target="_blank" rel="noopener noreferrer">{zh ? '打开录屏' : 'Open recording'}</a>
  </div>;
  return <>
    <video ref={ref} controls playsInline muted preload="none" poster={asset(`${src}.jpg`)} aria-label={label}
      onWaiting={()=>setWaiting(true)} onPlaying={()=>setWaiting(false)} onLoadedData={()=>setWaiting(false)} onError={()=>setFailed(true)}
      className="h-full w-full object-contain">
      <source src={asset(`${src}.mp4`)} type="video/mp4"/>
      <source src={asset(`${src}.webm`)} type="video/webm"/>
      {zh ? '浏览器不支持此录屏。' : 'Your browser does not support this recording.'}
    </video>
    {waiting && <div role="status" className="pointer-events-none absolute left-3 top-3 rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-600">{zh ? '正在载入演示…' : 'Loading recording…'}</div>}
  </>;
}

const Schematic = memo(function Schematic({ block, label, zh }: { block: Extract<MediaBlock,{kind:'demo'}>; label: string; zh: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible,setVisible] = useState(false);
  const [paused,setPaused] = useState(false);
  const [reduced,setReduced] = useState(false);
  useEffect(()=>{
    const preference=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setReduced(preference.matches);update();preference.addEventListener('change',update);
    const observer=new IntersectionObserver(([e])=>setVisible(e.isIntersecting),{threshold:0.15});
    if(ref.current) observer.observe(ref.current);
    return ()=>{observer.disconnect();preference.removeEventListener('change',update);};
  },[]);
  const Demo=DEMOS[block.id];
  return <div ref={ref} className="flex h-full flex-col justify-center gap-3 p-4 sm:p-6" data-demo-playing={visible&&!paused&&!reduced}>
    <div className="mx-auto flex min-h-0 w-full max-w-[540px] flex-1 items-center justify-center [&>svg]:max-h-full"><Demo label={label} lang={zh?'zh':'en'}/></div>
    <div className="flex shrink-0 items-center justify-between gap-2 text-slate-500">
      <span className="text-[0.6875rem]">{zh ? '原理示意 · 非真实界面' : 'Concept illustration · not the actual interface'}</span>
      <button type="button" disabled={reduced} className={control} onClick={()=>setPaused(v=>!v)} aria-pressed={paused}>
        <RemixIcon name={paused||reduced?'play-line':'pause-line'} size={16}/>
        {reduced ? (zh?'静态示意':'Still view') : paused ? (zh?'播放动画':'Play animation') : (zh?'暂停动画':'Pause animation')}
      </button>
    </div>
  </div>;
});

export default function ManualMedia({ items, zh, renderCaption }: { items: MediaBlock[]; zh: boolean; renderCaption: (text:string)=>React.ReactNode }) {
  const [selected,setSelected]=useState(0);
  const id=useId();
  const block=items[selected] || items[0];
  const label=plain(zh?block.cap.zh:block.cap.en);
  const names={figure:zh?'界面截图':'Screenshot',clip:zh?'操作录屏':'Recording',demo:zh?'原理动画':'How it works'};
  const icons={figure:'image-line',clip:'play-circle-line',demo:'node-tree'};
  function tabName(item:MediaBlock,index:number) {
    const same=items.filter(x=>x.kind===item.kind);
    return names[item.kind]+(same.length>1?` ${items.slice(0,index+1).filter(x=>x.kind===item.kind).length}`:'');
  }
  return <figure className="min-w-0" data-manual-media>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_28px_-16px_rgba(15,23,42,0.16)] dark:border-slate-700 dark:bg-slate-900">
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-200 px-2 dark:border-slate-700">
        <div role="tablist" aria-label={zh?'选择对照素材':'Choose reference media'} className="flex min-w-0 gap-1 overflow-x-auto py-1">
          {items.map((item,index)=><button key={index} type="button" role="tab" id={`${id}-tab-${index}`} aria-selected={index===selected} aria-controls={`${id}-panel`} tabIndex={index===selected?0:-1}
            title={plain(zh?item.cap.zh:item.cap.en)} onClick={()=>setSelected(index)} onKeyDown={e=>{
              const next=e.key==='ArrowRight'?(index+1)%items.length:e.key==='ArrowLeft'?(index-1+items.length)%items.length:e.key==='Home'?0:e.key==='End'?items.length-1:null;
              if(next!==null){e.preventDefault();setSelected(next);document.getElementById(`${id}-tab-${next}`)?.focus();}
            }} className={`${control} shrink-0 ${index===selected?'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white':'text-slate-500 dark:text-slate-400'}`}>
            <RemixIcon name={icons[item.kind]} size={15}/>{tabName(item,index)}
          </button>)}
        </div>
        <span aria-hidden="true" className="shrink-0 pr-2 font-mono text-[0.625rem] text-slate-400">{String(selected+1).padStart(2,'0')} / {String(items.length).padStart(2,'0')}</span>
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} className="relative aspect-[16/10] min-h-[240px] overflow-hidden bg-slate-50 dark:bg-slate-950/50">
        {block.kind==='figure' ? <Screenshot key={block.src} src={block.src} label={label} zh={zh}/> : block.kind==='clip' ? <Recording key={block.src} src={block.src} label={label} zh={zh}/> : <Schematic key={block.id} block={block} label={label} zh={zh}/>}
      </div>
    </div>
    <figcaption className="mt-3 flex items-start gap-2.5 px-1 text-xs leading-6 text-slate-500 dark:text-slate-400">
      <span className="mt-0.5 shrink-0 font-mono text-[0.625rem] uppercase tracking-wider text-slate-400">{block.kind==='clip'?'PLAY':block.kind==='demo'?'IDEA':'VIEW'}</span>
      <span>{renderCaption(zh?block.cap.zh:block.cap.en)}</span>
    </figcaption>
  </figure>;
}
