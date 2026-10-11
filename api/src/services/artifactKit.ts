/**
 * 智能体做的网页自带的一套样式和动效（2026-10-11 用户：「要多加动效，做的高级点」）。
 *
 * 每个网页存进库之前都塞进这一份：配色、字体、阴影、卡片、页签、折叠、表格、答题、时间线、概念图节点、
 * 数字滚动、入场和滚动出现的动效。写网页的模型只管用这些类名把内容摆好，不用每次从零写一套样式，
 * 网页之间风格一致、更精致，模型也少写很多代码（更快、更不容易写到一半被截断）。
 *
 * 约束和网页本身一样：不联网、不用存储、不弹窗；脚本没跑起来时内容照样全部看得见（动效只在 html.hk-js 下生效）；
 * 系统设置了「减少动态效果」就不做动画。深色模式跟系统走。
 */

export const KIT_CSS = `
:root{--hk-bg:#f6f7fb;--hk-surface:#fff;--hk-raise:#fbfcfe;--hk-ink:#1c2433;--hk-muted:#5d6678;--hk-faint:#8a93a5;--hk-line:#e4e7ee;
--hk-accent:#1e3a8a;--hk-accent-2:#3b5bdb;--hk-accent-soft:#e9eefc;--hk-sage:#6f9e92;--hk-ochre:#bf9b5a;--hk-rose:#b86e6e;--hk-lilac:#8f7fb0;--hk-sky:#7fa3bd;
--hk-good:#2f7d5b;--hk-good-soft:#e6f4ee;--hk-bad:#b4504f;--hk-bad-soft:#fbecec;
--hk-r:18px;--hk-r-sm:12px;--hk-r-xs:8px;
--hk-shadow:0 1px 2px rgba(30,58,138,.05),0 10px 30px -14px rgba(30,58,138,.20);
--hk-shadow-lg:0 2px 6px rgba(30,58,138,.06),0 28px 56px -24px rgba(30,58,138,.32);
--hk-font:system-ui,-apple-system,"PingFang SC","Microsoft YaHei","Noto Sans SC","Segoe UI",sans-serif;
--hk-ease:cubic-bezier(.22,1,.36,1);--hk-ease-in:cubic-bezier(.55,0,.6,.2)}
@media (prefers-color-scheme:dark){:root{--hk-bg:#0e131b;--hk-surface:#151c27;--hk-raise:#19212e;--hk-ink:#e7eaf0;--hk-muted:#a2abbb;--hk-faint:#7a8496;--hk-line:#273143;
--hk-accent:#9db2ff;--hk-accent-2:#b9c7ff;--hk-accent-soft:#1c2642;--hk-good:#7cc7a3;--hk-good-soft:#16301f;--hk-bad:#e59a99;--hk-bad-soft:#3a1d1e;
--hk-shadow:0 1px 2px rgba(0,0,0,.3),0 12px 32px -16px rgba(0,0,0,.6);--hk-shadow-lg:0 2px 6px rgba(0,0,0,.35),0 30px 60px -24px rgba(0,0,0,.7)}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--hk-bg);color:var(--hk-ink);font:16px/1.7 var(--hk-font);-webkit-font-smoothing:antialiased;
background-image:radial-gradient(900px 420px at 12% -8%,color-mix(in srgb,var(--hk-accent) 9%,transparent),transparent 70%),radial-gradient(700px 380px at 100% 0%,color-mix(in srgb,var(--hk-lilac) 10%,transparent),transparent 72%);background-repeat:no-repeat}
img,svg{max-width:100%}
.hk-page{max-width:980px;margin:0 auto;padding:clamp(20px,5vw,56px) clamp(16px,4vw,40px) 48px}
.hk-hero{position:relative;padding:8px 0 22px;margin-bottom:8px}
.hk-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;letter-spacing:.06em;color:var(--hk-accent);background:var(--hk-accent-soft);padding:5px 12px;border-radius:999px}
.hk-hero h1,.hk-h1{font-size:clamp(26px,4.2vw,40px);line-height:1.18;letter-spacing:-.02em;font-weight:750;margin:14px 0 10px}
.hk-lead{font-size:clamp(15.5px,1.8vw,18px);color:var(--hk-muted);max-width:62ch;margin:0}
h2,.hk-h2{font-size:clamp(19px,2.4vw,24px);letter-spacing:-.01em;line-height:1.3;margin:36px 0 14px;font-weight:700}
h3,.hk-h3{font-size:17px;margin:0 0 6px;font-weight:650}
p{margin:0 0 12px}
.hk-muted{color:var(--hk-muted)}
.hk-section{margin:28px 0}
.hk-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));align-items:start}
.hk-card{background:var(--hk-surface);border:1px solid var(--hk-line);border-radius:var(--hk-r);padding:20px 22px;box-shadow:var(--hk-shadow);
transition:transform .35s var(--hk-ease),box-shadow .35s var(--hk-ease),border-color .35s var(--hk-ease)}
.hk-card:hover{transform:translateY(-3px);box-shadow:var(--hk-shadow-lg);border-color:color-mix(in srgb,var(--hk-accent) 22%,var(--hk-line))}
.hk-card.hk-flat:hover{transform:none;box-shadow:var(--hk-shadow)}
.hk-chip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--hk-accent-soft);color:var(--hk-accent)}
.hk-chip[data-tone=sage]{background:color-mix(in srgb,var(--hk-sage) 16%,transparent);color:var(--hk-sage)}
.hk-chip[data-tone=ochre]{background:color-mix(in srgb,var(--hk-ochre) 18%,transparent);color:var(--hk-ochre)}
.hk-chip[data-tone=rose]{background:color-mix(in srgb,var(--hk-rose) 16%,transparent);color:var(--hk-rose)}
.hk-chip[data-tone=lilac]{background:color-mix(in srgb,var(--hk-lilac) 16%,transparent);color:var(--hk-lilac)}
.hk-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;border-radius:12px;border:1px solid transparent;
background:var(--hk-accent);color:#fff;font:600 15px var(--hk-font);cursor:pointer;transition:transform .2s var(--hk-ease),filter .2s,background .2s,box-shadow .2s}
.hk-btn:hover{filter:brightness(1.07);box-shadow:0 8px 20px -10px var(--hk-accent)}
.hk-btn:active{transform:scale(.97)}
.hk-btn.hk-ghost{background:transparent;color:var(--hk-ink);border-color:var(--hk-line)}
.hk-btn.hk-ghost:hover{background:var(--hk-raise);box-shadow:none}
.hk-btn:focus-visible,.hk-tab:focus-visible,.hk-option:focus-visible,.hk-node:focus-visible{outline:3px solid color-mix(in srgb,var(--hk-accent) 35%,transparent);outline-offset:2px}
.hk-quote{position:relative;margin:12px 0;padding:14px 18px 14px 20px;border-radius:var(--hk-r-sm);background:var(--hk-raise);border:1px solid var(--hk-line);color:var(--hk-ink)}
.hk-quote::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:3px;background:var(--hk-accent)}
.hk-quote cite,.hk-cite{display:block;margin-top:6px;font-style:normal;font-size:13px;color:var(--hk-faint)}
.hk-tabs{margin:18px 0}
.hk-tablist{position:relative;display:flex;gap:4px;padding:4px;border-radius:14px;background:var(--hk-raise);border:1px solid var(--hk-line);overflow-x:auto;scrollbar-width:none}
.hk-tab{position:relative;z-index:1;flex:0 0 auto;min-height:40px;padding:0 16px;border:0;border-radius:10px;background:transparent;color:var(--hk-muted);font:600 14.5px var(--hk-font);cursor:pointer;transition:color .25s}
.hk-tab[aria-selected=true]{color:var(--hk-ink)}
.hk-tab-ink{position:absolute;z-index:0;top:4px;bottom:4px;left:0;border-radius:10px;background:var(--hk-surface);box-shadow:var(--hk-shadow);transition:transform .45s var(--hk-ease),width .45s var(--hk-ease)}
[data-hk-panel]{padding-top:16px}
[data-hk-panel][hidden]{display:none}
.hk-panel-in{animation:hk-rise .5s var(--hk-ease) both}
.hk-details{border:1px solid var(--hk-line);border-radius:var(--hk-r-sm);background:var(--hk-surface);margin:10px 0;overflow:hidden}
.hk-details>summary{list-style:none;cursor:pointer;padding:14px 18px;font-weight:650;display:flex;align-items:center;justify-content:space-between;gap:12px}
.hk-details>summary::-webkit-details-marker{display:none}
.hk-details>summary::after{content:"";width:9px;height:9px;border-right:2px solid var(--hk-faint);border-bottom:2px solid var(--hk-faint);transform:rotate(45deg);transition:transform .3s var(--hk-ease);flex:0 0 auto;margin-top:-4px}
.hk-details[open]>summary::after{transform:rotate(-135deg);margin-top:4px}
.hk-details-body{padding:0 18px 16px;color:var(--hk-muted)}
.hk-table-wrap{overflow-x:auto;border-radius:var(--hk-r);border:1px solid var(--hk-line);box-shadow:var(--hk-shadow);background:var(--hk-surface)}
.hk-table{width:100%;border-collapse:collapse;font-size:15px;min-width:560px}
.hk-table th{position:sticky;top:0;text-align:left;font-size:13px;letter-spacing:.03em;color:var(--hk-muted);background:var(--hk-raise);padding:12px 16px;border-bottom:1px solid var(--hk-line);font-weight:650}
.hk-table td{padding:14px 16px;border-top:1px solid var(--hk-line);vertical-align:top;transition:background .2s}
.hk-table tbody tr:first-child td{border-top:0}
.hk-table tbody tr:hover td{background:color-mix(in srgb,var(--hk-accent) 4%,transparent)}
.hk-quiz{display:grid;gap:16px}
.hk-question{background:var(--hk-surface);border:1px solid var(--hk-line);border-radius:var(--hk-r);padding:20px 22px;box-shadow:var(--hk-shadow)}
.hk-question h3{margin-bottom:12px}
.hk-option{display:flex;width:100%;align-items:flex-start;gap:10px;text-align:left;min-height:48px;margin:8px 0 0;padding:12px 14px;border-radius:12px;border:1px solid var(--hk-line);
background:var(--hk-raise);color:var(--hk-ink);font:500 15px/1.5 var(--hk-font);cursor:pointer;transition:border-color .2s,background .25s,transform .2s var(--hk-ease)}
.hk-option:hover{border-color:color-mix(in srgb,var(--hk-accent) 40%,var(--hk-line));transform:translateX(2px)}
.hk-option.is-right{border-color:var(--hk-good);background:var(--hk-good-soft);color:var(--hk-good)}
.hk-option.is-wrong{border-color:var(--hk-bad);background:var(--hk-bad-soft);color:var(--hk-bad);animation:hk-shake .42s var(--hk-ease)}
.hk-option[disabled]{cursor:default}
.hk-explain{display:none;margin-top:12px;padding:12px 14px;border-radius:12px;background:var(--hk-accent-soft);color:var(--hk-ink);font-size:14.5px}
.hk-explain.is-open{display:block;animation:hk-rise .45s var(--hk-ease) both}
.hk-score{display:inline-flex;align-items:baseline;gap:6px;font-weight:700;color:var(--hk-accent)}
.hk-timeline{position:relative;margin:18px 0;padding-left:28px}
.hk-timeline::before{content:"";position:absolute;left:8px;top:6px;bottom:6px;width:2px;border-radius:2px;background:linear-gradient(var(--hk-accent),color-mix(in srgb,var(--hk-accent) 10%,transparent));transform-origin:top}
.hk-step{position:relative;margin:0 0 18px}
.hk-step::before{content:"";position:absolute;left:-26px;top:7px;width:14px;height:14px;border-radius:50%;background:var(--hk-surface);border:3px solid var(--hk-accent);box-shadow:0 0 0 4px var(--hk-bg)}
.hk-step-time{font-size:13px;font-weight:650;color:var(--hk-accent);letter-spacing:.02em}
.hk-map{position:relative;display:flex;flex-wrap:wrap;gap:14px;justify-content:center;padding:22px;border-radius:var(--hk-r);background:var(--hk-surface);border:1px solid var(--hk-line);box-shadow:var(--hk-shadow)}
.hk-node{position:relative;max-width:260px;padding:12px 16px;border-radius:14px;border:1px solid var(--hk-line);background:var(--hk-raise);cursor:pointer;text-align:left;font:600 15px/1.45 var(--hk-font);color:var(--hk-ink);
transition:transform .3s var(--hk-ease),box-shadow .3s var(--hk-ease),border-color .3s}
.hk-node:hover,.hk-node.is-open{transform:translateY(-2px);box-shadow:var(--hk-shadow-lg);border-color:color-mix(in srgb,var(--hk-accent) 35%,var(--hk-line))}
.hk-node.hk-core{background:var(--hk-accent);color:#fff;border-color:transparent}
.hk-node-detail{display:none;margin-top:8px;font-weight:400;font-size:14px;color:var(--hk-muted)}
.hk-node.hk-core .hk-node-detail{color:rgba(255,255,255,.85)}
.hk-node.is-open .hk-node-detail{display:block;animation:hk-rise .4s var(--hk-ease) both}
.hk-edge{fill:none;stroke:color-mix(in srgb,var(--hk-accent) 45%,transparent);stroke-width:2;stroke-linecap:round}
.hk-stat{display:flex;flex-direction:column;gap:2px}
.hk-stat-value{font-size:clamp(28px,4vw,40px);font-weight:750;letter-spacing:-.02em;color:var(--hk-accent);font-variant-numeric:tabular-nums}
.hk-stat-label{font-size:13.5px;color:var(--hk-muted)}
.hk-bar{height:10px;border-radius:999px;background:var(--hk-raise);border:1px solid var(--hk-line);overflow:hidden}
.hk-bar>i{display:block;height:100%;width:var(--value,50%);border-radius:inherit;background:linear-gradient(90deg,var(--hk-accent),var(--hk-accent-2));transform-origin:left}
.hk-blank{display:inline-block;min-width:8em;border-bottom:2px dashed color-mix(in srgb,var(--hk-accent) 45%,transparent);color:var(--hk-faint)}
.hk-write{min-height:72px;padding:12px 14px;border-radius:12px;border:1px dashed color-mix(in srgb,var(--hk-accent) 35%,var(--hk-line));background:var(--hk-raise);color:var(--hk-ink);outline:none}
.hk-write:empty::before{content:attr(data-placeholder);color:var(--hk-faint)}
.hk-write:focus{border-style:solid;border-color:var(--hk-accent)}
.hk-footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--hk-line);font-size:13px;color:var(--hk-faint)}
.hk-footer ul{margin:6px 0 10px;padding-left:18px}
@keyframes hk-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes hk-fade{from{opacity:0}to{opacity:1}}
@keyframes hk-shake{0%,100%{transform:none}25%{transform:translateX(-5px)}50%{transform:translateX(4px)}75%{transform:translateX(-2px)}}
@keyframes hk-draw{from{stroke-dashoffset:var(--len,600)}to{stroke-dashoffset:0}}
@keyframes hk-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes hk-line{from{transform:scaleY(0)}to{transform:scaleY(1)}}
html.hk-js .hk-hero>*{animation:hk-rise .8s var(--hk-ease) both}
html.hk-js .hk-hero>*:nth-child(2){animation-delay:.08s}
html.hk-js .hk-hero>*:nth-child(3){animation-delay:.16s}
html.hk-js .hk-hero>*:nth-child(4){animation-delay:.24s}
html.hk-js .hk-reveal{opacity:0;transform:translateY(18px);transition:opacity .75s var(--hk-ease),transform .75s var(--hk-ease);transition-delay:calc(var(--hk-i,0) * 70ms)}
html.hk-js .hk-reveal.is-in{opacity:1;transform:none}
html.hk-js .hk-timeline.is-in::before{animation:hk-line 1.1s var(--hk-ease) both}
html.hk-js .hk-bar.is-in>i{animation:hk-grow 1.1s var(--hk-ease) both}
html.hk-js .hk-edge.is-in{stroke-dasharray:var(--len,600);animation:hk-draw 1.2s var(--hk-ease) both}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
html.hk-js .hk-reveal{opacity:1;transform:none}}
@media print{body{background:#fff}.hk-card,.hk-question,.hk-table-wrap{box-shadow:none}html.hk-js .hk-reveal{opacity:1;transform:none}}
`.trim();

// 脚本只用 ES5 风格写，不用模板字符串：要原样塞进 HTML，还要过 TypeScript 的模板字符串
export const KIT_JS = `
(function(){
var d=document,root=d.documentElement;root.classList.add('hk-js');
var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function all(s,el){return Array.prototype.slice.call((el||d).querySelectorAll(s));}
function ready(fn){if(d.readyState!=='loading')fn();else d.addEventListener('DOMContentLoaded',fn);}
ready(function(){
  all('[data-hk-stagger]').forEach(function(box){Array.prototype.slice.call(box.children).forEach(function(c,i){c.classList.add('hk-reveal');c.style.setProperty('--hk-i',String(Math.min(i,12)));});});
  all('.hk-edge').forEach(function(p){try{var len=Math.ceil(p.getTotalLength());p.style.setProperty('--len',String(len));p.style.strokeDashoffset=String(len);}catch(e){}});
  var watched=all('.hk-reveal,.hk-timeline,.hk-bar,.hk-edge,[data-hk-count]');
  function show(el){el.classList.add('is-in');if(el.hasAttribute('data-hk-count'))countUp(el);if(el.classList.contains('hk-edge'))el.style.strokeDashoffset='';}
  if(reduce||!('IntersectionObserver' in window)){watched.forEach(show);}else{
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){show(e.target);io.unobserve(e.target);}});},{threshold:.12,rootMargin:'0px 0px -6% 0px'});
    watched.forEach(function(el){io.observe(el);});
  }
  function countUp(el){
    var target=parseFloat(el.getAttribute('data-hk-count'));if(isNaN(target))return;
    var dec=(String(el.getAttribute('data-hk-count')).split('.')[1]||'').length,suffix=el.getAttribute('data-hk-suffix')||'';
    if(reduce){el.textContent=target.toFixed(dec)+suffix;return;}
    var t0=null,dur=1200;
    function step(ts){if(!t0)t0=ts;var p=Math.min(1,(ts-t0)/dur),v=target*(1-Math.pow(1-p,3));el.textContent=v.toFixed(dec)+suffix;if(p<1)requestAnimationFrame(step);}
    requestAnimationFrame(step);
  }
  all('[data-hk-tabs]').forEach(function(box){
    var tabs=all('.hk-tab',box),panels=all('[data-hk-panel]',box),list=box.querySelector('.hk-tablist');
    var ink=d.createElement('span');ink.className='hk-tab-ink';if(list)list.insertBefore(ink,list.firstChild);
    function select(i,animate){tabs.forEach(function(t,j){t.setAttribute('aria-selected',j===i?'true':'false');t.setAttribute('tabindex',j===i?'0':'-1');});
      panels.forEach(function(p,j){if(j===i){p.hidden=false;if(animate){p.classList.remove('hk-panel-in');void p.offsetWidth;p.classList.add('hk-panel-in');}}else p.hidden=true;});
      var t=tabs[i];if(t&&list){ink.style.width=t.offsetWidth+'px';ink.style.transform='translateX('+(t.offsetLeft-4)+'px)';}}
    tabs.forEach(function(t,i){t.setAttribute('role','tab');t.addEventListener('click',function(){select(i,true);});
      t.addEventListener('keydown',function(e){var k=e.key,n=tabs.length;if(k==='ArrowRight'||k==='ArrowLeft'){e.preventDefault();var j=(i+(k==='ArrowRight'?1:n-1))%n;tabs[j].focus();select(j,true);}});});
    if(list)list.setAttribute('role','tablist');
    select(Math.max(0,tabs.findIndex(function(t){return t.getAttribute('aria-selected')==='true';})),false);
    window.addEventListener('resize',function(){var i=tabs.findIndex(function(t){return t.getAttribute('aria-selected')==='true';});if(i>=0)select(i,false);});
  });
  all('.hk-details').forEach(function(det){
    var sum=det.querySelector('summary'),body=det.querySelector('.hk-details-body');if(!sum||!body||reduce)return;
    sum.addEventListener('click',function(e){e.preventDefault();
      if(det.open){var h=body.offsetHeight;body.animate([{height:h+'px',opacity:1},{height:'0px',opacity:0}],{duration:260,easing:'cubic-bezier(.55,0,.6,.2)'}).onfinish=function(){det.open=false;};}
      else{det.open=true;var h2=body.offsetHeight;body.animate([{height:'0px',opacity:0},{height:h2+'px',opacity:1}],{duration:360,easing:'cubic-bezier(.22,1,.36,1)'});}});
  });
  all('[data-hk-quiz]').forEach(function(quiz){
    var score=quiz.querySelector('[data-hk-score]'),right=0,answered=0,qs=all('.hk-question',quiz);
    function update(){if(score)score.textContent=right+' / '+qs.length;}
    qs.forEach(function(q){var opts=all('.hk-option',q),exp=q.querySelector('.hk-explain');
      opts.forEach(function(o){o.addEventListener('click',function(){if(q.getAttribute('data-done'))return;q.setAttribute('data-done','1');answered++;
        var ok=o.hasAttribute('data-correct');if(ok)right++;o.classList.add(ok?'is-right':'is-wrong');
        opts.forEach(function(x){x.disabled=true;if(x.hasAttribute('data-correct'))x.classList.add('is-right');});
        if(exp)exp.classList.add('is-open');update();});});});
    update();
  });
  all('.hk-node').forEach(function(n){if(!n.querySelector('.hk-node-detail'))return;n.setAttribute('tabindex','0');n.setAttribute('role','button');
    function toggle(){n.classList.toggle('is-open');n.setAttribute('aria-expanded',n.classList.contains('is-open')?'true':'false');}
    n.addEventListener('click',toggle);n.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});});
  all('[data-hk-filter]').forEach(function(bar){var target=d.querySelector(bar.getAttribute('data-hk-filter'));if(!target)return;
    all('button[data-value]',bar).forEach(function(b){b.addEventListener('click',function(){var v=b.getAttribute('data-value');
      all('button[data-value]',bar).forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false');});
      Array.prototype.slice.call(target.children).forEach(function(item){var tags=(item.getAttribute('data-tags')||'').split(/\\s*,\\s*/);var on=v==='*'||tags.indexOf(v)>=0;
        if(on&&item.hidden){item.hidden=false;if(!reduce)item.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:320,easing:'cubic-bezier(.22,1,.36,1)'});}else if(!on){item.hidden=true;}});});});});
});
})();
`.trim();

/** 写网页的模型看的组件说明（越短越好，类名照抄就能用） */
export const KIT_GUIDE = [
  '网页里已经自带一套样式和动效（你不用写 <link> 或 <script src>，也不要再定义 :root 配色变量），直接用这些类名：',
  '- 骨架：<main class="hk-page"> 包住全部内容；开头 <header class="hk-hero">，里面依次放 <span class="hk-eyebrow">一句标签</span>、<h1>标题</h1>、<p class="hk-lead">一两句导语</p>（标题区自带依次浮现的入场动效）。小节用 <section class="hk-section"> 和 <h2>。',
  '- 卡片：<div class="hk-grid" data-hk-stagger> 里放若干 <article class="hk-card">（卡片会依次浮现，悬停微微抬起）。标签 <span class="hk-chip" data-tone="sage|ochre|rose|lilac">。引用原话 <blockquote class="hk-quote">原话<cite>— 作者《笔记标题》</cite></blockquote>。',
  '- 滚动出现：任何块加 class="hk-reveal"；一组同类元素的父元素加 data-hk-stagger，子元素就依次出现。',
  '- 页签：<div class="hk-tabs" data-hk-tabs><div class="hk-tablist"><button class="hk-tab" aria-selected="true">甲</button><button class="hk-tab">乙</button></div><div data-hk-panel>…</div><div data-hk-panel hidden>…</div></div>（有滑动指示条和切换动画）。',
  '- 折叠：<details class="hk-details"><summary>标题</summary><div class="hk-details-body">内容</div></details>（展开收起有动画）。',
  '- 表格：<div class="hk-table-wrap"><table class="hk-table">…</table></div>。筛选按钮：<div data-hk-filter="#目标容器id"><button class="hk-btn hk-ghost" data-value="*">全部</button><button class="hk-btn hk-ghost" data-value="甲">甲</button></div>，目标容器的子元素写 data-tags="甲,乙"。',
  '- 自测题：<div class="hk-quiz" data-hk-quiz><p>得分 <span class="hk-score" data-hk-score></span></p><div class="hk-question"><h3>题干</h3><button class="hk-option">选项</button><button class="hk-option" data-correct>正确选项</button><div class="hk-explain">解析</div></div></div>（点选后自动判对错、显示解析、累计得分，答错会轻轻抖一下）。',
  '- 时间线：<div class="hk-timeline"><div class="hk-step hk-reveal"><div class="hk-step-time">时间</div><h3>事件</h3><p>说明</p></div>…</div>（竖线会画出来）。',
  '- 概念图：<div class="hk-map"><div class="hk-node hk-core">核心概念<div class="hk-node-detail">展开后看到的说明或原话</div></div><div class="hk-node">…</div></div>（点节点展开详情）；要画连线可以在里面放一个绝对定位的 <svg>，线用 <path class="hk-edge"> （会有描线动画）。',
  '- 数字：<div class="hk-stat"><span class="hk-stat-value" data-hk-count="42" data-hk-suffix="%">0</span><span class="hk-stat-label">说明</span></div>（会滚动计数）。进度条：<div class="hk-bar" style="--value:68%"><i></i></div>。',
  '- 留给学生自己写的地方：<div class="hk-write" contenteditable="true" data-placeholder="写下你的看法"></div>，或行内空格 <span class="hk-blank">（你来填）</span>。',
  '- 结尾：<footer class="hk-footer">资料来源列表 + 「由 AI 根据课程笔记生成，内容请核对」</footer>。按钮用 class="hk-btn"（次要的加 hk-ghost）。',
  '需要额外的样式可以写自己的 <style>，用 var(--hk-accent)、var(--hk-surface)、var(--hk-line)、var(--hk-muted) 这些变量，深色模式会自动适配。',
].join('\n');

const KIT_STYLE_RE = /<style data-hakcc-kit[^>]*>[\s\S]*?<\/style>\s*/gi;
const KIT_SCRIPT_RE = /<script data-hakcc-kit[^>]*>[\s\S]*?<\/script>\s*/gi;

/** 去掉网页里的组件库（改网页时把旧 HTML 交给模型之前用，省 token；改完再塞回去） */
export function stripArtifactKit(html: string): string {
  return html.replace(KIT_STYLE_RE, '').replace(KIT_SCRIPT_RE, '');
}

/** 把组件库塞进 <head> 最前面（网页自己的样式写在后面，能覆盖它）。已经有了就先去掉再塞，保证只有一份 */
export function injectArtifactKit(html: string): string {
  const clean = stripArtifactKit(html);
  const kit = `<style data-hakcc-kit>${KIT_CSS}</style>\n<script data-hakcc-kit>${KIT_JS}</script>\n`;
  if (/<head[^>]*>/i.test(clean)) {
    // 放在 charset / CSP 这几个 meta 后面：编码声明得留在文件开头
    const headOpen = clean.match(/<head[^>]*>/i)![0];
    const afterHead = clean.indexOf(headOpen) + headOpen.length;
    const rest = clean.slice(afterHead);
    const metaRun = rest.match(/^(\s*<meta[^>]*>)*/i)?.[0] ?? '';
    const at = afterHead + metaRun.length;
    return `${clean.slice(0, at)}\n${kit}${clean.slice(at)}`;
  }
  return `${kit}${clean}`;
}
