// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
const {animate}=vi.hoisted(()=>({animate:vi.fn((_targets:unknown,_options:Record<string,unknown>)=>({revert:vi.fn()}))}));
vi.mock('animejs',()=>({animate,stagger:()=>0}));
import {createInteractionMotion} from './useInteractionMotion';
afterEach(()=>{vi.clearAllMocks();document.body.innerHTML='';});
it('AI 插入提示不改变正文 HTML、光标或画布几何，重复提示替换旧动画',()=>{
 const editor=document.createElement('div');editor.contentEditable='true';editor.innerHTML='<div style="color:red">引用内容</div>';document.body.append(editor);
 const target=editor.firstElementChild!;vi.spyOn(target,'getBoundingClientRect').mockReturnValue({left:20,top:40,right:200,bottom:120,width:180,height:80} as DOMRect);
 const html=editor.innerHTML;const motion=createInteractionMotion(()=>true);motion.highlight(target,'insert');
 expect(editor.innerHTML).toBe(html);expect(document.querySelectorAll('[data-interaction-highlight]')).toHaveLength(1);
 const old=animate.mock.results[0].value;motion.highlight(target,'insert');expect(old.revert).toHaveBeenCalled();expect(document.querySelectorAll('[data-interaction-highlight]')).toHaveLength(1);
 motion.dispose();expect(document.querySelector('[data-interaction-highlight]')).toBeNull();expect(editor.innerHTML).toBe(html);
});
it('停止 SVG 动画会恢复原有线型，减少动态效果时不创建动画',()=>{
 const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.style.strokeDasharray='4 3';Object.assign(path,{getTotalLength:()=>80});
 const motion=createInteractionMotion(()=>true);motion.draw([path],'edge');expect(path.style.strokeDasharray).toBe('80');motion.stop('edge');expect(path.style.strokeDasharray).toBe('4 3');
 const quiet=createInteractionMotion(()=>false);quiet.draw([path]);quiet.highlight(path);expect(animate).toHaveBeenCalledTimes(1);quiet.dispose();motion.dispose();
});
it('动画结束后清除临时提示；滚动或输入立即结束提示',()=>{
 const el=document.createElement('div');document.body.append(el);vi.spyOn(el,'getBoundingClientRect').mockReturnValue({left:1,top:1,width:100,height:50,right:101,bottom:51} as DOMRect);
 const motion=createInteractionMotion(()=>true);motion.highlight(el);
 const options=animate.mock.calls.at(-1)![1];(options.onComplete as ()=>void)();expect(document.querySelector('[data-interaction-highlight]')).toBeNull();
 motion.highlight(el);document.dispatchEvent(new Event('scroll'));expect(document.querySelector('[data-interaction-highlight]')).toBeNull();
 motion.highlight(el);document.dispatchEvent(new Event('input'));expect(document.querySelector('[data-interaction-highlight]')).toBeNull();
 motion.highlight(el);document.dispatchEvent(new Event('wheel'));expect(document.querySelector('[data-interaction-highlight]')).toBeNull();
 motion.highlight(el);document.dispatchEvent(new Event('keydown'));expect(document.querySelector('[data-interaction-highlight]')).toBeNull();motion.dispose();
});
