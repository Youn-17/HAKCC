import { describe, expect, it, vi } from 'vitest';
vi.mock('../config/supabase', () => ({ supabase: {} }));
import { buildDiscussion } from './discussionAnalytics';
import type { AnalyticsInput, AnalyticsNote } from './spaceAnalytics';
const note = (id: string, authorId: string, date: string, extra: Partial<AnalyticsNote> = {}): AnalyticsNote => ({ id, authorId, title: id, content: '<p>自己的证据</p><blockquote data-ai-source="genai">AI 的答案</blockquote>', createdAt: date, updatedAt: date, authorName: null, type: 'note', aiGenerated: false, views: [], ...extra });
const input = (): AnalyticsInput => ({ notes: [note('a','amy','2026-10-01T09:00:00Z'), note('b','bo','2026-10-02T09:00:00Z'), note('c','cai','2026-10-03T09:00:00Z'), note('unrelated','bo','2026-10-03T10:00:00Z'), note('ai','amy','2026-10-04T09:00:00Z',{aiGenerated:true}), note('teacher','t','2026-10-04T09:00:00Z')], relations: [{source:'b',target:'a',type:'question',createdAt:'2026-10-02T09:00:00Z',aiSuggested:false,aiAccepted:null},{source:'c',target:'b',type:'evidence',createdAt:'2026-10-03T09:00:00Z',aiSuggested:false,aiAccepted:null}], members: ['amy','bo','cai','t'].map(id=>({id,name:id,avatar:null,isStaff:id==='t'})), feedbacks:[], scaffolds:new Map(), aiUse:new Map(), now:new Date('2026-10-10T09:00:00Z') });
describe('discussion scope', () => {
  it('待推进议题区分无人回应和提问后未见后续；证据回应会移出后者，个人视角仅列相关议题', () => {
    const data=input();
    data.relations=data.relations.slice(0,1);
    const pending=buildDiscussion(data).pending;
    expect(pending).toEqual(expect.arrayContaining([{noteId:'a',reason:'question'}, {noteId:'b',reason:'unanswered'}]));
    expect(buildDiscussion(input()).pending).not.toContainEqual({noteId:'a',reason:'question'});
    expect(buildDiscussion(data,{authorId:'amy'}).pending.map(p=>p.noteId)).not.toContain('unrelated');
  });
  it('个人视角保留整条相关接力，来源文本排除插入的 AI 内容', () => {
    const result=buildDiscussion(input(),{authorId:'amy'});
    expect(result.notes.map(n=>n.id).sort()).toEqual(['a','b','c']);
    expect(result.notes.find(n=>n.id==='a')).toMatchObject({selected:true,excerpt:'自己的证据'});
    expect(result.edges).toEqual(expect.arrayContaining([{from:'a',to:'b',type:'question',createdAt:'2026-10-02T09:00:00Z'},{from:'b',to:'c',type:'evidence',createdAt:'2026-10-03T09:00:00Z'}]));
  });
  it('时间末端不包含，范围外和未采纳的 AI 连线不会混入，循环接力也可终止',()=>{
    const data=input();
    data.relations.push({source:'a',target:'c',type:'extend',createdAt:'2026-10-03T09:00:00Z',aiSuggested:false,aiAccepted:null});
    data.relations.push({source:'unrelated',target:'a',type:'extend',createdAt:'2026-10-03T10:00:00Z',aiSuggested:true,aiAccepted:false});
    expect(buildDiscussion(data,{authorId:'amy'}).notes.map(n=>n.id).sort()).toEqual(['a','b','c']);
    const period=buildDiscussion(data,{from:'2026-10-02T00:00:00Z',until:'2026-10-03T09:00:00Z'});
    expect(period.notes.map(n=>n.id)).toEqual(['b']);expect(period.edges).toEqual([]);
  });

});
