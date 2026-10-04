import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { thinkingTrainer, type ThinkingProfile, type ThinkingSessionStart } from '../services/apiClient';
import RemixIcon from './RemixIcon';
import { RELATION_COLORS } from './relationColors';

interface Props {
  zh: boolean;
}

type View = 'home' | 'playing';
type Mode = 'fallacy' | 'arena' | 'ladder';

const SKILL_META: Record<string, { zh: string; en: string; color: string }> = {
  clarity: { zh: '清晰', en: 'Clarity', color: '#2563eb' },
  evidence: { zh: '证据', en: 'Evidence', color: '#059669' },
  logic: { zh: '逻辑', en: 'Logic', color: '#7c3aed' },
  questioning: { zh: '提问', en: 'Questioning', color: '#d97706' },
  perspective: { zh: '视角', en: 'Perspective', color: '#0891b2' },
};

const MODE_META: Record<Mode, { icon: string; gradient: string; zh: string; en: string; descZh: string; descEn: string; howZh: string; howEn: string }> = {
  fallacy: {
    icon: 'search-eye-line',
    gradient: 'from-rose-500/90 to-orange-500/90',
    zh: '谬误侦探', en: 'Fallacy Detective',
    descZh: '在一段论证里找出隐藏的逻辑漏洞', descEn: 'Spot the hidden logical flaw in an argument',
    howZh: '点选可疑句子 + 配对谬误类型，连击得高分', howEn: 'Tap the suspicious sentence, match the fallacy type',
  },
  arena: {
    icon: 'sword-line',
    gradient: 'from-[#000080]/90 to-blue-600/90',
    zh: '观点擂台', en: 'Argument Arena',
    descZh: '与 AI 陪练来一场三回合论证对决', descEn: 'A 3-round argumentation duel with an AI sparring partner',
    howZh: '选择话语卡出招，论证越强 AI 掉血越多', howEn: 'Play discourse cards; stronger arguments hit harder',
  },
  ladder: {
    icon: 'stairs-line',
    gradient: 'from-violet-600/90 to-fuchsia-500/90',
    zh: '苏格拉底阶梯', en: 'Socratic Ladder',
    descZh: '对一个断言连续追问，一层比一层深', descEn: 'Question an assertion, one rung deeper each time',
    howZh: '提出更深的问题向上爬，转换视角是绝招', howEn: 'Deeper questions climb higher; perspective shifts score most',
  },
};

const DEPTH_COLORS: Record<string, string> = {
  clarify_concept: '#2563eb',
  probe_assumption: '#7c3aed',
  seek_evidence: '#059669',
  explore_implication: '#d97706',
  shift_perspective: '#0891b2',
};

// ═══════════════════════════════════════════════════════════════
// Small shared pieces
// ═══════════════════════════════════════════════════════════════

const ScorePill: React.FC<{ score: number; zh: boolean }> = ({ score, zh }) => (
  <div className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 dark:bg-amber-500/10">
    <RemixIcon name="star-fill" size={14} className="text-amber-500" />
    <span className="text-sm font-bold tabular-nums text-amber-700 dark:text-amber-300">{score}</span>
    <span className="text-[0.6875rem] text-amber-600/70 dark:text-amber-400/70">{zh ? '分' : 'pts'}</span>
  </div>
);

const SkillRadarMini: React.FC<{ skills: Record<string, number>; zh: boolean }> = ({ skills, zh }) => {
  const keys = Object.keys(SKILL_META);
  const max = Math.max(...keys.map(k => skills[k] ?? 0), 10);
  const C = 90, R = 62;
  const angle = (i: number) => (Math.PI * 2 * i) / keys.length - Math.PI / 2;
  const pt = (i: number, r: number) => [C + r * Math.cos(angle(i)), C + r * Math.sin(angle(i))];
  const poly = keys.map((k, i) => pt(i, Math.max((skills[k] ?? 0) / max, 0.05) * R).join(',')).join(' ');
  return (
    <svg viewBox="0 0 180 180" className="mx-auto w-full max-w-[220px]">
      {[0.33, 0.66, 1].map(f => (
        <polygon key={f} points={keys.map((_, i) => pt(i, R * f).join(',')).join(' ')} fill="none" className="stroke-stone-200 dark:stroke-stone-700" strokeWidth="0.7" />
      ))}
      <polygon points={poly} fill="#000080" fillOpacity="0.15" stroke="#000080" strokeWidth="1.6" className="dark:fill-[#4169E1]/25 dark:stroke-[#4169E1]" />
      {keys.map((k, i) => {
        const [x, y] = pt(i, R + 14);
        return <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="9.5" fontWeight="600" className="fill-stone-500 dark:fill-stone-400">{zh ? SKILL_META[k].zh : SKILL_META[k].en}</text>;
      })}
    </svg>
  );
};

const Hp: React.FC<{ value: number; label: string; color: string; reverse?: boolean }> = ({ value, label, color, reverse }) => (
  <div className={`flex-1 ${reverse ? 'text-right' : ''}`}>
    <div className={`mb-1 flex items-baseline gap-2 text-xs font-semibold text-stone-700 dark:text-stone-200 ${reverse ? 'flex-row-reverse' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums text-stone-400">{value}</span>
    </div>
    <div className={`h-3 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800 ${reverse ? 'scale-x-[-1]' : ''}`}>
      <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${value}%`, background: color }} />
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// Game 1: Fallacy Detective
// ═══════════════════════════════════════════════════════════════

const FallacyGame: React.FC<{ session: ThinkingSessionStart; zh: boolean; onFinish: (score: number) => void }> = ({ session, zh, onFinish }) => {
  const [question, setQuestion] = useState(session.question!);
  const [qIndex, setQIndex] = useState(0);
  const [pickedSentence, setPickedSentence] = useState<number | null>(null);
  const [pickedType, setPickedType] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [score, setScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = useCallback(async () => {
    if (pickedSentence === null || !pickedType || submitting) return;
    setSubmitting(true);
    try {
      const res = await thinkingTrainer.move(session.sessionId, { sentenceIndex: pickedSentence, fallacyType: pickedType });
      setResult(res);
      setScore(res.score);
      if (res.done) setDone(true);
    } catch { /* keep state */ } finally {
      setSubmitting(false);
    }
  }, [pickedSentence, pickedType, submitting, session.sessionId]);

  const nextQuestion = useCallback(() => {
    if (!result) return;
    if (result.done) { onFinish(result.score); return; }
    setQuestion(result.next);
    setQIndex(result.next.index);
    setPickedSentence(null);
    setPickedType(null);
    setResult(null);
  }, [result, onFinish]);

  const r = result?.result;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Array.from({ length: session.totalQuestions ?? 3 }).map((_, i) => (
            <span key={i} className={`h-2 w-8 rounded-full transition-colors ${i < qIndex ? 'bg-emerald-500' : i === qIndex ? 'bg-[#000080] dark:bg-[#4169E1]' : 'bg-stone-200 dark:bg-stone-700'}`} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {r && r.combo >= 2 && (
            <span className="animate-bounce rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-600 dark:bg-orange-500/15 dark:text-orange-300">
              {zh ? `连击 ×${r.combo}` : `Combo ×${r.combo}`}
            </span>
          )}
          <ScorePill score={score} zh={zh} />
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
        <div className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400">{zh ? '话题' : 'Topic'} · {question.topic}</div>
        <p className="mb-4 text-[0.8125rem] text-stone-500 dark:text-stone-400">
          {zh ? '下面这段话里有一句藏着逻辑谬误，点击选中它：' : 'One sentence below hides a fallacy — tap to select it:'}
        </p>
        <div className="space-y-2">
          {question.sentences.map((s: string, i: number) => {
            const isPicked = pickedSentence === i;
            const showCorrect = r && i === r.correctIndex;
            const showWrong = r && isPicked && !r.sentenceCorrect;
            return (
              <button
                key={i}
                disabled={!!result}
                onClick={() => setPickedSentence(i)}
                className={`block w-full rounded-xl border-2 px-4 py-3 text-left text-[0.875rem] leading-relaxed transition-all duration-200
                  ${showCorrect ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10'
                    : showWrong ? 'border-red-400 bg-red-50 animate-pulse dark:border-red-500 dark:bg-red-500/10'
                      : isPicked ? 'border-[#000080] bg-[#000080]/[0.04] dark:border-[#4169E1] dark:bg-[#4169E1]/10'
                        : 'border-stone-150 border-stone-200 bg-stone-50/50 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-stone-600'}
                  text-stone-800 dark:text-stone-200 ${result ? 'cursor-default' : 'cursor-pointer active:scale-[0.99]'}`}
              >
                <span className="mr-2 text-[0.6875rem] font-bold text-stone-400">{i + 1}</span>
                {s}
                {showCorrect && <RemixIcon name="checkbox-circle-fill" size={16} className="ml-2 inline text-emerald-500" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fallacy type cards */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
        <p className="mb-3 text-[0.8125rem] text-stone-500 dark:text-stone-400">{zh ? '它属于哪种谬误？' : 'Which fallacy is it?'}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(session.fallacyOptions ?? []).map(opt => {
            const isPicked = pickedType === opt.key;
            const showCorrect = r && opt.key === r.correctType;
            const showWrong = r && isPicked && !r.typeCorrect;
            return (
              <button
                key={opt.key}
                disabled={!!result}
                onClick={() => setPickedType(opt.key)}
                title={opt.desc}
                className={`rounded-xl border-2 px-3 py-2.5 text-center transition-all duration-150
                  ${showCorrect ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10'
                    : showWrong ? 'border-red-400 bg-red-50 dark:border-red-500 dark:bg-red-500/10'
                      : isPicked ? 'border-[#000080] bg-[#000080]/[0.05] scale-[1.03] dark:border-[#4169E1] dark:bg-[#4169E1]/10'
                        : 'border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-600'}
                  ${result ? 'cursor-default' : 'cursor-pointer active:scale-95'}`}
              >
                <div className="text-[0.8125rem] font-semibold text-stone-800 dark:text-stone-100">{opt.label}</div>
                <div className="mt-0.5 line-clamp-2 text-[0.5938rem] leading-tight text-stone-400">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Result explanation */}
      {r && (
        <div className={`animate-in fade-in slide-in-from-bottom-2 rounded-2xl border p-4 duration-300 ${r.sentenceCorrect && r.typeCorrect ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10' : 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10'}`}>
          <div className="flex items-center gap-2">
            <RemixIcon name={r.sentenceCorrect && r.typeCorrect ? 'trophy-line' : 'lightbulb-line'} size={16} className={r.sentenceCorrect && r.typeCorrect ? 'text-emerald-600' : 'text-amber-600'} />
            <span className="text-sm font-bold text-stone-900 dark:text-stone-100">
              {r.sentenceCorrect && r.typeCorrect
                ? (zh ? `全对！+${r.gained} 分` : `Perfect! +${r.gained}`)
                : r.sentenceCorrect
                  ? (zh ? `句子找对了，谬误类型是「${r.correctTypeLabel}」 +${r.gained} 分` : `Right sentence! It was ${r.correctTypeLabel} · +${r.gained}`)
                  : (zh ? `没找到——答案是第 ${r.correctIndex + 1} 句（${r.correctTypeLabel}）` : `Missed — it was sentence ${r.correctIndex + 1} (${r.correctTypeLabel})`)}
            </span>
          </div>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-stone-600 dark:text-stone-300">{r.explanation}</p>
          <button
            onClick={nextQuestion}
            className="mt-3 rounded-xl bg-[#000080] px-4 py-2 text-sm font-semibold text-white transition-transform hover:bg-[#000080]/90 active:scale-[0.98] dark:bg-[#4169E1]"
          >
            {done ? (zh ? '查看战绩' : 'See results') : (zh ? '下一题' : 'Next')}
          </button>
        </div>
      )}

      {!result && (
        <button
          onClick={submit}
          disabled={pickedSentence === null || !pickedType || submitting}
          className="w-full rounded-xl bg-[#000080] py-3 text-sm font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.99] disabled:opacity-40 dark:bg-[#4169E1]"
        >
          {submitting ? (zh ? '判定中…' : 'Judging…') : (zh ? '提交推理' : 'Submit')}
        </button>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Game 2: Argument Arena
// ═══════════════════════════════════════════════════════════════

// 取自社区 Build-on 的六种关系，辩论里用不上「综合」，所以只有五张
const CARD_META: Record<string, { zh: string; en: string; hintZh: string; hintEn: string }> = {
  evidence: { zh: '证据', en: 'Evidence', hintZh: '用事实、数据、例子支撑', hintEn: 'Back it with facts, data or examples' },
  challenge: { zh: '质疑', en: 'Challenge', hintZh: '直接指出对方的漏洞', hintEn: 'Point straight at the gap in their argument' },
  question: { zh: '提问', en: 'Question', hintZh: '用问题动摇对方前提', hintEn: 'Use a question to shake their premise' },
  clarify: { zh: '澄清', en: 'Clarify', hintZh: '澄清概念，纠正歪曲', hintEn: 'Clarify a term or correct a distortion' },
  extend: { zh: '延伸', en: 'Extend', hintZh: '延伸己方论点新角度', hintEn: 'Take your own argument in a new direction' },
};

const ArenaGame: React.FC<{ session: ThinkingSessionStart; zh: boolean; onFinish: (score: number) => void }> = ({ session, zh, onFinish }) => {
  const [myHp, setMyHp] = useState(session.myHp ?? 100);
  const [aiHp, setAiHp] = useState(session.aiHp ?? 100);
  const [round, setRound] = useState(0);
  const [card, setCard] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [lastResult, setLastResult] = useState<any>(null);
  const [score, setScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState<null | { won: boolean; score: number }>(null);

  const submit = useCallback(async () => {
    if (!card || !text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await thinkingTrainer.move(session.sessionId, { cardType: card, text: text.trim() });
      setLastResult(res);
      setMyHp(res.myHp);
      setAiHp(res.aiHp);
      setRound(res.round);
      setScore(res.score);
      setText('');
      setCard(null);
      if (res.done) setFinished({ won: res.won, score: res.score });
    } catch { /* noop */ } finally {
      setSubmitting(false);
    }
  }, [card, text, submitting, session.sessionId]);

  const r = lastResult?.result;

  return (
    <div className="space-y-4">
      {/* HP bars */}
      <div className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
        <Hp value={myHp} label={zh ? '我方' : 'You'} color="#059669" />
        <div className="flex flex-col items-center px-1">
          <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-stone-400">{zh ? `回合 ${round}/${session.maxRounds}` : `R${round}/${session.maxRounds}`}</span>
          <RemixIcon name="sword-line" size={18} className="mt-0.5 text-stone-300 dark:text-stone-600" />
        </div>
        <Hp value={aiHp} label={zh ? 'AI 陪练' : 'AI'} color="#dc2626" reverse />
      </div>

      {/* Topic + AI stance */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
        <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400">{zh ? '辩题' : 'Topic'}</div>
        <h3 className="mt-1 text-lg font-bold tracking-tight text-stone-900 dark:text-stone-100">{session.topic}</h3>
        <div className="mt-3 flex items-start gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10">
            <RemixIcon name="robot-2-line" size={16} className="text-red-500" />
          </div>
          <div className="rounded-2xl rounded-tl-sm bg-stone-100 px-4 py-2.5 text-[0.8125rem] leading-relaxed text-stone-700 dark:bg-stone-800 dark:text-stone-200">
            {r?.rebuttal ?? session.aiStance}
          </div>
        </div>
        {r?.aiWeakness && !finished && (
          <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 dark:bg-amber-500/10 animate-in fade-in duration-500">
            <RemixIcon name="spy-line" size={13} className="flex-shrink-0 text-amber-600" />
            <span className="text-[0.6875rem] text-amber-700 dark:text-amber-300">{zh ? 'AI 的破绽：' : "AI's weak spot: "}{r.aiWeakness}</span>
          </div>
        )}
      </div>

      {/* Last round scores */}
      {r && (
        <div className="animate-in fade-in slide-in-from-bottom-2 grid grid-cols-4 gap-2 duration-300">
          {(['clarity', 'evidence', 'logic', 'relevance'] as const).map(k => (
            <div key={k} className="rounded-xl border border-stone-200 bg-white p-2.5 text-center dark:border-stone-800 dark:bg-stone-950">
              <div className="text-[0.5938rem] text-stone-400">{zh ? ({ clarity: '清晰', evidence: '证据', logic: '逻辑', relevance: '切题' })[k] : k}</div>
              <div className="mt-1 flex justify-center gap-0.5">
                {[1, 2, 3, 4, 5].map(s => (
                  <span key={s} className={`h-1.5 w-1.5 rounded-full ${s <= r.scores[k] ? 'bg-[#000080] dark:bg-[#4169E1]' : 'bg-stone-200 dark:bg-stone-700'}`} />
                ))}
              </div>
            </div>
          ))}
          <div className="col-span-4 flex items-center justify-center gap-4 text-xs">
            <span className="font-bold text-emerald-600 animate-in zoom-in duration-500">{zh ? `你造成 ${r.myDamage} 伤害` : `You dealt ${r.myDamage}`}</span>
            <span className="font-bold text-red-500 animate-in zoom-in duration-700">{zh ? `AI 反击 ${r.aiDamage}` : `AI hit back ${r.aiDamage}`}</span>
          </div>
        </div>
      )}

      {finished ? (
        <div className="rounded-2xl border-2 border-dashed p-6 text-center animate-in zoom-in-95 duration-300 border-stone-300 dark:border-stone-700">
          <RemixIcon name={finished.won ? 'vip-crown-2-line' : 'emotion-normal-line'} size={36} className={`mx-auto ${finished.won ? 'text-amber-500' : 'text-stone-400'}`} />
          <h3 className="mt-2 text-lg font-bold text-stone-900 dark:text-stone-100">
            {finished.won ? (zh ? '你赢了这场对决！' : 'You won the duel!') : (zh ? '虽败犹荣，再战一局？' : 'Well fought!')}
          </h3>
          <button onClick={() => onFinish(finished.score)} className="mt-3 rounded-xl bg-[#000080] px-5 py-2.5 text-sm font-semibold text-white dark:bg-[#4169E1]">
            {zh ? '查看战绩' : 'See results'}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
          <p className="mb-2.5 text-[0.8125rem] text-stone-500 dark:text-stone-400">{zh ? '选择你的话语卡：' : 'Pick your discourse card:'}</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {Object.entries(CARD_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => setCard(key)}
                title={zh ? meta.hintZh : meta.hintEn}
                className={`rounded-xl border-2 px-3.5 py-2 text-sm font-semibold transition-all duration-150 active:scale-95 ${card === key ? 'scale-[1.05] text-white shadow-sm' : 'bg-white text-stone-700 hover:scale-[1.02] dark:bg-stone-900 dark:text-stone-200'}`}
                style={{ borderColor: RELATION_COLORS[key], ...(card === key ? { background: RELATION_COLORS[key] } : {}) }}
              >
                {zh ? meta.zh : meta.en}
              </button>
            ))}
          </div>
          {card && <p className="mb-2 text-[0.6875rem] text-stone-400 animate-in fade-in duration-200">{zh ? CARD_META[card].hintZh : CARD_META[card].hintEn}</p>}
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            maxLength={600}
            placeholder={zh ? '写下你的论证…（具体的例子和数据威力更大）' : 'Write your argument… (specifics hit harder)'}
            className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-sm text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-[#4169E1]/50"
          />
          <button
            onClick={submit}
            disabled={!card || !text.trim() || submitting}
            className="mt-2 w-full rounded-xl bg-[#000080] py-3 text-sm font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.99] disabled:opacity-40 dark:bg-[#4169E1]"
          >
            {submitting ? (zh ? 'AI 思考反击中…' : 'AI thinking…') : (zh ? '出招！' : 'Strike!')}
          </button>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Game 3: Socratic Ladder
// ═══════════════════════════════════════════════════════════════

const LadderGame: React.FC<{ session: ThinkingSessionStart; zh: boolean; onFinish: (score: number) => void }> = ({ session, zh, onFinish }) => {
  const maxRungs = session.maxRungs ?? 5;
  const [rungs, setRungs] = useState<any[]>([]);
  const [question, setQuestion] = useState('');
  const [score, setScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<any>(null);

  const submit = useCallback(async () => {
    if (!question.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await thinkingTrainer.move(session.sessionId, { question: question.trim() });
      setRungs(prev => [...prev, { question: question.trim(), ...res.result }]);
      setLastFeedback(res.result);
      setScore(res.score);
      setQuestion('');
      if (res.done) setDone(true);
    } catch { /* noop */ } finally {
      setSubmitting(false);
    }
  }, [question, submitting, session.sessionId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <RemixIcon name="stairs-line" size={14} />
          {zh ? `第 ${rungs.length}/${maxRungs} 层` : `Rung ${rungs.length}/${maxRungs}`}
        </div>
        <ScorePill score={score} zh={zh} />
      </div>

      {/* Assertion */}
      <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/50 p-5 dark:border-violet-500/30 dark:bg-violet-500/5">
        <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-violet-500">{zh ? '待检验的断言' : 'Assertion under scrutiny'}</div>
        <h3 className="mt-1 text-lg font-bold leading-snug tracking-tight text-stone-900 dark:text-stone-100">「{session.assertion}」</h3>
        <p className="mt-1.5 text-[0.75rem] text-stone-500 dark:text-stone-400">
          {zh ? '别急着同意或反对——用一连串问题把它挖透。每一层问得越深，爬得越高。' : "Don't agree or disagree — dig with questions. Deeper questions climb higher."}
        </p>
      </div>

      {/* The ladder */}
      <div className="space-y-2">
        {Array.from({ length: maxRungs }).map((_, idx) => {
          const rungIdx = maxRungs - 1 - idx;
          const rung = rungs[rungIdx];
          const isNext = rungIdx === rungs.length;
          return (
            <div
              key={rungIdx}
              className={`flex items-start gap-3 rounded-2xl border p-3.5 transition-all duration-500 ${rung
                ? 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950 animate-in slide-in-from-bottom-2'
                : isNext && !done
                  ? 'border-dashed border-violet-300 bg-violet-50/30 dark:border-violet-500/40 dark:bg-violet-500/5'
                  : 'border-dashed border-stone-200 opacity-50 dark:border-stone-800'}`}
            >
              <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[0.75rem] font-bold ${rung ? 'text-white' : 'bg-stone-100 text-stone-400 dark:bg-stone-800'}`}
                style={rung ? { background: DEPTH_COLORS[rung.depthType] ?? '#000080' } : {}}>
                {rungIdx + 1}
              </div>
              {rung ? (
                <div className="min-w-0 flex-1">
                  <div className="text-[0.8438rem] font-medium leading-snug text-stone-900 dark:text-stone-100">{rung.question}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold text-white" style={{ background: DEPTH_COLORS[rung.depthType] ?? '#000080' }}>
                      {rung.depthLabel}
                    </span>
                    <span className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map(s => (
                        <RemixIcon key={s} name={s <= rung.depthScore ? 'star-fill' : 'star-line'} size={11} className={s <= rung.depthScore ? 'text-amber-400' : 'text-stone-300 dark:text-stone-600'} />
                      ))}
                    </span>
                    <span className="text-[0.6875rem] font-semibold text-emerald-600">+{rung.gained}</span>
                  </div>
                </div>
              ) : (
                <div className="flex-1 pt-1 text-[0.75rem] text-stone-400">
                  {isNext && !done ? (zh ? '↓ 在下方输入你的下一个问题' : '↓ type your next question below') : '· · ·'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {lastFeedback && !done && (
        <div className="flex items-start gap-2 rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-800/60 animate-in fade-in duration-300">
          <RemixIcon name="user-voice-line" size={14} className="mt-0.5 flex-shrink-0 text-violet-500" />
          <p className="text-[0.7812rem] leading-relaxed text-stone-600 dark:text-stone-300">{lastFeedback.feedback}</p>
        </div>
      )}

      {done ? (
        <button onClick={() => onFinish(score)} className="w-full rounded-xl bg-[#000080] py-3 text-sm font-bold text-white active:scale-[0.99] dark:bg-[#4169E1]">
          {zh ? '登顶！查看战绩' : 'Summit! See results'}
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            maxLength={300}
            placeholder={zh ? '提出一个更深的问题…' : 'Ask a deeper question…'}
            className="flex-1 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-violet-400 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
          />
          <button
            onClick={submit}
            disabled={!question.trim() || submitting}
            className="rounded-xl bg-violet-600 px-5 text-sm font-bold text-white transition-all hover:bg-violet-700 active:scale-95 disabled:opacity-40"
          >
            {submitting ? '…' : (zh ? '追问' : 'Ask')}
          </button>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Result overlay
// ═══════════════════════════════════════════════════════════════

const ResultScreen: React.FC<{ sessionId: string; mode: Mode; finalScore: number; zh: boolean; onHome: () => void; onReplay: () => void }> = ({ sessionId, mode, finalScore, zh, onHome, onReplay }) => {
  const [settle, setSettle] = useState<Awaited<ReturnType<typeof thinkingTrainer.complete>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    thinkingTrainer.complete(sessionId)
      .then(res => { if (!cancelled) setSettle(res); })
      .catch(() => { /* noop */ });
    return () => { cancelled = true; };
  }, [sessionId]);

  const meta = MODE_META[mode];

  return (
    <div className="mx-auto max-w-md space-y-4 pt-4 text-center animate-in zoom-in-95 fade-in duration-300">
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.gradient}`}>
        <RemixIcon name={meta.icon} size={30} className="text-white" />
      </div>
      <div>
        <div className="text-[0.6875rem] font-semibold uppercase tracking-widest text-stone-400">{zh ? meta.zh : meta.en} · {zh ? '本局得分' : 'Score'}</div>
        <div className="mt-1 text-5xl font-black tabular-nums tracking-tight text-stone-900 dark:text-stone-100">{finalScore}</div>
        {settle?.isNewBest && finalScore > 0 && (
          <span className="mt-2 inline-block animate-bounce rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {zh ? '🏆 新纪录！' : '🏆 New best!'}
          </span>
        )}
      </div>

      {settle && (
        <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5 text-left dark:border-stone-800 dark:bg-stone-950">
          <div className="flex items-center justify-between">
            <span className="text-sm text-stone-500 dark:text-stone-400">XP</span>
            <span className="text-sm font-bold text-emerald-600">+{settle.xpGain}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-stone-500 dark:text-stone-400">{zh ? '等级' : 'Level'}</span>
            <span className="flex items-center gap-2 text-sm font-bold text-stone-900 dark:text-stone-100">
              Lv.{settle.level}
              {settle.leveledUp && <span className="animate-pulse rounded-full bg-violet-100 px-2 py-0.5 text-[0.6875rem] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">{zh ? '升级！' : 'LEVEL UP!'}</span>}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-stone-500 dark:text-stone-400">{zh ? '连续训练' : 'Streak'}</span>
            <span className="flex items-center gap-1 text-sm font-bold text-stone-900 dark:text-stone-100">
              <RemixIcon name="fire-fill" size={14} className="text-orange-500" />
              {settle.streak} {zh ? '天' : 'days'}
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onReplay} className="flex-1 rounded-xl bg-[#000080] py-3 text-sm font-bold text-white active:scale-[0.98] dark:bg-[#4169E1]">
          {zh ? '再来一局' : 'Play again'}
        </button>
        <button onClick={onHome} className="flex-1 rounded-xl border border-stone-200 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900">
          {zh ? '返回' : 'Back'}
        </button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════

const ThinkingGym: React.FC<Props> = ({ zh }) => {
  const [view, setView] = useState<View>('home');
  const [profile, setProfile] = useState<ThinkingProfile | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; mode: string; topic: string; score: number; status: string; created_at: string }>>([]);
  const [session, setSession] = useState<ThinkingSessionStart | null>(null);
  const [starting, setStarting] = useState<Mode | null>(null);
  const [difficulty, setDifficulty] = useState(1);
  const [finalScore, setFinalScore] = useState(0);
  const [showResult, setShowResult] = useState(false);

  const loadProfile = useCallback(() => {
    thinkingTrainer.profile()
      .then(res => { setProfile(res.profile); setRecent(res.recentSessions as any); })
      .catch(() => { /* noop */ });
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const startGame = useCallback(async (mode: Mode) => {
    if (starting) return;
    setStarting(mode);
    try {
      const res = await thinkingTrainer.start(mode, difficulty);
      setSession(res);
      setShowResult(false);
      setView('playing');
    } catch { /* noop */ } finally {
      setStarting(null);
    }
  }, [starting, difficulty]);

  const onFinish = useCallback((score: number) => {
    setFinalScore(score);
    setShowResult(true);
  }, []);

  const goHome = useCallback(() => {
    setSession(null);
    setShowResult(false);
    setView('home');
    loadProfile();
  }, [loadProfile]);

  const xpProgress = useMemo(() => {
    if (!profile) return 0;
    const prevLevelXp = Math.pow(profile.level - 1, 2) * 50;
    const span = profile.nextLevelXp - prevLevelXp;
    return span > 0 ? Math.min(((profile.totalXp - prevLevelXp) / span) * 100, 100) : 0;
  }, [profile]);

  // ── Playing view ──
  if (view === 'playing' && session) {
    return (
      <div className="mx-auto max-w-4xl">
        <button onClick={goHome} className="mb-3 flex items-center gap-1 text-xs font-medium text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-200">
          <RemixIcon name="arrow-left-line" size={13} />
          {zh ? '退出本局' : 'Exit game'}
        </button>
        {!session.aiPowered && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-stone-100 px-3.5 py-2 text-[0.6875rem] text-stone-500 dark:bg-stone-800/60 dark:text-stone-400">
            <RemixIcon name="wifi-off-line" size={12} />
            {zh ? '课程未配置 AI，正在使用内置题库与规则评分（体验完整，评语较简单）' : 'No course AI configured — using built-in question bank and rule-based scoring'}
          </div>
        )}
        {showResult ? (
          <ResultScreen
            sessionId={session.sessionId}
            mode={session.mode}
            finalScore={finalScore}
            zh={zh}
            onHome={goHome}
            onReplay={() => { const m = session.mode; setSession(null); setShowResult(false); startGame(m); }}
          />
        ) : session.mode === 'fallacy' ? (
          <FallacyGame session={session} zh={zh} onFinish={onFinish} />
        ) : session.mode === 'arena' ? (
          <ArenaGame session={session} zh={zh} onFinish={onFinish} />
        ) : (
          <LadderGame session={session} zh={zh} onFinish={onFinish} />
        )}
      </div>
    );
  }

  // ── Home view ──
  return (
    <div className="space-y-5">
      {/* Header: level + streak */}
      <div className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#000080] to-blue-500 text-white">
            <span className="text-lg font-black">Lv{profile?.level ?? 1}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-stone-900 dark:text-stone-100">{zh ? '我的思维等级' : 'My Thinking Level'}</div>
            <div className="mt-1 h-2 w-40 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
              <div className="h-full rounded-full bg-gradient-to-r from-[#000080] to-blue-500 transition-all duration-700" style={{ width: `${xpProgress}%` }} />
            </div>
            <div className="mt-0.5 text-[0.6875rem] tabular-nums text-stone-400">{profile?.totalXp ?? 0} / {profile?.nextLevelXp ?? 50} XP</div>
          </div>
        </div>
        <div className="flex items-center gap-5 sm:ml-auto">
          <div className="text-center">
            <div className="flex items-center gap-1 text-lg font-bold text-stone-900 dark:text-stone-100">
              <RemixIcon name="fire-fill" size={16} className="text-orange-500" />
              {profile?.streakDays ?? 0}
            </div>
            <div className="text-[0.6875rem] text-stone-400">{zh ? '连续天数' : 'Streak'}</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold tabular-nums text-stone-900 dark:text-stone-100">{profile?.gamesPlayed ?? 0}</div>
            <div className="text-[0.6875rem] text-stone-400">{zh ? '总场次' : 'Games'}</div>
          </div>
          <div className="hidden sm:block">
            <SkillRadarMini skills={profile?.skills ?? {}} zh={zh} />
          </div>
        </div>
      </div>

      {/* Difficulty selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{zh ? '难度' : 'Difficulty'}</span>
        {[1, 2, 3].map(d => (
          <button
            key={d}
            onClick={() => setDifficulty(d)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${difficulty === d ? 'bg-[#000080] text-white dark:bg-[#4169E1]' : 'bg-stone-100 text-stone-500 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400'}`}
          >
            {d === 1 ? (zh ? '新手' : 'Easy') : d === 2 ? (zh ? '进阶' : 'Medium') : (zh ? '大师' : 'Hard')}
          </button>
        ))}
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(Object.keys(MODE_META) as Mode[]).map(mode => {
          const meta = MODE_META[mode];
          const best = profile?.bestScores?.[mode] ?? 0;
          return (
            <button
              key={mode}
              onClick={() => startGame(mode)}
              disabled={!!starting}
              className="group relative overflow-hidden rounded-3xl border border-stone-200 bg-white p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-lg active:scale-[0.98] disabled:opacity-60 dark:border-stone-800 dark:bg-stone-950"
            >
              <div className={`absolute -right-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-br ${meta.gradient} opacity-[0.08] transition-transform duration-300 group-hover:scale-150`} />
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.gradient}`}>
                {starting === mode
                  ? <RemixIcon name="loader-4-line" size={22} className="animate-spin text-white" />
                  : <RemixIcon name={meta.icon} size={22} className="text-white" />}
              </div>
              <h3 className="mt-4 text-lg font-bold tracking-tight text-stone-900 dark:text-stone-100">{zh ? meta.zh : meta.en}</h3>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-stone-500 dark:text-stone-400">{zh ? meta.descZh : meta.descEn}</p>
              <p className="mt-2 flex items-center gap-1 text-[0.6875rem] text-stone-400">
                <RemixIcon name="gamepad-line" size={11} />
                {zh ? meta.howZh : meta.howEn}
              </p>
              <div className="mt-4 flex items-center justify-between">
                {best > 0 ? (
                  <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-amber-600 dark:text-amber-400">
                    <RemixIcon name="trophy-line" size={12} />
                    {zh ? `最高 ${best} 分` : `Best ${best}`}
                  </span>
                ) : <span className="text-[0.6875rem] text-stone-300 dark:text-stone-600">{zh ? '尚未挑战' : 'Not played yet'}</span>}
                <span className="flex items-center gap-1 text-xs font-bold text-[#000080] transition-transform group-hover:translate-x-1 dark:text-[#93AAFD]">
                  {starting === mode ? (zh ? '出题中…' : 'Preparing…') : (zh ? '开始训练' : 'Start')}
                  <RemixIcon name="arrow-right-line" size={13} />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Recent sessions */}
      {recent.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
          <div className="mb-3 flex items-center gap-2">
            <RemixIcon name="history-line" size={14} className="text-[#000080] dark:text-[#93AAFD]" />
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{zh ? '最近战绩' : 'Recent Games'}</span>
          </div>
          <div className="space-y-1">
            {recent.slice(0, 6).map(s => {
              const meta = MODE_META[s.mode as Mode];
              return (
                <div key={s.id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-900">
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${meta?.gradient ?? 'from-stone-400 to-stone-500'}`}>
                    <RemixIcon name={meta?.icon ?? 'gamepad-line'} size={14} className="text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.8125rem] font-medium text-stone-900 dark:text-stone-100">{s.topic || (zh ? meta?.zh : meta?.en)}</div>
                    <div className="text-[0.6875rem] text-stone-400">{new Date(s.created_at).toLocaleDateString()}</div>
                  </div>
                  <span className="flex-shrink-0 text-sm font-bold tabular-nums text-stone-700 dark:text-stone-200">{s.score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Theory note */}
      <div className="flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3 dark:border-stone-800 dark:bg-stone-900/40">
        <RemixIcon name="book-2-line" size={13} className="mt-0.5 flex-shrink-0 text-stone-400" />
        <p className="text-[0.6875rem] leading-relaxed text-stone-500 dark:text-stone-400">
          {zh
            ? '训练场的三种模式分别对应批判性思维的三个核心能力：谬误识别（逻辑素养）、论证构建（Toulmin 模型：主张-证据-理由）、深度提问（苏格拉底式探究）。话语卡取自社区 Build-on 的六种关系，辩论里用不上「综合」，所以是五张。在这里练熟，回到社区讨论直接用。'
            : 'The three modes target three core critical-thinking skills: fallacy detection, argument construction (Toulmin model), and deep questioning (Socratic inquiry). The five discourse cards are the Build-on relations used in the community, minus Synthesize, which a debate has no use for. Practice here, then use them in real discussions.'}
        </p>
      </div>
    </div>
  );
};

export default ThinkingGym;
