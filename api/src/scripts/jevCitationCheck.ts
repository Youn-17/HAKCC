/**
 * 检验课程资料引用核对（kbCitationCheck.ts）：Jev 判断「这句话和这段资料」支持 / 矛盾 / 没说到准不准，
 * 没标引用时「回答用没用上这段」准不准。只发 jevCitationCheckSamples.ts 里编的样例，不读数据库。
 *
 * 在 api/ 下运行（key 放在 api/.env 的 JEV_API_KEY）：
 *   npx ts-node --transpile-only src/scripts/jevCitationCheck.ts
 */
import dotenv from 'dotenv';
import { jevConfig } from '../config/jev';
import { askJev, jevCostUsd, type JevAnswer } from '../services/jevClient';
import { interpretRelation, relationQuestions, relationState, relationVerdict, usageQuestions, usageState } from '../services/kbCitationCheck';
import { PASSAGES, RELATION_SAMPLES, USE_SAMPLES } from './jevCitationCheckSamples';

dotenv.config();

const pct = (n: number, d: number) => (d === 0 ? '—' : `${n}/${d}（${Math.round((n / d) * 100)}%）`);
const fixed = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(2));

async function main() {
  const config = jevConfig();
  if (!config.apiKey) {
    console.log('还没有 key：在 api/.env 里加一行 JEV_API_KEY=你的key。');
    process.exitCode = 1;
    return;
  }
  let tokens = 0;
  const latencies: number[] = [];

  console.log(`\n── 这句话和这段资料（${RELATION_SAMPLES.length} 对）──`);
  console.log('编号  期望          支持/矛盾/没说到      结论          对否  测的是');
  const rows = await Promise.all(RELATION_SAMPLES.map(async sample => {
    const result = await askJev(relationState(sample.claim, PASSAGES[sample.passage]), relationQuestions());
    tokens += result.usage.inputTokens;
    latencies.push(result.latencyMs);
    const p = interpretRelation(result.answers as Record<string, JevAnswer>)!;
    return { sample, p };
  }));
  for (const { sample, p } of rows) {
    const verdict = relationVerdict(p);
    console.log(`${sample.id}   ${sample.expect.padEnd(12)}  ${fixed(p.supports)}/${fixed(p.contradicts)}/${fixed(p.says_nothing)}      ${verdict.padEnd(12)}  ${verdict === sample.expect ? '✓' : '✗'}    ${sample.about}${sample.heldOut ? '（后加）' : ''}`);
  }
  const right = rows.filter(r => relationVerdict(r.p) === r.sample.expect);
  const held = rows.filter(r => r.sample.heldOut);
  console.log(`全部 ${pct(right.length, rows.length)}；后加的 ${pct(held.filter(r => relationVerdict(r.p) === r.sample.expect).length, held.length)}`);
  // 最要紧的错：把不支持的判成支持（假引用放过去了）
  const falseSupport = rows.filter(r => r.sample.expect !== 'supported' && relationVerdict(r.p) === 'supported');
  const falseReject = rows.filter(r => r.sample.expect === 'supported' && relationVerdict(r.p) !== 'supported');
  console.log(`把对不上的当成核对上：${falseSupport.map(r => r.sample.id).join(',') || '无'}；把核对上的当成对不上：${falseReject.map(r => r.sample.id).join(',') || '无'}`);
  for (const threshold of [0.4, 0.5, 0.6, 0.7]) {
    const fs = rows.filter(r => r.sample.expect !== 'supported' && r.p.supports >= threshold).length;
    const fr = rows.filter(r => r.sample.expect === 'supported' && r.p.supports < threshold).length;
    console.log(`  支持门槛 ${threshold}：误放 ${fs}，误拦 ${fr}`);
  }

  console.log(`\n── 没标引用时：回答用没用上这段（${USE_SAMPLES.length} 对）──`);
  const useRows = await Promise.all(USE_SAMPLES.map(async sample => {
    const result = await askJev(usageState(sample.answer, PASSAGES[sample.passage]), usageQuestions());
    tokens += result.usage.inputTokens;
    latencies.push(result.latencyMs);
    const p = (result.answers as Record<string, JevAnswer>).uses;
    return { sample, p: p?.type === 'noul' ? p.noul : NaN };
  }));
  for (const { sample, p } of useRows) {
    const used = p >= 0.5;
    console.log(`${sample.id}   ${sample.expectUsed ? '用了' : '没用'}  ${fixed(p)}  ${used === sample.expectUsed ? '✓' : '✗'}    ${sample.about}${sample.heldOut ? '（后加）' : ''}`);
  }
  for (const threshold of [0.3, 0.5, 0.7]) {
    const wrong = useRows.filter(r => (r.p >= threshold) !== r.sample.expectUsed).map(r => r.sample.id);
    console.log(`  门槛 ${threshold}：错 ${wrong.length}（${wrong.join(',') || '无'}）`);
  }

  latencies.sort((a, b) => a - b);
  console.log(`\n请求 ${latencies.length} 次，用时中位数 ${latencies[Math.floor(latencies.length / 2)]} ms；输入 ${tokens} token，约 ${jevCostUsd(tokens).toFixed(5)} 美元`);
}

if (/jevCitationCheck\.[jt]s$/.test(process.argv[1] ?? '')) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
