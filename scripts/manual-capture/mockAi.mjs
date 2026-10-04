/**
 * AI 相关接口的演示实现：笔记对话（逐字流式）、自动反馈、反馈处理。
 *
 * 回复内容是事先写好的（scripts.mjs），按学生问题里的关键词挑一段。
 * 流式节奏按 DeepSeek Flash 的实际观感设定：先「思考」一两秒，再以每秒六十字左右吐字。
 */
import * as W from './world.mjs';
import { pickReply, FEEDBACKS } from './scripts.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CONFIG = {
  id: 'cfg-deepseek', courseId: W.COURSE_ID, providerId: 'deepseek', isVerified: true,
  enabledModels: ['deepseek-flash', 'deepseek-v4-pro'], endpointUrl: null, configuredAt: W.ago(30), apiKeyMasked: 'sk-••••3f9a',
};

export function handleAi(on, state, { nextId, me }) {
  const threadFor = (noteId) => (state.conversations[noteId] ??= []);
  const findThread = (id) => Object.values(state.conversations).flat().find(t => t.id === id);
  const notFound = (res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Conversation not found' }));
  };
  /** 和真后端一样：列表里每段带学生问的第一句，还没问过话的空白对话是 null */
  const firstQuestion = (id) => {
    const q = (state.messages[id] ?? []).find(m => m.senderKind === 'user');
    return q ? String(q.content).replace(/\s+/g, ' ').trim().slice(0, 80) : null;
  };
  const lastActive = (t) => (state.messages[t.id] ?? []).at(-1)?.createdAt ?? t.updatedAt;

  on('GET', /^\/courses\/[^/]+\/ai-configs$/, () => ({ configs: [CONFIG] }));
  on('GET', /^\/notes\/(?<id>[^/]+)\/conversations$/, ({ params }) => ({
    conversations: threadFor(params.id)
      .filter(t => !t.deletedAt)
      .sort((a, b) => String(lastActive(b)).localeCompare(String(lastActive(a))))
      .map(t => ({ ...t, updatedAt: lastActive(t), preview: firstQuestion(t.id) })),
    aiConfigs: [CONFIG], courseId: W.COURSE_ID, spaceId: W.SPACE_ID,
  }));
  // 和真后端一样：force_new（点「新建对话」）手头有空白对话就回它，否则新开一段；
  // 不带 force_new（第一次问 AI 时开线程）同一个人、同一个模型只有一条
  on('POST', /^\/notes\/(?<id>[^/]+)\/conversations$/, ({ params, body }) => {
    const mine = threadFor(params.id).filter(t => !t.deletedAt && t.createdBy === me().id && t.targetType === (body.target_type ?? 'ai'));
    if (body.force_new) {
      const blank = mine.find(t => (state.messages[t.id] ?? []).length === 0);
      if (blank) return { conversation: { ...blank, preview: null } };
    } else {
      const same = mine.find(t => t.providerId === (body.provider_id ?? 'deepseek') && t.model === (body.model ?? 'deepseek-flash'));
      if (same) return { conversation: same };
    }
    const t = {
      id: nextId('th'), noteId: params.id, spaceId: W.SPACE_ID, courseId: W.COURSE_ID, targetType: body.target_type ?? 'ai',
      providerId: body.provider_id ?? 'deepseek', model: body.model ?? 'deepseek-flash', title: body.title,
      createdBy: me().id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      participants: [{ userId: me().id, role: 'owner', user: { id: me().id, name: me().name } }],
    };
    threadFor(params.id).unshift(t);
    state.messages[t.id] = [];
    return { conversation: { ...t, preview: null } };
  });
  // 删除只是打标记：消息还在（研究数据），只是不再显示
  on('DELETE', /^\/note-conversations\/(?<tid>[^/]+)$/, ({ params, res }) => {
    const t = findThread(params.tid);
    if (!t || t.deletedAt) return notFound(res);
    t.deletedAt = new Date().toISOString();
    return { ok: true };
  });
  on('GET', /^\/note-conversations\/(?<tid>[^/]+)\/messages$/, ({ params, res }) => {
    const t = findThread(params.tid);
    if (t?.deletedAt) return notFound(res);
    return { messages: state.messages[params.tid] ?? [] };
  });

  const stream = async ({ res, params, body }) => {
    const list = (state.messages[params.tid] ??= []);
    const userMessage = {
      id: nextId('m'), threadId: params.tid, senderId: me().id, senderKind: 'user', content: body.content ?? '',
      attachments: [], aiMetadata: {}, createdAt: new Date().toISOString(), sender: { id: me().id, name: me().name },
    };
    const reply = pickReply(body.content ?? '', body.agent_mode);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (obj) => res.write(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`);
    // 线上写库要几百毫秒；立刻入库的话，前端新建线程时那次拉历史会先拿到它，界面上出现两条
    await sleep(250);
    list.push(userMessage);
    send({ userMessage });
    let chars = 0;
    const thinkMs = reply.thinkMs ?? 1800;
    for (let t = 0; t < thinkMs; t += 300) {
      chars += 40 + Math.floor(Math.random() * 30);
      send({ reasoningStatus: 'thinking', reasoningChars: chars });
      await sleep(300);
    }
    send({ reasoningStatus: 'answering', reasoningChars: chars });
    let full = '';
    const text = reply.text;
    for (let i = 0; i < text.length;) {
      // 表格行、代码行整行吐出：模型按 token 出字，但表格行在网页上本来就是等整行到齐才成形
      const lineEnd = text.indexOf('\n', i);
      const line = text.slice(i, lineEnd === -1 ? text.length : lineEnd);
      let step;
      if (line.trimStart().startsWith('|') && i === (text.lastIndexOf('\n', i - 1) + 1)) step = line.length + 1;
      else step = 2 + Math.floor(Math.random() * 3);
      const piece = text.slice(i, i + step);
      full += piece;
      send({ token: piece });
      i += step;
      await sleep(line.trimStart().startsWith('|') ? 140 : 32 + Math.floor(Math.random() * 18));
    }
    const assistantMessage = {
      id: nextId('m'), threadId: params.tid, senderKind: 'assistant', content: full, attachments: [],
      aiMetadata: { provider_id: 'deepseek', model: 'deepseek-flash', streamed: true, reasoningStatus: 'done', reasoningChars: chars,
        agent_mode: body.agent_mode ?? 'free_ask', toolsUsed: reply.tools ?? [] },
      createdAt: new Date().toISOString(),
    };
    list.push(assistantMessage);
    send({ reasoningStatus: 'done', reasoningChars: chars });
    send({ assistantMessage });
    send('[DONE]');
    res.end();
  };
  on('POST', /^\/note-conversations\/(?<tid>[^/]+)\/ai\/stream$/, stream);
  on('POST', /^\/note-conversations\/(?<tid>[^/]+)\/ai\/agent-stream$/, stream);

  // 「画一张……」：前端识别后直接调出图接口。真后端 DMX 大多六到十秒，这里等 6.5 秒，好看到绘图动画
  on('POST', /^\/note-conversations\/(?<tid>[^/]+)\/image$/, async ({ params, body }) => {
    const list = (state.messages[params.tid] ??= []);
    const prompt = String(body.prompt ?? '');
    const userMessage = {
      id: nextId('m'), threadId: params.tid, senderId: me().id, senderKind: 'user', content: prompt,
      attachments: [], aiMetadata: { direct_image: true }, createdAt: new Date().toISOString(), sender: { id: me().id, name: me().name },
    };
    list.push(userMessage);
    await sleep(6500);
    // 笔记 AI 助手只显示完整 http(s) 地址的图（线上出图转存后就是完整地址）
    const imageUrl = `http://127.0.0.1:${process.env.CAPTURE_PORT ?? 5288}/api/files/demo/retrieval-diagram.png`;
    const assistantMessage = {
      id: nextId('m'), threadId: params.tid, senderKind: 'assistant',
      content: `![${prompt.slice(0, 60)}](${imageUrl})`,
      attachments: [], aiMetadata: { direct_image: true, model: 'qwen-image-plus' }, createdAt: new Date().toISOString(),
    };
    list.push(assistantMessage);
    return { userMessage, assistantMessage, imageUrl, model: 'qwen-image-plus' };
  });

  // ── 自动反馈 ───────────────────────────────────────────────────────────
  const list = (noteId) => (state.feedbacks[noteId] ??= []);
  on('GET', /^\/notes\/(?<id>[^/]+)\/ai-feedback$/, ({ params }) => ({ feedbacks: list(params.id) }));
  const produce = async ({ params, body }, forced) => {
    const plan = state.feedbackPlan[params.id] ?? 'none';
    await sleep(forced ? 2400 : 1700);
    const spec = FEEDBACKS[plan];
    if (!spec) return { triggered: false, reason: 'no_trigger' };
    const fb = {
      id: nextId('fb'), noteId: params.id, spaceId: W.SPACE_ID, courseId: W.COURSE_ID, userId: me().id,
      providerId: 'deepseek', model: 'deepseek-flash', triggerType: spec.triggerType, triggerContext: { chain: 'editor_inline' },
      draftExcerpt: String(body.content ?? '').replace(/<[^>]+>/g, '').slice(0, 120), feedbackText: spec.text,
      status: 'new', createdAt: new Date().toISOString(), suggestedScaffold: spec.scaffold ?? null, suggestedScaffoldUsedAt: null,
    };
    list(params.id).unshift(fb);
    state.feedbackPlan[params.id] = 'none';
    return { triggered: true, feedback: fb };
  };
  on('POST', /^\/notes\/(?<id>[^/]+)\/ai-feedback\/check$/, (ctx) => produce(ctx, false));
  on('POST', /^\/notes\/(?<id>[^/]+)\/ai-feedback\/request$/, (ctx) => produce(ctx, true));
  on('POST', /^\/notes\/(?<id>[^/]+)\/ai-feedback\/(?<fid>[^/]+)\/respond$/, ({ params, body }) => {
    const fb = list(params.id).find(f => f.id === params.fid);
    if (!fb) return { feedback: null };
    Object.assign(fb, { status: body.status, responseText: body.response_text, rejectionTag: body.rejection_tag ?? null,
      rejectionReason: body.rejection_reason ?? null, respondedAt: new Date().toISOString() });
    // 采纳：和线上一样，生成一条挂在原笔记右下方、以「延伸」连回原笔记的对话式笔记
    if (body.status === 'accepted' && !fb.publishedNoteId) {
      const origin = state.notes.find(n => n.id === params.id);
      const question = (fb.feedbackText.match(/[^。！？]*[？?]/) ?? [fb.feedbackText.slice(0, 30)])[0].trim();
      const dn = {
        id: nextId('n'), space_id: W.SPACE_ID, author_id: origin?.author_id ?? me().id, type: 'ai_dialogue', title: question,
        content: `<p>${fb.feedbackText}</p>`, x: (origin?.x ?? 0) + 240, y: (origin?.y ?? 0) + 60, width: 300, height: 180,
        is_ai_generated: true, ai_trigger_type: fb.triggerType, tags: ['ai-generated', 'accepted-feedback'], metadata: {}, views: [],
        cited_note_ids: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), users: { name: me().name },
      };
      state.notes.push(dn);
      state.relations.push({ id: nextId('r'), space_id: W.SPACE_ID, source_note_id: dn.id, target_note_id: params.id, relation_type: 'extend',
        creator_id: me().id, ai_suggested: false, created_at: dn.created_at, users: { name: me().name } });
      const t = { id: nextId('th'), noteId: dn.id, spaceId: W.SPACE_ID, courseId: W.COURSE_ID, targetType: 'ai', providerId: 'deepseek', model: 'deepseek-flash',
        title: question, createdBy: me().id, createdAt: dn.created_at, updatedAt: dn.created_at,
        participants: [{ userId: me().id, role: 'owner', user: { id: me().id, name: me().name } }] };
      (state.conversations[dn.id] ??= []).unshift(t);
      state.messages[t.id] = [{ id: nextId('m'), threadId: t.id, senderKind: 'assistant', content: fb.feedbackText, attachments: [],
        aiMetadata: { provider_id: 'deepseek', model: 'deepseek-flash', source_note_id: params.id, feedback_id: fb.id }, createdAt: dn.created_at }];
      fb.publishedNoteId = dn.id;
    }
    return { feedback: fb, published_note_id: fb.publishedNoteId ?? null };
  });
  on('POST', /^\/notes\/(?<id>[^/]+)\/ai-feedback\/(?<fid>[^/]+)\/scaffold-used$/, ({ params }) => {
    const fb = list(params.id).find(f => f.id === params.fid);
    if (fb) fb.suggestedScaffoldUsedAt = new Date().toISOString();
    return { feedback: fb };
  });
  on('POST', /^\/notes\/[^/]+\/ai-insertions$/, () => ({ ok: true }));
}
