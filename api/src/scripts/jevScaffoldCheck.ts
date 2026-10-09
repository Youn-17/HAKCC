/**
 * 检验支架推荐（scaffoldRecommend.ts）：按编的草稿，Jev 从平台的 181 条全局支架里推荐得准不准、该不推荐时会不会不推荐。
 * 支架清单是 scaffoldCatalog.json（10-09 从线上库导出的全局支架，平台内容，不含学生数据）；草稿全是编的。
 *
 * 在 api/ 下运行（key 放在 api/.env 的 JEV_API_KEY）：
 *   npx ts-node --transpile-only src/scripts/jevScaffoldCheck.ts
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jevConfig } from '../config/jev';
import { askJev, jevCostUsd } from '../services/jevClient';
import { RECOMMEND_THRESHOLDS, recommendScaffold, type DraftForRecommend, type ScaffoldOption } from '../services/scaffoldRecommend';

dotenv.config();

interface Sample {
  id: string;
  draft: DraftForRecommend;
  /** 可以接受的支架（话头原文）；空数组 = 不该推荐 */
  accept: string[];
  heldOut?: boolean;
  about: string;
}

const PARENT_AI_LAZY = { title: 'AI 会让人更少思考', text: '我觉得有了 AI 以后，大家遇到问题第一反应是问 AI，自己想的过程被省掉了。' };

const SAMPLES: Sample[] = [
  { id: 'S01', draft: { title: 'AI 让人懒得动脑', text: '我觉得 AI 让人懒得动脑，因为以前查资料还要自己筛选，现在直接给答案。' }, accept: ['My theory', '我的想法/观点是', '我对这个观点的解释是'], about: '提出自己的观点' },
  { id: 'S02', draft: { title: '检索练习和做题', text: '我还是不明白检索练习和做题有什么区别，是不是只要做题就算检索练习？' }, accept: ['I need to understand'], about: '自己想弄懂的问题' },
  { id: 'S03', draft: { title: '一个实验', text: '我查到 Roediger 2006 年的实验：检索练习组一周后正确率 61%，重读组只有 40%。' }, accept: ['New Information', '我查找的文献分享如下，其要点是', '我可以提供这方面的资料或证据'], about: '分享新信息' },
  { id: 'S04', draft: { title: '解释不了', text: '这个说法解释不了为什么有的同学用了 AI 反而想得更多。', parent: PARENT_AI_LAZY }, accept: ['This theory cannot explain', '我不同意你的观点，理由是'], about: 'Build-on：指出解释不了' },
  { id: 'S05', draft: { title: '补充一点', text: '我同意，但可以再补充一点：关键不在用不用 AI，而在先自己想再问。', parent: PARENT_AI_LAZY }, accept: ['你的观点/建议很好，但还可以改进为', '我对这个观点的补充/改进', 'A better theory'], about: 'Build-on：补充改进' },
  { id: 'S06', draft: { title: '分歧在哪', text: '把大家的想法放在一起看，其实分歧在于 AI 是替代思考还是支持思考。' }, accept: ['Putting our knowledge together', '把我们的想法整合在一起', '概括总结我们的讨论', '我们讨论的要点是', '这些观点的相同/不同之处是'], about: '整合大家的观点' },
  { id: 'S07', draft: { title: 'ChatGPT 的说法', text: 'ChatGPT 说检索练习只适合记忆事实类知识，但我觉得它没考虑理解类的任务。' }, accept: ['我认为GenAI的回答/解释还缺乏', 'GenAI的回答可能带有的偏向，或没有考虑到的是', 'GenAI的回答有问题，主要在于', 'GenAI和我看法不同的地方在于'], about: '评判 AI 的回答' },
  { id: 'S08', draft: { title: '我的想法', text: '在问 AI 之前，我自己的想法是先列出三个影响因素：动机、方法和反馈。' }, accept: ['在询问GenAI之前，我自己的idea是'], about: '先想再问 AI' },
  { id: 'S09', draft: { title: '对照教材', text: '我把 AI 的回答和教材第三章对了一下，发现它把间隔练习和检索练习搞混了。' }, accept: ['我将GenAI的回答与教材和相关文献资料对照，发现', 'GenAI的这个说法，我已用别的来源进行了核对', 'GenAI出错的地方是……，我通过……发现的', '我用已有知识经验纠正了GenAI的说法，依据是'], about: '对照资料核对 AI' },
  { id: 'S10', draft: { title: '拆成小问题', text: '这个问题可以分成三个小问题：怎么收集数据、怎么分析、怎么呈现结果。' }, accept: ['我将这个问题分解为以下几个子问题', '这个问题可以从以下几步来考虑', '从以下几个方面探讨问题'], about: '分解问题' },
  { id: 'S11', draft: { title: '程序功能', text: '我写的程序实现了自动统计每组笔记数量的功能，还能导出表格。' }, accept: ['我编写的程序实现了以下功能', '我编写的程序实现的主要功能是'], about: '编程：程序功能' },
  { id: 'S12', draft: { title: '结果不对', text: '程序运行后，统计结果和手工数的不一样，第二组少了三条。' }, accept: ['运行的结果与预期有以下不同', '程序运行过程中，出现了下列问题', '程序运行的结果是', '实际执行程序后，我获得的运行结果是'], about: '编程：结果不符' },
  { id: 'S13', draft: { title: '分工', text: '我们组可以这样分工：小王查文献，小李整理观点，我负责写汇报。' }, accept: ['我们可以对这个问题/任务进行一个分工'], about: '小组分工' },
  { id: 'S14', draft: { title: '下周讨论地点', text: '下周三下午的讨论改到图书馆三楼 302。' }, accept: [], about: '通知（不该推荐）' },
  { id: 'S15', draft: { title: '出处', text: '你说的这个结论出自哪篇文献？能发一下吗？', parent: PARENT_AI_LAZY }, accept: ['你能提供这方面的资料或证据吗？', '你能分享这方面的资料吗？'], about: 'Build-on：要证据' },
  { id: 'S16', draft: { title: '更好的解释', text: '我认为更好的解释是：AI 本身不决定我们想得多还是少，决定的是使用方式。', parent: PARENT_AI_LAZY }, accept: ['A better theory', '你的观点/建议很好，但还可以改进为', '我对这个观点的补充/改进'], about: 'Build-on：更好的理论' },
  // 定好题面和门槛以后加的
  { id: 'S17', heldOut: true, draft: { title: '想法变了', text: '和 AI 聊完之后，我原来觉得 AI 有害，现在觉得关键在怎么用。' }, accept: ['与GenAI互动之前相比，我的想法变化在于', '根据GenAI给出的回答，我有了新的思路'], about: '与 AI 互动后的变化' },
  { id: 'S18', heldOut: true, draft: { title: '共同点', text: '我发现这几个案例都有一个共同点：学生都是先自己尝试，再去看答案。' }, accept: ['我发现这个问题/事物具有的共同特征是', '我发现重复出现的结构是', '我能够总结出关于这个问题/事物的规律', '我发现这个问题中有重复或常见的结构/模式是'], about: '找共同特征' },
  { id: 'S19', heldOut: true, draft: { title: '放到我们班', text: 'AI 给的方案放到我们班的情况里，需要改成每周两次小测，而且要控制在十分钟内。' }, accept: ['把GenAI的方案放到我们讨论的具体情境中，需要调整的是'], about: '把 AI 方案放进情境' },
  { id: 'S20', heldOut: true, draft: { title: '只采用第二点', text: 'AI 的回答里我只采用了第二点，因为第一点和我们收集的数据不符。' }, accept: ['GenAI的回答中，我决定采用的部分和理由是'], about: '取舍 AI 的回答' },
  { id: 'S21', heldOut: true, draft: { title: '还要讨论', text: '我们需要进一步讨论的是：评价 AI 回答好坏的标准到底是什么？' }, accept: ['我们需要进一步讨论的要点/问题是', '我判断GenAI的回答好坏的标准是'], about: '提出要继续讨论的问题' },
  { id: 'S22', heldOut: true, draft: { title: '谢谢', text: '谢谢大家，今天的讨论很有收获！' }, accept: [], about: '道谢（不该推荐）' },
  { id: 'S23', heldOut: true, draft: { title: '不同意', text: '我不太同意，用 AI 查资料其实也要自己判断真假，思考并没有少。', parent: PARENT_AI_LAZY }, accept: ['我不同意你的观点，理由是', 'This theory cannot explain'], about: 'Build-on：不同意' },
  { id: 'S24', heldOut: true, draft: { title: '算法局限', text: '我用的排序算法在数据很多的时候会很慢，可能需要换一种。' }, accept: ['这个算法可能存在的局限性是', '这个算法可能存在的局限是什么？需要如何改进？', '我还需要进行下列改进'], about: '编程：算法局限' },
];

async function main() {
  const config = jevConfig();
  if (!config.apiKey) {
    console.log('还没有 key：在 api/.env 里加一行 JEV_API_KEY=你的key。');
    process.exitCode = 1;
    return;
  }
  const catalog = JSON.parse(readFileSync(resolve(__dirname, 'scaffoldCatalog.json'), 'utf-8')) as ScaffoldOption[];
  let tokens = 0;
  const latencies: number[] = [];
  const ask: typeof askJev = async (state, questions, options) => {
    const result = await askJev(state, questions, options);
    tokens += result.usage.inputTokens;
    return result;
  };
  const titleOf = new Map(catalog.map(o => [o.id, o.title]));
  console.log(`支架推荐检验：${catalog.length} 条支架、${SAMPLES.length} 份草稿；门槛 实在内容 ${RECOMMEND_THRESHOLDS.substantive} / 合适 ${RECOMMEND_THRESHOLDS.fit}`);
  console.log('编号  结论                                   合适   内容   前三（排序概率/合适）                           对否  测的是');
  const rows: Array<{ sample: Sample; ok: boolean }> = [];
  for (const sample of SAMPLES) {
    const result = await recommendScaffold(sample.draft, catalog, { config: { ...config, timeoutMs: 8000 }, ask });
    latencies.push(result?.latencyMs ?? 0);
    const picked = result?.scaffold?.title ?? null;
    const ok = sample.accept.length === 0 ? picked === null : picked !== null && sample.accept.includes(picked);
    rows.push({ sample, ok });
    const top = (result?.candidates ?? []).map(c => `${(titleOf.get(c.id) ?? '?').slice(0, 10)}(${c.rank.toFixed(2)}/${c.fit == null ? '—' : c.fit.toFixed(2)})`).join(' ');
    console.log(`${sample.id}   ${(picked ?? '不推荐').slice(0, 30).padEnd(32)}  ${result?.fit == null ? ' — ' : result.fit.toFixed(2)}  ${result?.substantive == null ? ' — ' : result.substantive.toFixed(2)}  ${top.padEnd(52)}  ${ok ? '✓' : '✗'}    ${sample.about}${sample.heldOut ? '（后加）' : ''}${result?.error ? ` 出错:${result.error}` : ''}`);
  }
  const pct = (n: number, d: number) => `${n}/${d}（${Math.round((n / d) * 100)}%）`;
  console.log(`\n全部 ${pct(rows.filter(r => r.ok).length, rows.length)}；后加的 ${pct(rows.filter(r => r.ok && r.sample.heldOut).length, rows.filter(r => r.sample.heldOut).length)}`);
  latencies.sort((a, b) => a - b);
  console.log(`一次推荐（两次请求）用时中位数 ${latencies[Math.floor(latencies.length / 2)]} ms；输入共 ${tokens} token，约 ${jevCostUsd(tokens).toFixed(5)} 美元，平均每次 ${Math.round(tokens / SAMPLES.length)} token`);
}

if (/jevScaffoldCheck\.[jt]s$/.test(process.argv[1] ?? '')) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
