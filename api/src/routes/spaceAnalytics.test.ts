import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 讨论分析的接口（metrics.ts 里的 /spaces/:id/analytics…，2026-10-09）：只给课程教职；
 * 词云交给 Python 进程（换成假的），笔记没变用缓存，Python 不可用时其余照常。
 */

const h = vi.hoisted(() => ({
  user: { id: 't1', role: 'teacher' },
  staff: true,
  loadSpaceAnalytics: vi.fn(),
  extractKeywords: vi.fn(),
  layoutCloud: vi.fn(),
  keywordChanges: vi.fn(),
  peerFocus: vi.fn(),
  topicCoverage: vi.fn(),
  loadTopics: vi.fn(),
  saveTopics: vi.fn(),
}));

vi.mock('../config/supabase', () => ({ supabase: {} }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { ...h.user }; next(); },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/accessControl', async () => {
  const { ApiError } = await import('../middleware/errorHandler');
  return {
    ensureSpaceAccess: async () => ({}),
    ensureNoteAccess: async () => ({}),
    ensureSpaceStaff: async () => { if (!h.staff) throw new ApiError(403, 'Course staff only'); return {}; },
  };
});
vi.mock('../services/metricsService', () => ({ getSpaceMetricsSummary: async () => ({}) }));
vi.mock('../services/spaceAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/spaceAnalytics')>()),
  loadSpaceAnalytics: h.loadSpaceAnalytics,
}));
vi.mock('../services/python/textWorker', () => ({ extractKeywords: h.extractKeywords, layoutCloud: h.layoutCloud, keywordChanges: h.keywordChanges, peerFocus: h.peerFocus, topicCoverage: h.topicCoverage }));

vi.mock('../services/analyticsTopics', async (original) => ({...(await original<typeof import('../services/analyticsTopics')>()),loadTopics:h.loadTopics,saveTopics:h.saveTopics}));
import metricsRouter from './metrics';
import { errorHandler } from '../middleware/errorHandler';

const NOW = new Date('2026-10-09T12:00:00Z');
const fixture = (signature = 'sig-1') => ({
  members: [
    { id: 'amy', name: '艾米', avatar: null, isStaff: false },
    { id: 'bo', name: '博文', avatar: null, isStaff: false },
    { id: 't1', name: '刘老师', avatar: null, isStaff: true },
  ],
  notes: [
    { id: 'n1', title: 'AI 与思考', content: '<p>先自己想再问 AI</p><div data-ai-source="genai">AI 写的一段</div>', authorId: 'amy', authorName: null, createdAt: '2026-10-08T09:00:00Z', updatedAt: null, type: 'note', aiGenerated: false, views: [] },
    { id: 'n2', title: '检索练习', content: '<p>检索练习比重读好</p>', authorId: 'bo', authorName: null, createdAt: '2026-10-09T09:00:00Z', updatedAt: null, type: 'note', aiGenerated: false, views: [] },
  ],
  relations: [{ source: 'n2', target: 'n1', type: 'extend', createdAt: '2026-10-09T09:00:00Z', aiSuggested: false, aiAccepted: null }],
  feedbacks: [],
  aiUse: new Map(),
  scaffolds: new Map(),
  now: NOW,
  signature,
});

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', metricsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => { const s = app.listen(0, '127.0.0.1', () => done(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  h.staff = true;
  h.peerFocus.mockReset().mockResolvedValue({authors:[{id:'amy',terms:[{word:'检索练习',note_ids:['n1']}]},{id:'bo',terms:[{word:'检索练习',note_ids:['n2']}]}]});
  h.loadTopics.mockReset().mockResolvedValue({topics:[{id:'t1',title:'检索练习',terms:['检索练习']}],revision:'11111111-1111-4111-8111-111111111111'});
  h.saveTopics.mockReset().mockImplementation(async(_space,_user,topics)=>({topics,revision:'22222222-2222-4222-8222-222222222222'}));
  h.topicCoverage.mockReset().mockResolvedValue({docs:2,topics:[{id:'t1',title:'检索练习',terms:['检索练习'],notes:1,students:1,note_ids:['n2'],peer_note_ids:[]}]});
  h.loadSpaceAnalytics.mockReset().mockImplementation(async () => fixture());
  h.extractKeywords.mockReset().mockResolvedValue({ terms: [{ word: '检索练习', weight: 1, count: 2, notes: 2, note_ids: ['n1', 'n2'] }], docs: 2, tokens: 9 });
  h.keywordChanges.mockReset().mockResolvedValue({terms:[],periods:{before:{docs:1,tokens:5},after:{docs:1,tokens:5}}});
  h.layoutCloud.mockReset().mockResolvedValue({ items: [{ word: '检索练习', weight: 1, size: 60, x: 10, y: 20, w: 240, h: 70, ascent: 66 }], width: 900, height: 420 });
});

const get = (path: string) => fetch(`${base}${path}`).then(async r => ({ status: r.status, body: await r.json() }));

describe('只给课程教职', () => {
  it('不是这门课的教职：三个接口都 403，什么都不读', async () => {
    h.staff = false;
    for (const path of ['/spaces/s1/analytics', '/spaces/s1/analytics/students/amy', '/spaces/s1/analytics/wordcloud']) {
      expect((await get(path)).status).toBe(403);
    }
    expect(h.loadSpaceAnalytics).not.toHaveBeenCalled();
  });
});

describe('GET /spaces/:id/analytics', () => {
  it('全班概况；带上视图就只看这个视图', async () => {
    const res = await get('/spaces/s1/analytics?view_id=v1');
    expect(res.status).toBe(200);
    expect(h.loadSpaceAnalytics).toHaveBeenCalledWith('s1', { viewId: 'v1' });
    expect(res.body.overview.summary).toMatchObject({ students: 2, notes: 2, buildOns: 1 });
    expect(res.body.overview.participation.map((p: { userId: string }) => p.userId).sort()).toEqual(['amy', 'bo']);
    expect(res.body.generatedAt).toBe(NOW.toISOString());
  });
});

describe('GET /spaces/:id/analytics/students/:userId', () => {
  it('一个学生的详情；这个空间里没有这个人就 404', async () => {
    const ok = await get('/spaces/s1/analytics/students/bo');
    expect(ok.body.student.summary).toMatchObject({ notes: 1, buildOnsGiven: 1 });
    expect((await get('/spaces/s1/analytics/students/nobody')).status).toBe(404);
  });
});

describe('GET /spaces/:id/analytics/wordcloud', () => {
  it('交给 Python 的是学生写的字（插入的 AI 内容不算），排版用请求的尺寸；笔记没变第二次用缓存', async () => {
    const first = await get('/spaces/cache-test/analytics/wordcloud?width=800&height=360');
    expect(first.body).toMatchObject({ available: true, docs: 2, terms: [{ word: '检索练习' }], cloud: { width: 900 } });
    const docs = h.extractKeywords.mock.calls[0][0] as Array<{ id: string; text: string }>;
    expect(docs.find(d => d.id === 'n1')!.text).toContain('先自己想再问 AI');
    expect(docs.find(d => d.id === 'n1')!.text).not.toContain('AI 写的一段');
    expect(h.layoutCloud).toHaveBeenCalledWith([{ word: '检索练习', weight: 1 }], { width: 800, height: 360 });
    await get('/spaces/cache-test/analytics/wordcloud?width=800&height=360');
    expect(h.extractKeywords).toHaveBeenCalledTimes(1);
    // 笔记变了（签名变了）就重算
    h.loadSpaceAnalytics.mockImplementation(async () => { const data=fixture('sig-1'); data.notes[0].content='<p>修改后的内容</p>'; return data; });
    await get('/spaces/cache-test/analytics/wordcloud?width=800&height=360');
    expect(h.extractKeywords).toHaveBeenCalledTimes(2);
  });

  it('只看一个人：只交他的笔记', async () => {
    await get('/spaces/s2/analytics/wordcloud?author_id=bo');
    expect((h.extractKeywords.mock.calls[0][0] as Array<{ id: string }>).map(d => d.id)).toEqual(['n2']);
    expect(h.extractKeywords.mock.calls[0][1]).toEqual({ topK: 40, names: ['艾米', '博文', '刘老师'] });
  });

  it('Python 不可用：available=false，不报 500', async () => {
    h.extractKeywords.mockRejectedValueOnce(new Error('python text worker exited (1)'));
    const res = await get('/spaces/s3/analytics/wordcloud');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, docs: 2, cloud: null });
  });
});

describe('GET discussion scope', () => {
  it('教职可读相关 Note 链，日期末端不包含；其他身份在任何读取前拒绝', async () => {
    const res=await get('/spaces/s1/analytics/discussion?author_id=amy&from=2026-10-08T00:00:00Z&until=2026-10-10T00:00:00Z');
    expect(res.status).toBe(200);
    expect(res.body.notes.map((n:{id:string})=>n.id)).toEqual(['n1','n2']);
    expect(res.body.edges[0]).toMatchObject({from:'n1',to:'n2'});
    expect((await get('/spaces/s1/analytics/discussion?from=invalid')).status).toBe(400);
    h.staff=false; h.loadSpaceAnalytics.mockClear();
    expect((await get('/spaces/s1/analytics/discussion')).status).toBe(403);
    expect(h.loadSpaceAnalytics).not.toHaveBeenCalled();
  });
});

describe('keyword changes route', () => {
  it('两段使用同一范围，个人只分析本人文本；筛选和词典进入缓存键且撤销教职后拒绝缓存读取', async () => {
    const path='/spaces/change-test/analytics/changes?author_id=bo&split_at=2026-10-09T00:00:00Z&extra_words=检索练习';
    const first=await get(path); expect(first.status).toBe(200); expect(first.body.available).toBe(true);
    expect(h.keywordChanges.mock.calls[0][0]).toEqual([expect.objectContaining({id:'n2',period:'after'})]);
    expect(h.keywordChanges.mock.calls[0][1]).toMatchObject({extraWords:['检索练习']});
    await get(path); expect(h.keywordChanges).toHaveBeenCalledTimes(1);
    await get(path+'&extra_stop=检索练习'); expect(h.keywordChanges).toHaveBeenCalledTimes(2);
    h.staff=false; expect((await get(path)).status).toBe(403);
    expect((await get('/spaces/change-test/analytics/changes?split_at=bad')).status).toBe(403);
    h.staff=true; expect((await get('/spaces/change-test/analytics/changes?split_at=bad')).status).toBe(400);
  });
});

describe('peer and topic tools',()=>{
 it('保存与跨请求读取教师主题，拒绝坏输入和学生写入；个人报告仍使用同范围全体原文',async()=>{
  const path='/spaces/topic-report/analytics/topics';
  const put=async(body:unknown)=>{const r=await fetch(base+path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const topics=[{id:'memory',title:'记忆',terms:['检索练习']}];
  expect((await put({topics,expectedRevision:null})).status).toBe(200);
  expect(h.saveTopics).toHaveBeenCalledWith('topic-report','t1',topics,null);
  expect((await put({topics:[{id:'bad',title:'',terms:[]}],expectedRevision:null})).status).toBe(400);
  const report=await get(path+'?author_id=amy');expect(report.status).toBe(200);expect(report.body.config.topics[0].id).toBe('t1');
  expect(h.topicCoverage.mock.calls[0][0].map((d:{id:string})=>d.id)).toEqual(['n1','n2']);expect(h.topicCoverage.mock.calls[0][2]).toBe('amy');
  h.staff=false;expect((await put({topics,expectedRevision:null})).status).toBe(403);
 });
 it('文本缓存包含字典，权限撤销不能读取缓存；主题并发修改返回 409',async()=>{
  const path='/spaces/peer-cache/analytics/peers';
  await get(path);await get(path);expect(h.peerFocus).toHaveBeenCalledTimes(1);
  await get(path+'?extra_stop=检索练习');expect(h.peerFocus).toHaveBeenCalledTimes(2);
  h.staff=false;expect((await get(path)).status).toBe(403);h.staff=true;
  const {ApiError}=await import('../middleware/errorHandler');h.saveTopics.mockRejectedValueOnce(new ApiError(409,'Changed'));
  const r=await fetch(base+'/spaces/s1/analytics/topics',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({topics:[],expectedRevision:'11111111-1111-4111-8111-111111111111'})});expect(r.status).toBe(409);
 });

 it('先鉴权再读取配置或 Python；真实连接在 Python 故障时仍保留',async()=>{
  h.staff=false;
  for(const path of ['/peers','/topics'])expect((await get('/spaces/new-tools/analytics'+path)).status).toBe(403);
  expect(h.loadTopics).not.toHaveBeenCalled();expect(h.peerFocus).not.toHaveBeenCalled();
  h.staff=true;h.peerFocus.mockRejectedValueOnce(new Error('worker unavailable'));
  const result=await get('/spaces/new-tools/analytics/peers');expect(result.status).toBe(200);expect(result.body.available).toBe(false);expect(result.body.connections).toHaveLength(1);
 });
});
