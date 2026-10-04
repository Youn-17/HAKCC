/**
 * 其余页面的演示数据：时间线、观点图谱、综合升华讨论室、知识空间助手、求助、
 * 首页的学习面板、两个练习场、使用反馈。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from './world.mjs';
// 和线上同一份识别规则（Node 22 直接读 .ts）
import { detectDrawIntent } from '../../components/drawIntent.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CONFIG = {
  id: 'cfg-deepseek', courseId: W.COURSE_ID, providerId: 'deepseek', isVerified: true,
  enabledModels: ['deepseek-flash', 'deepseek-v4-pro'], endpointUrl: null, configuredAt: W.ago(30), apiKeyMasked: 'sk-••••3f9a',
};
const title = (state, id) => state.notes.find(n => n.id === id)?.title ?? '';
const author = (state, id) => W.PEOPLE[state.notes.find(n => n.id === id)?.author_id] ?? '';

/** SSE 逐字写出。chunks 是 [事件, 间隔毫秒] 或文本（按两三个字一段写）。 */
async function streamText(send, text, { perChar = 17 } = {}) {
  for (let i = 0; i < text.length;) {
    const lineStart = text.lastIndexOf('\n', i - 1) + 1;
    const lineEnd = text.indexOf('\n', i);
    const line = text.slice(i, lineEnd === -1 ? text.length : lineEnd);
    const step = (line.trimStart().startsWith('|') && i === lineStart) ? line.length + 1 : 2 + Math.floor(Math.random() * 3);
    send({ token: text.slice(i, i + step) });
    i += step;
    await sleep(line.trimStart().startsWith('|') ? 140 : perChar * 2 + Math.random() * 20);
  }
}

export function handleMore(on, state, { nextId, me }) {
  // ── 时间线 ─────────────────────────────────────────────────────────────
  on('GET', /^\/spaces\/[^/]+\/timeline$/, () => {
    const items = [];
    for (const n of state.notes) items.push({ id: `t-${n.id}`, kind: 'note', at: n.created_at, actorId: n.author_id, actorName: W.PEOPLE[n.author_id], noteId: n.id, noteTitle: n.title });
    for (const r of state.relations) items.push({
      id: `t-${r.id}`, kind: 'build_on', at: r.created_at, actorId: r.creator_id, actorName: W.PEOPLE[r.creator_id],
      noteId: r.source_note_id, noteTitle: title(state, r.source_note_id), targetNoteId: r.target_note_id, targetNoteTitle: title(state, r.target_note_id),
      targetActorName: author(state, r.target_note_id), relationType: r.relation_type,
    });
    items.push({ id: 't-fb1', kind: 'ai_feedback', at: W.ago(2, 3), actorId: W.ME.id, actorName: '林晓', noteId: 'n-07', noteTitle: title(state, 'n-07'), triggerType: 'promising_seed', status: 'accepted' });
    items.push({ id: 't-fb2', kind: 'ai_feedback', at: W.ago(4, 1), actorId: 'u-zhouzh', actorName: '周子涵', noteId: 'n-03', noteTitle: title(state, 'n-03'), triggerType: 'no_evidence', status: 'accepted' });
    items.push({ id: 't-ch1', kind: 'ai_chat', at: W.ago(3, 2), actorId: 'u-limz', actorName: '李明哲', noteId: 'n-04', noteTitle: title(state, 'n-04') });
    items.sort((a, b) => b.at.localeCompare(a.at));
    return { items, generatedAt: W.NOW.toISOString() };
  });

  // ── 观点图谱 ───────────────────────────────────────────────────────────
  on('GET', /^\/groups\/[^/]+\/idea-graph$/, () => {
    const C = (id, term, noteIds, authorCount, score, delta, isNew = false) => ({ id, term, noteIds, authorCount, score, delta, isNew });
    const concepts = [
      C('c1', '独立思考', ['n-01', 'n-02', 'n-04', 'n-06'], 4, 0.92, 2),
      C('c2', '检索练习', ['n-05', 'n-13'], 2, 0.71, null, true),
      C('c3', '先猜再查', ['n-02', 'n-06', 'n-05'], 3, 0.78, 3),
      C('c4', '提纲', ['n-07', 'n-08'], 2, 0.66, null, true),
      C('c5', '理解', ['n-09', 'n-10', 'n-11', 'n-12'], 4, 0.88, 1),
      C('c6', '概率预测', ['n-09', 'n-11'], 2, 0.54, 0),
      C('c7', '检查 AI 的错', ['n-03', 'n-07'], 2, 0.62, 1),
      C('c8', '判断标准', ['n-06', 'n-10', 'n-11'], 3, 0.69, 2),
    ];
    const notes = state.notes.filter(n => n.type !== 'ai_dialogue').map(n => ({
      id: n.id, title: n.title, author: W.PEOPLE[n.author_id], createdAt: n.created_at,
      conceptIds: concepts.filter(c => c.noteIds.includes(n.id)).map(c => c.id),
      builtOnBy: state.relations.filter(r => r.target_note_id === n.id).length,
      buildsOn: state.relations.filter(r => r.source_note_id === n.id).length, isAiGenerated: false,
    }));
    return {
      graph: {
        id: 'ig-1', generated_at: W.ago(0, 2), window_start: W.ago(7), window_end: W.ago(0, 2), note_count: notes.length, trigger: 'auto',
        payload: {
          concepts,
          conceptLinks: [
            { source: 'c1', target: 'c3', weight: 3 }, { source: 'c1', target: 'c7', weight: 1 }, { source: 'c2', target: 'c3', weight: 2 },
            { source: 'c4', target: 'c7', weight: 2 }, { source: 'c5', target: 'c6', weight: 2 }, { source: 'c5', target: 'c8', weight: 3 },
            { source: 'c1', target: 'c8', weight: 1 }, { source: 'c3', target: 'c8', weight: 1 },
          ],
          notes,
          progress: {
            questions: [
              { noteId: 'n-04', title: title(state, 'n-04'), author: '李明哲', answered: true },
              { noteId: 'n-08', title: title(state, 'n-08'), author: '周子涵', answered: false },
              { noteId: 'n-12', title: title(state, 'n-12'), author: '李明哲', answered: false },
            ],
            unanswered: [
              { noteId: 'n-08', title: title(state, 'n-08'), author: '周子涵', daysOpen: 2 },
              { noteId: 'n-05', title: title(state, 'n-05'), author: '赵一凡', daysOpen: 4 },
            ],
            growing: [{ term: '先猜再查', delta: 3, isNew: false }, { term: '独立思考', delta: 2, isNew: false }, { term: '判断标准', delta: 2, isNew: false }, { term: '检索练习', delta: 2, isNew: true }],
            chains: [
              { rootId: 'n-01', rootTitle: title(state, 'n-01'), depth: 4, participants: 5 },
              { rootId: 'n-09', rootTitle: title(state, 'n-09'), depth: 3, participants: 4 },
            ],
            headline: '这一周讨论集中在「独立思考」和「理解」两条线索上。',
          },
          stats: { noteCount: notes.length, newNoteCount: 7, memberCount: 5, activeMemberCount: 5, buildOnCount: 11, buildOnByMembers: 9, aiNoteCount: 0 },
        },
      },
      periodDays: 7, regenerated: false,
    };
  });

  // ── 综合升华讨论室 ─────────────────────────────────────────────────────
  const AGENTS = [
    { id: 'idea_coach', nameZh: '刨根问底', nameEn: 'Pins it down', habitZh: '你说的那个词到底指什么', habitEn: 'What exactly do you mean by that?', avatar: '问' },
    { id: 'rise_above_coach', nameZh: '爱举例子', nameEn: 'Wants examples', habitZh: '说得太虚了，举个具体的', habitEn: 'Too abstract — give me a case', avatar: '例' },
    { id: 'gap_finder', nameZh: '爱唱反调', nameEn: 'Plays devil’s advocate', habitZh: '那如果反过来想呢', habitEn: 'What if the opposite were true?', avatar: '反' },
    { id: 'evidence_broker', nameZh: '爱查资料', nameEn: 'Checks sources', habitZh: '这个有依据吗，我去找找', habitEn: 'Any evidence for that?', avatar: '查' },
    { id: 'connection_scout', nameZh: '记性特别好', nameEn: 'Remembers everything', habitZh: '上周好像有人说过类似的', habitEn: 'Someone said something like this before', avatar: '记' },
  ];
  const AGENT_REPLIES = {
    gap_finder: '那如果反过来想呢：有人先看了 AI 的答案，再一条条去挑它的错，这也是在动脑子。子涵那条说的就是这种情况。所以「什么时候用」真的是唯一的差别吗？',
    idea_coach: '你们说的「想」，指的是自己得出答案，还是判断别人的答案对不对？这两个不是一回事。',
    evidence_broker: '一凡那条引的检索练习研究可以当依据，不过它比的是回想和重读，没有直接比较用不用 AI。',
  };
  state.rooms ??= {};
  on('GET', /^\/spaces\/[^/]+\/riseabove-rooms$/, () => ({ rooms: Object.values(state.rooms).map(r => ({ ...r.room, card_x: null, card_y: null, created_at: W.ago(0, 0, 1) })) }));
  on('POST', /^\/spaces\/[^/]+\/riseabove-rooms$/, ({ body }) => {
    const id = nextId('room');
    state.rooms[id] = {
      room: { id, space_id: W.SPACE_ID, course_id: W.COURSE_ID, group_id: W.GROUP_ID, created_by: me().id, source_note_ids: body.source_note_ids ?? [], title: body.title ?? null, status: 'open', published_note_id: null },
      messages: [],
    };
    return { room: { id } };
  });
  on('GET', /^\/riseabove-rooms\/(?<id>[^/]+)$/, ({ params }) => {
    const r = state.rooms[params.id];
    if (!r) return { room: null };
    return {
      room: r.room,
      sourceNotes: r.room.source_note_ids.map(id => { const n = state.notes.find(x => x.id === id); return { id, title: n?.title ?? null, content: n?.content ?? null, author_name: W.PEOPLE[n?.author_id] ?? null }; }),
      messages: r.messages,
      agents: AGENTS,
    };
  });
  on('POST', /^\/riseabove-rooms\/(?<id>[^/]+)\/messages$/, async ({ params, body }) => {
    const r = state.rooms[params.id];
    const out = [{ id: nextId('rm'), sender_id: me().id, sender_name: me().name, sender_kind: 'user', agent_mode: null, content: body.content, payload: null, created_at: new Date().toISOString() }];
    if (body.mention) {
      await sleep(2600);
      out.push({ id: nextId('rm'), sender_id: null, sender_name: null, sender_kind: 'ai', agent_mode: body.mention, content: AGENT_REPLIES[body.mention] ?? '能再说具体一点吗？', payload: null, created_at: new Date().toISOString() });
    } else {
      await sleep(300);
    }
    r.messages.push(...out);
    return { messages: out };
  });
  on('POST', /^\/riseabove-rooms\/(?<id>[^/]+)\/publish$/, ({ params, body }) => {
    const r = state.rooms[params.id];
    const src = r.room.source_note_ids.map(id => state.notes.find(n => n.id === id)).filter(Boolean);
    const x = Math.round(src.reduce((s, n) => s + n.x, 0) / Math.max(1, src.length));
    const y = Math.min(...src.map(n => n.y)) - 230;
    const note = {
      id: nextId('n'), space_id: W.SPACE_ID, author_id: me().id, type: 'riseabove', title: body.title, content: `<p>${body.content}</p>`,
      x, y, width: 300, height: 180, tags: [], metadata: { riseabove_room_id: params.id }, views: [], cited_note_ids: r.room.source_note_ids,
      rise_above_data: { sourceNoteIds: r.room.source_note_ids }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), users: { name: me().name },
    };
    state.notes.push(note);
    for (const s of src) state.relations.push({ id: nextId('r'), space_id: W.SPACE_ID, source_note_id: s.id, target_note_id: note.id, relation_type: 'synthesize', creator_id: me().id, ai_suggested: false, created_at: note.created_at, users: { name: me().name } });
    r.room.status = 'published'; r.room.published_note_id = note.id;
    return { note: { id: note.id, title: note.title } };
  });

  // ── 知识空间 AI 助手 ───────────────────────────────────────────────────
  on('GET', /^\/ai\/usage$/, () => ({ usage: { today: 6, total: 118, daily_limit: 100, remaining: 94 } }));
  on('GET', /^\/workspace-agent\/[^/]+\/configs$/, () => ({ aiConfigs: [CONFIG] }));
  on('GET', /^\/workspace-agent\/[^/]+\/conversations$/, () => ({ conversations: [] }));
  on('POST', /^\/workspace-agent\/[^/]+\/conversations$/, () => ({ conversation: { id: nextId('ac'), title: '知识空间对话', updated_at: new Date().toISOString() }, aiConfigs: [CONFIG] }));
  on('GET', /^\/workspace-agent\/[^/]+\/conversations\/[^/]+\/messages$/, () => ({ messages: [] }));
  on('POST', /^\/workspace-agent\/[^/]+\/digest$/, async ({ body }) => {
    await sleep(2600);
    return {
      digest: {
        scope: body.scope ?? 'view', scopeLabel: '当前 View', noteCount: 13, authorCount: 8,
        questions: [
          { text: '「自己思考」到底指什么，查资料算不算？', noteIds: ['n-04', 'n-06'] },
          { text: '先写提纲要花多少时间，赶作业时还做得到吗？', noteIds: ['n-08'] },
        ],
        positions: [{
          topic: 'AI 让人思考得更少还是更多',
          views: [
            { summary: '「先猜」这一步被省掉了，思考被外包', who: '王雨桐、陈思远', noteIds: ['n-01', 'n-02'] },
            { summary: '把 AI 的回答当成要检查的对象，反而要多想', who: '周子涵、林晓', noteIds: ['n-03', 'n-07'] },
          ],
        }],
        agreements: [{ text: '看到答案之前先有自己的猜测，是判断有没有「自己思考」的关键', noteIds: ['n-06', 'n-05'] }],
        notBuiltOn: [{ noteId: 'n-08', title: title(state, 'n-08'), author: '周子涵', daysOpen: 2 }],
        stats: { notes: 13, authors: 8, buildOns: 11, aiNotes: 0 },
      },
    };
  });
  on('POST', /^\/workspace-agent\/[^/]+\/stream$/, async ({ res, body }) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (obj) => res.write(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`);
    // 和真后端一样：「画一张……」这类指令不经对话模型，先推 drawing 让前端放绘图动画，画好再给图
    if (detectDrawIntent(body.content)) {
      send({ drawing: { prompt: body.content } });
      await sleep(6500);
      const markdown = `![${String(body.content).slice(0, 60)}](/api/files/demo/retrieval-diagram.png)`;
      send({ token: markdown });
      send({ assistantMessage: { id: nextId('am'), content: markdown, tools_used: ['generate_image'] } });
      send({ done: true, conversationId: nextId('ac'), toolsUsed: ['generate_image'], iterations: 0 });
      send('[DONE]');
      res.end();
      return;
    }
    const wantsImage = /示意图|画一张|画个|配图/.test(body.content ?? '');
    const reasoning = wantsImage
      ? ['学生想要一张示意图，说明检索练习和重读的差别。', '先看空间里有没有相关笔记，一凡那条引了 Roediger 和 Karpicke 的研究。', '图里只放两条路径和一周后的结果，文字要短。']
      : ['学生想知道哪些问题还没人回应。', '先把空间里的提问类笔记找出来，再看每条有没有收到 Build-on。', '子涵问林晓的那条还没有回复，明哲关于理解分程度的问题也只有一条延伸。'];
    await sleep(500);
    for (const r of reasoning) { send({ reasoningStatus: 'thinking', reasoningChunk: r }); await sleep(1300); }
    const tools = wantsImage ? [['search_notes', '找到 3 条相关笔记', 900], ['generate_image', '已生成 1 张图', 5200]] : [['search_notes', '找到 4 条提问', 1100], ['get_workspace_summary', '13 条笔记 · 11 次 Build-on', 700]];
    send({ reasoningStatus: 'answering' });
    for (const [name, summary, ms] of tools) {
      send({ toolStatus: 'running', toolName: name });
      await sleep(ms);
      send({ toolStatus: 'used', toolName: name, toolNames: [name], toolSummary: summary, toolDurationMs: ms });
      await sleep(250);
    }
    const text = wantsImage
      ? ['按一凡那条笔记里的研究画了一张对比图：', '', '![检索练习与重读的对比](/api/files/demo/retrieval-diagram.png)', '', '左边是读完后自己回想一遍，右边是把材料再读一遍。图只表示两种做法的走向，具体数字请回到原研究核对。'].join('\n')
      : ['这块画布上还没人回应的提问有两条：', '', '1. **「先写提纲要花多久？时间紧的时候还做得到吗？」**（周子涵）这是问林晓的，两天了还没有回复。', '2. **「那「理解」能不能分程度？」**（李明哲）目前只有一条延伸，没有人正面回答。', '', '另外，赵一凡那条「检索练习」的证据还没有人接着用。想推进讨论，可以从第一条开始。'].join('\n');
    await streamText(send, text);
    send({ assistantMessage: { id: nextId('am'), content: text } });
    send({ done: true, conversationId: nextId('ac') });
    send('[DONE]');
    res.end();
  });
  on('GET', /^\/files\/demo\/(?<f>[^/]+)$/, ({ res, params }) => {
    const name = decodeURIComponent(params.f);
    const file = path.join(HERE, 'assets', name === '本周阅读：检索练习导读.md' ? 'reading.md' : name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const type = file.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'image/png';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  // ── 文档阅读页：批注、文档 AI ──────────────────────────────────────────
  on('GET', /^\/notes\/n-att-1\/annotations$/, () => {
    const a = (id, parentId, who, name, quote, body, h) => ({
      id, noteId: 'n-att-1', parentId, authorId: who, authorName: name, authorAvatar: null,
      anchor: quote ? { kind: 'text', headingId: null, quote } : {}, quote, body, resolved: false, createdAt: W.ago(0, h), updatedAt: W.ago(0, h),
    });
    return { annotations: [
      a('an-1', null, 'u-wangyt', '王雨桐', '隔几分钟就测，重读的一组略好一些。', '这一点很关键：刚读完的时候重读更好，所以我们平时会以为重读有效。', 20),
      a('an-2', null, 'u-zhaoyf', '赵一凡', '直接读 AI 给的总结，很像实验里的「重读」', '可以和画布上那条「检索练习」的证据笔记对照着看。', 9),
      a('an-3', 'an-2', W.ME.id, '林晓', null, '我的笔记里正好用得上，已经在对照了。', 2),
    ] };
  });
  on('GET', /^\/notes\/n-att-1\/doc-chat$/, () => ({ threads: [] }));
  on('GET', /^\/notes\/n-att-1\/document-text$/, () => ({ text: fs.readFileSync(path.join(HERE, 'assets', 'reading.md'), 'utf8'), source: 'plain', pending: false }));

  // ── 求助 ───────────────────────────────────────────────────────────────
  state.support ??= [];
  on('GET', /^\/support\/questions\/mine$/, () => ({ questions: state.support }));
  on('POST', /^\/support\/questions$/, async ({ body }) => {
    await sleep(2800);
    const q = {
      id: nextId('sq'), courseId: W.COURSE_ID, spaceId: W.SPACE_ID, userId: me().id, userName: me().name, question: body.question,
      aiAnswer: '先按这三步找：\n1. 看顶栏的 **VIEW** 是不是切到了别的画布，切回 Welcome 试试。\n2. 点右下角的「重置视图」，画面会回到默认位置。\n3. 确认写完点过右下角的 **贡献**。只写不点贡献，笔记不会出现在画布上。\n\n三步都查过还是没有，点下面的「没解决，转给老师」。',
      aiProvider: 'deepseek', aiModel: 'deepseek-flash', aiResolved: null, escalatedAt: null, escalationNote: null, teacherAnswer: null, teacherAnsweredAt: null,
      status: 'ai_answered', attachments: body.attachments ?? [],
      // 和真接口一样，回答依据由服务端写进处境
      context: { ...(body.context ?? {}), grounding: { manual: [{ num: '15', title: '常见问题' }, { num: '04', title: '写一条笔记' }], teacherAnswers: 0, covered: true, matched: [] } },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    state.support.unshift(q);
    return { question: q };
  });
  on('PATCH', /^\/support\/questions\/(?<id>[^/]+)$/, ({ params, body }) => {
    const q = state.support.find(x => x.id === params.id);
    if (q) Object.assign(q, body.resolved ? { status: 'resolved', aiResolved: true } : body.escalate ? { status: 'escalated', escalatedAt: new Date().toISOString(), escalationNote: body.note ?? null } : {});
    return { question: q };
  });

  // ── 首页学习面板 ───────────────────────────────────────────────────────
  on('GET', /^\/dashboard\/courses\/[^/]+\/my-learning-insights$/, () => ({
    insights: {
      hasProfile: true, scaffoldingLevel: 'medium', interactionCount: 16, questionsAsked: 5, evidenceCited: 2, connectionsMade: 4,
      reflections: [
        { id: 'rf-1', type: 'insight', content: '先写提纲再问 AI，能看出它哪些地方在套话。', keywords: ['提纲', 'AI'], createdAt: W.ago(2, 4) },
        { id: 'rf-2', type: 'question', content: '记得少是因为没复述，还是因为用了 AI？', keywords: ['检索练习'], createdAt: W.ago(0, 1) },
      ],
      reflectionCount: 2,
      feedbackSummary: { total: 6, accepted: 4, acceptanceRate: 67, byType: { no_evidence: 3, promising_seed: 2, unclear: 1 } },
      lastInteractionAt: W.ago(0, 1),
    },
  }));
  on('GET', /^\/dashboard\/student-promising-ideas$/, () => ({
    promisingIdeas: [
      { id: 'n-07', title: title(state, 'n-07'), createdAt: state.notes.find(n => n.id === 'n-07').created_at, buildOns: 1, promisingFlags: 1, deepRelations: 0, score: 0.82 },
      { id: 'n-13', title: title(state, 'n-13'), createdAt: state.notes.find(n => n.id === 'n-13').created_at, buildOns: 0, promisingFlags: 0, deepRelations: 0, score: 0.41 },
    ],
    similarPeers: [
      { peerNoteId: 'n-05', peerNoteTitle: title(state, 'n-05'), peerName: '赵一凡', myNoteId: 'n-13', myNoteTitle: title(state, 'n-13'), sharedConcepts: ['检索练习', '记忆'], alreadyInteracted: false },
      { peerNoteId: 'n-03', peerNoteTitle: title(state, 'n-03'), peerName: '周子涵', myNoteId: 'n-07', myNoteTitle: title(state, 'n-07'), sharedConcepts: ['检查 AI 的错'], alreadyInteracted: true },
    ],
    riseAboveClusters: [{ themes: ['独立思考', '先猜再查'], notes: ['n-02', 'n-03', 'n-06'].map(id => ({ id, title: title(state, id), createdAt: state.notes.find(n => n.id === id).created_at })) }],
  }));
  on('GET', /^\/dashboard\/student-knowledge-graph$/, () => {
    const mine = ['n-07', 'n-13'];
    const peers = ['n-03', 'n-08', 'n-05', 'n-02'];
    const concepts = [['k-1', '检索练习', 2], ['k-2', '提纲', 2], ['k-3', '独立思考', 3], ['k-4', '检查 AI 的错', 2]];
    const nodes = [
      ...mine.map(id => ({ id, kind: 'mine', label: title(state, id), noteType: 'note', courseTitle: W.COURSE.title, authorName: '林晓', createdAt: state.notes.find(n => n.id === id).created_at })),
      ...peers.map(id => ({ id, kind: 'peer', label: title(state, id), noteType: 'note', courseTitle: W.COURSE.title, authorName: author(state, id), createdAt: state.notes.find(n => n.id === id).created_at })),
      ...concepts.map(([id, label, noteCount]) => ({ id, kind: 'concept', label, noteCount })),
    ];
    const edges = [
      { source: 'n-07', target: 'n-03', kind: 'relation', relationType: 'extend' }, { source: 'n-08', target: 'n-07', kind: 'relation', relationType: 'question' },
      { source: 'n-13', target: 'k-1', kind: 'contains' }, { source: 'n-05', target: 'k-1', kind: 'contains' }, { source: 'n-07', target: 'k-2', kind: 'contains' },
      { source: 'n-08', target: 'k-2', kind: 'contains' }, { source: 'n-02', target: 'k-3', kind: 'contains' }, { source: 'n-13', target: 'k-3', kind: 'contains' },
      { source: 'n-03', target: 'k-4', kind: 'contains' }, { source: 'n-07', target: 'k-4', kind: 'contains' },
    ];
    return { graph: { nodes, edges, concepts: concepts.map(([, term, noteCount]) => ({ term, noteCount })), courses: [{ id: W.COURSE_ID, title: W.COURSE.title }], stats: { myNotes: 2, peerNotes: 4, concepts: 4, connections: edges.length } } };
  });

  // ── 练习场 ─────────────────────────────────────────────────────────────
  on('GET', /^\/thinking-trainer\/profile$/, () => ({
    profile: { totalXp: 1340, level: 4, nextLevelXp: 1600, skills: { clarity: 72, evidence: 58, logic: 66, questioning: 81, perspective: 54 }, gamesPlayed: 11, streakDays: 3, bestScores: { fallacy: 86, arena: 74, ladder: 5 } },
    recentSessions: [
      { id: 'ts-1', mode: 'ladder', topic: 'AI 会不会让人不愿意思考', score: 5, status: 'completed', created_at: W.ago(1, 3) },
      { id: 'ts-2', mode: 'fallacy', topic: '「大家都在用，所以一定有效」', score: 86, status: 'completed', created_at: W.ago(3, 2) },
      { id: 'ts-3', mode: 'arena', topic: '期末考试应不应该允许用 AI', score: 74, status: 'completed', created_at: W.ago(5, 5) },
    ],
  }));
  on('GET', /^\/coding-trainer\/profile$/, () => ({
    profile: { totalXp: 860, level: 3, nextLevelXp: 1000, skills: { decomposition: 70, abstraction: 55, algorithms: 62, debugging: 68, specification: 74 }, challengesCompleted: 7, bugsFixed: 5, gamesPlayed: 14, streakDays: 2, bestScores: { challenge: 92, debug: 80 } },
    recentSessions: [
      { id: 'cs-1', mode: 'challenge', title: '统计一段文字里每个词出现的次数', score: 92, status: 'completed', created_at: W.ago(1, 6) },
      { id: 'cs-2', mode: 'debug', title: '成绩排序结果不对', score: 80, status: 'completed', created_at: W.ago(4, 2) },
    ],
  }));

  // ── 图灵测试（学生端，对话进行中）──────────────────────────────────────
  on('GET', /^\/turing-test\/[^/]+\/[^/]+\/me$/, ({ query }) => {
    const now = Date.now();
    const members = [['p-me', '青柠', true], ['p-2', '白桦'], ['p-3', '松果'], ['p-4', '云朵'], ['p-5', '橘子'], ['p-6', '石头']]
      .map(([id, alias, isMe]) => ({ id, alias, is_me: !!isMe }));
    const lines = [
      ['p-2', '白桦', '我觉得可以带，反正以后工作也都在用', 170], ['p-3', '松果', '那考试考的是你还是 AI 啊', 150],
      ['p-4', '云朵', '可以限定用法吧，比如只能查资料，不能让它直接写答案', 125], ['p-me', '青柠', '怎么检查是不是只查了资料？', 100],
      ['p-5', '橘子', '查不了……除非把笔试换成口试', 80], ['p-6', '石头', '口试的话一个班要考一整天', 62],
      ['p-2', '白桦', '@青柠 你们专业的考试一般多长时间', 40],
    ];
    const messages = query.after ? [] : lines.map(([pid, alias, content, sec], i) => ({ id: `tm-${i}`, participant_id: pid, alias, mine: pid === 'p-me', content, at: new Date(now - sec * 1000).toISOString() }));
    return {
      activity: { id: 'tt-1', title: '图灵测试 · 第 3 周', topic: '期末考试应不应该允许用 AI？', instructions: '和群里的人聊这个话题。时间到了以后，判断群里谁是 AI。',
        status: 'chatting', chat_minutes: 5, started_at: new Date(now - 190_000).toISOString(), ends_at: new Date(now + 110_000).toISOString(), disclose_ai_count: true },
      joined: true, in_room: true,
      room: { id: 'tr-1', my_participant_id: 'p-me', my_alias: '青柠', members, ai_count: 1 },
      messages, judgment: null, can_chat: true, can_vote: false, server_time: new Date(now).toISOString(),
    };
  });

  // ── 首页 AI 对话、使用反馈 ─────────────────────────────────────────────
  on('GET', /^\/personal-agent\/configs$/, () => ({ configs: [{ ...CONFIG, courseId: W.COURSE_ID }], courses: [{ id: W.COURSE_ID, name: W.COURSE.title }] }));
  on('GET', /^\/personal-agent\/conversations$/, () => ({ conversations: [] }));
  on('GET', /^\/platform-feedback\/letter$/, () => ({ letter: null, updatedAt: null }));
  on('GET', /^\/platform-feedback\/mine$/, () => ({ feedback: [] }));
  on('POST', /^\/events$/, () => ({ ok: true }));
}
