import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Loader2, RotateCcw, Send, Trash2 } from 'lucide-react';
import {
  platformFeedback,
  type AdminPlatformFeedbackItem,
  type PlatformFeedbackItem,
  type PlatformFeedbackKind,
  type PlatformLetter,
  type PlatformLetterSide,
} from '../../services/apiClient';
import { MORANDI, chipStyle } from '../morandiPalette';
import type { Language } from '../../types';

/**
 * 写给同学们的话 —— **默认文案**。
 *
 * 中文是用户（平台负责人）亲笔写的，逐字照搬，不要代为润色 —— 这是他对学生的表态，
 * 不是产品文案。英文是照这版翻的，中文改了英文也要跟着改。
 * 文中沿用 KB 的说法：idea 保留英文（用户特意这么写）、集体认知责任、认知主体性。
 *
 * 管理员在后台改过之后以数据库为准（platform_content 表的 feedback_letter 行）。
 * 后台那行被删掉就回落到这里，所以这份不能删。
 */
const LETTER_DEFAULT: PlatformLetter = {
  zh: {
    title: '写给同学们的话',
    body: [
      '同学们好：',
      '欢迎使用Human-AI Knowledge Collaboration Commons（HAKCC）平台，这个平台是我们基于知识建构（Knowledge Building，KB）理念和知识论坛（Knowledge Forum，KF）平台设计与开发的，旨在为同学们提供一个GenAI支持的知识共享空间，提高同学们与GenAI互动时的认知主体性。',
      '在 AI 时代，获取知识已经变得非常容易。那么，学习究竟还要学什么？KB给予了我们很好的思路，学习不仅仅是了解现成的知识，更重要的是参与知识本身的生产与改进。KB反对把知识当成只需背诵和复述的概念，而是希望学习者像研究者在一个公共的空间里提出真实的问题和观点（idea），大家能够共同参与讨论，见证一个想法从初始状态到产出成果的过程。',
      '在KF中， idea是可以被改进的公共对象，当你发表一个idea，别人可以延伸、澄清、提问、质疑、给出证据，或者把几条idea综合起来；你也可以对别人的idea做同样的事。idea就在这样的往复中被不断改进，最后产出这个社区共同构建的知识。KB把这称为「集体认知责任」：公共知识的状态由社区里每个人共同负责，而不是教师一言堂。',
      '而GenAI的出现，逐渐打破了这种平衡，它的知识储备，逻辑推理，反应速度基本上远远高于我们人类，所以当GenAI进入到这种知识共享空间中，我们产生了一个担忧：如果任何知识和答案都直接通过GenAI获取，我们思考的主体性在哪里？KB称之为「认知主体性」，即探究什么问题、哪些idea值得深入探讨、什么类型的问题可以进行公共讨论，这些判断应该由学习者自己作出。与其警惕GenAI带来的不确定性，不如探讨如何更好的使用，所以我们在KB理念和KF平台的基础上做了延续，把GenAI融入到知识共享空间当中，是希望大家在与同伴，与GenAI讨论的过程中尝试保持自己在认知发展过程中的主体性，而不是把所有的认知过程都交给GenAI。',
      '我们希望和同学们站在一起，探讨如何能让我们学的更好，更有意义，主动权在你们的手中，由于平台还在持续改进的过程中，我们或许有做得不好的地方，希望大家可以多多体谅，同时也希望大家将使用HAKCC平台过程中遇到的问题、困惑以及好的建议发布在这个区域中，我们一定会持续完善这个平台。',
      '谢谢大家！',
    ].join('\n\n'),
    signature: '—— HAKCC 开发团队',
  },
  en: {
    title: 'A note to you',
    body: [
      'Hello everyone,',
      'Welcome to the Human-AI Knowledge Collaboration Commons (HAKCC). We designed and built this platform on the ideas of Knowledge Building (KB) and on the Knowledge Forum (KF) platform, to give you a knowledge-sharing space supported by GenAI and to strengthen your epistemic agency when you work with GenAI.',
      'Knowledge has become very easy to obtain in the age of AI. So what is there still to learn? KB gives us a good way to think about it: learning is not only knowing what is already established, but taking part in producing and improving knowledge itself. KB rejects treating knowledge as concepts to be memorised and repeated back. It asks learners to work as researchers do — raising real questions and ideas in a shared space, discussing them together, and seeing an idea through from its first form to a finished result.',
      'In KF, an idea is an improvable public object. When you post an idea, others can extend it, clarify it, question it, challenge it, offer evidence, or synthesise several ideas together; you can do the same to theirs. Ideas improve through this back-and-forth, and what comes out of it is knowledge this community built together. KB calls this collective cognitive responsibility: the state of public knowledge is everyone’s responsibility, not something the teacher alone decides.',
      'The arrival of GenAI has gradually upset that balance. Its store of knowledge, its reasoning and its speed are far beyond ours, so when GenAI enters such a knowledge-sharing space we have a worry: if every piece of knowledge and every answer is obtained straight from GenAI, where does our own thinking stand? KB calls this epistemic agency — which questions to pursue, which ideas are worth going deeper into, which kinds of questions belong in public discussion: those judgements should be the learner’s. Rather than being wary of the uncertainty GenAI brings, we would rather work out how to use it well. So we have carried KB and KF forward and brought GenAI into the knowledge-sharing space, hoping that as you discuss with your peers and with GenAI you will try to keep your own agency in how your understanding develops, instead of handing the whole cognitive process over to GenAI.',
      'We want to stand alongside you and work out how we can learn better and more meaningfully. The initiative is in your hands. The platform is still being improved and there are probably places where we have not done well — please bear with us. Please also post the problems, the confusions and the good suggestions you meet while using HAKCC in this area. We will keep improving the platform.',
      'Thank you.',
    ].join('\n\n'),
    signature: '— The HAKCC team',
  },
};

const KINDS: { id: PlatformFeedbackKind; zh: string; en: string; tone: keyof typeof MORANDI }[] = [
  { id: 'thought', zh: '使用感受', en: 'How it feels', tone: 'dustyBlue' },
  { id: 'suggestion', zh: '改进建议', en: 'Suggestion', tone: 'sage' },
  { id: 'problem', zh: '遇到的问题', en: 'Problem', tone: 'ochre' },
  { id: 'disagree', zh: '不认同的地方', en: 'I disagree', tone: 'rose' },
];

function kindOf(id: PlatformFeedbackKind) {
  return KINDS.find(k => k.id === id) ?? KINDS[0];
}

function formatTime(iso: string, zh: boolean): string {
  return new Date(iso).toLocaleString(zh ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** 空行分段。后台编辑的人面对的是一个文本框，不该要求他维护一个数组。 */
function toParagraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

const cardCls = 'rounded-[24px] border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950';

const LetterView: React.FC<{ side: PlatformLetterSide }> = ({ side }) => (
  <>
    {side.title && (
      <h2 className="mb-4 text-xl font-bold tracking-tight text-stone-950 dark:text-stone-100">{side.title}</h2>
    )}
    <div className="space-y-3.5">
      {toParagraphs(side.body).map((p, i) => (
        <p key={i} className="text-base leading-relaxed text-stone-700 dark:text-stone-300">{p}</p>
      ))}
      {side.signature && (
        <p className="pt-1 text-base font-medium text-stone-800 dark:text-stone-200">{side.signature}</p>
      )}
    </div>
  </>
);

/** 后台改过就用后台的，没改过（或读失败）就用代码里的默认文案，绝不留空白。 */
function useLetter(lang: Language): PlatformLetterSide {
  const [stored, setStored] = useState<PlatformLetter | null>(null);
  useEffect(() => {
    platformFeedback.getLetter()
      .then(res => setStored(res.letter))
      .catch(() => setStored(null));
  }, []);
  const side = lang === 'zh' ? 'zh' : 'en';
  const custom = stored?.[side];
  return custom?.body?.trim() ? custom : LETTER_DEFAULT[side];
}

// ── 学生：读那封信，写自己的反馈 ────────────────────────────────
const StudentView: React.FC<{ lang: Language; courseId?: string | null }> = ({ lang, courseId }) => {
  const zh = lang === 'zh';
  const letter = useLetter(lang);

  const [kind, setKind] = useState<PlatformFeedbackKind>('thought');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  const [mine, setMine] = useState<PlatformFeedbackItem[] | null>(null);

  useEffect(() => {
    platformFeedback.mine()
      .then(res => setMine(res.feedback))
      .catch(() => setMine([]));
  }, []);

  const submit = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await platformFeedback.create({
        body: body.trim(),
        kind,
        course_id: courseId ?? null,
        context: { path: window.location.pathname, lang: String(lang) },
      });
      setMine(prev => [res.feedback, ...(prev ?? [])]);
      setBody('');
      setJustSent(true);
      window.setTimeout(() => setJustSent(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    setMine(prev => (prev ?? []).filter(f => f.id !== id));
    try { await platformFeedback.remove(id); } catch { /* 删失败就等下次刷新回来，不打断他 */ }
  };

  return (
    // 这一页是「读一封信 + 写一段话」，不是仪表盘。整列收到约 65 字符宽：
    // 满宽的话每行太长读着累，而只给正文限宽、卡片仍满宽的话，右边会空出一大块。
    <div className="mx-auto max-w-[36rem] space-y-5">
      <section className={`${cardCls} px-7 py-6`}>
        <LetterView side={letter} />
      </section>

      <section className={`${cardCls} px-7 py-6`}>
        <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          {zh ? '写下你的想法' : 'Write your thoughts'}
        </h3>
        <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400">
          {zh
            ? '只有平台开发团队看得到。不会给你的任课教师，也不计入任何成绩。'
            : 'Only the platform team can see this. It is not shared with your course teacher and does not count towards any grade.'}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {KINDS.map(k => {
            const active = kind === k.id;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={`rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                  active ? '' : 'border border-stone-200 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900'
                }`}
                style={active ? chipStyle(MORANDI[k.tone]) : undefined}
              >
                {zh ? k.zh : k.en}
              </button>
            );
          })}
        </div>

        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={6}
          maxLength={4000}
          placeholder={zh
            ? '比如：这个功能我没看懂怎么用；我觉得和同伴讨论比问 AI 更有收获；我不同意「AI 不该直接给答案」这个说法……'
            : 'For example: I could not work out how this feature is used; I got more out of discussing with peers than asking AI; I disagree that AI should not just give answers…'}
          className="mt-4 w-full resize-y rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-base leading-relaxed text-stone-800 outline-none transition-colors focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
        />

        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!body.trim() || sending}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {zh ? '提交' : 'Submit'}
          </button>
          <span className="text-sm text-stone-400">{body.length} / 4000</span>
          {justSent && (
            <span className="text-sm font-medium" style={{ color: MORANDI.sage }}>
              {zh ? '收到了，谢谢你。' : 'Received — thank you.'}
            </span>
          )}
        </div>
      </section>

      <section className={`${cardCls} px-7 py-6`}>
        <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          {zh ? '我写过的' : 'What I have written'}
        </h3>
        {mine === null ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-stone-500">
            <Loader2 size={14} className="animate-spin" />{zh ? '加载中…' : 'Loading…'}
          </div>
        ) : mine.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
            {zh ? '还没有写过。想到什么随时回来写。' : 'Nothing yet. Come back whenever something comes to mind.'}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {mine.map(f => {
              const k = kindOf(f.kind);
              return (
                <li key={f.id} className="rounded-xl border border-stone-200 px-4 py-3 dark:border-stone-800">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-lg px-2 py-0.5 text-xs font-medium" style={chipStyle(MORANDI[k.tone])}>
                      {zh ? k.zh : k.en}
                    </span>
                    <span className="text-xs tabular-nums text-stone-400">{formatTime(f.created_at, zh)}</span>
                    <button
                      type="button"
                      onClick={() => remove(f.id)}
                      title={zh ? '撤回这条' : 'Withdraw'}
                      className="ml-auto rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-900"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-stone-300">{f.body}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

// ── 管理员：在后台改那封信 ──────────────────────────────────────
const LetterEditor: React.FC<{ lang: Language }> = ({ lang }) => {
  const zh = lang === 'zh';
  const [draft, setDraft] = useState<PlatformLetter | null>(null);
  const [side, setSide] = useState<'zh' | 'en'>(zh ? 'zh' : 'en');
  const [customised, setCustomised] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const load = useCallback(() => {
    platformFeedback.getLetter()
      .then(res => {
        setDraft(res.letter ?? LETTER_DEFAULT);
        setCustomised(Boolean(res.letter));
        setUpdatedAt(res.updatedAt);
      })
      .catch(e => { setError(e instanceof Error ? e.message : String(e)); setDraft(LETTER_DEFAULT); });
  }, []);
  useEffect(load, [load]);

  const patch = (field: keyof PlatformLetterSide, value: string) =>
    setDraft(prev => (prev ? { ...prev, [side]: { ...prev[side], [field]: value } } : prev));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await platformFeedback.saveLetter(draft);
      setDraft(res.letter);
      setCustomised(true);
      setUpdatedAt(res.updatedAt);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    const ok = window.confirm(zh
      ? '恢复成代码里的默认文案？后台改过的内容会被清掉。'
      : 'Restore the built-in default text? Your edits will be discarded.');
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await platformFeedback.resetLetter();
      setDraft(LETTER_DEFAULT);
      setCustomised(false);
      setUpdatedAt(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className={`${cardCls} flex items-center gap-2 px-6 py-5 text-sm text-stone-500`}>
        <Loader2 size={15} className="animate-spin" />{zh ? '加载中…' : 'Loading…'}
      </div>
    );
  }

  const current = draft[side];
  const inputCls = 'w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-800 outline-none transition-colors focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100';

  return (
    <div className={`${cardCls} px-6 py-5`}>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          {zh ? '写给同学们的话' : 'The note to students'}
        </h3>
        <span className="text-xs text-stone-500">
          {customised
            ? (zh ? `已在后台改过${updatedAt ? ' · ' + formatTime(updatedAt, zh) : ''}` : `Edited${updatedAt ? ' · ' + formatTime(updatedAt, zh) : ''}`)
            : (zh ? '当前用的是默认文案' : 'Showing the built-in default')}
        </span>
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-stone-200 p-1 dark:border-stone-700">
          {(['zh', 'en'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                side === s
                  ? 'bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900'
                  : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              {s === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
        {zh
          ? '正文用空行分段。保存后学生下次打开这一页看到的就是新文案；中英文各存一份，两边都要改。'
          : 'Separate paragraphs with a blank line. Students see the new text next time they open this page; Chinese and English are stored separately.'}
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-400">{zh ? '标题' : 'Title'}</span>
          <input value={current.title} onChange={e => patch('title', e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-400">{zh ? '正文' : 'Body'}</span>
          <textarea
            value={current.body}
            onChange={e => patch('body', e.target.value)}
            rows={16}
            className={`${inputCls} resize-y leading-relaxed`}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-400">{zh ? '落款' : 'Signature'}</span>
          <input value={current.signature} onChange={e => patch('signature', e.target.value)} className={inputCls} />
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-800 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {zh ? '保存' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setPreview(p => !p)}
          className="rounded-xl border border-stone-200 px-3.5 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
        >
          {preview ? (zh ? '收起预览' : 'Hide preview') : (zh ? '预览学生看到的样子' : 'Preview')}
        </button>
        {customised && (
          <button
            type="button"
            onClick={reset}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 px-3.5 py-2 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-900"
          >
            <RotateCcw size={14} />{zh ? '恢复默认' : 'Restore default'}
          </button>
        )}
        {savedAt && (
          <span className="text-sm font-medium" style={{ color: MORANDI.sage }}>
            {zh ? '已保存' : 'Saved'}
          </span>
        )}
      </div>

      {preview && (
        <div className="mt-5 rounded-2xl border border-stone-200 px-6 py-5 dark:border-stone-800">
          <div className="mx-auto max-w-[32rem]">
            <LetterView side={current} />
          </div>
        </div>
      )}
    </div>
  );
};

// ── 管理员：读全部、导出 ────────────────────────────────────────
const AdminView: React.FC<{ lang: Language }> = ({ lang }) => {
  const zh = lang === 'zh';
  const [items, setItems] = useState<AdminPlatformFeedbackItem[] | null>(null);
  const [filter, setFilter] = useState<PlatformFeedbackKind | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      const blob = await platformFeedback.exportCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `platform_feedback_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    setItems(null);
    platformFeedback.all(filter === 'all' ? undefined : filter)
      .then(res => setItems(res.feedback))
      .catch(e => { setError(e instanceof Error ? e.message : String(e)); setItems([]); });
  }, [filter]);

  const counts = useMemo(() => {
    const out = new Map<PlatformFeedbackKind, number>();
    for (const f of items ?? []) out.set(f.kind, (out.get(f.kind) ?? 0) + 1);
    return out;
  }, [items]);

  return (
    <section className="space-y-5">
      <LetterEditor lang={lang} />

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight text-stone-950 dark:text-stone-100">
          {zh ? '学生使用反馈' : 'Student feedback'}
        </h2>
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          className="ml-auto inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3.5 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
        >
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {zh ? '导出 CSV' : 'Export CSV'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', ...KINDS.map(k => k.id)] as const).map(id => {
          const active = filter === id;
          const k = id === 'all' ? null : kindOf(id);
          const label = id === 'all' ? (zh ? '全部' : 'All') : (zh ? k!.zh : k!.en);
          const n = id === 'all' ? (items?.length ?? 0) : (counts.get(id) ?? 0);
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                active ? '' : 'border border-stone-200 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900'
              }`}
              style={active ? chipStyle(k ? MORANDI[k.tone] : MORANDI.stone) : undefined}
            >
              {label}{filter === 'all' && n > 0 ? ` · ${n}` : ''}
            </button>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className={`${cardCls} px-6 py-5`}>
        {items === null ? (
          <div className="flex items-center gap-2 py-4 text-sm text-stone-500">
            <Loader2 size={15} className="animate-spin" />{zh ? '加载中…' : 'Loading…'}
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-stone-500 dark:text-stone-400">
            {zh ? '还没有收到反馈。' : 'No feedback yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {items.map(f => {
              const k = kindOf(f.kind);
              return (
                <li key={f.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="rounded-lg px-2 py-0.5 text-xs font-medium" style={chipStyle(MORANDI[k.tone])}>
                      {zh ? k.zh : k.en}
                    </span>
                    <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
                      {f.author?.name || f.author?.email || (zh ? '未知' : 'Unknown')}
                    </span>
                    {f.courseTitle && <span className="text-xs text-stone-500">{f.courseTitle}</span>}
                    <span className="ml-auto text-xs tabular-nums text-stone-400">{formatTime(f.createdAt, zh)}</span>
                  </div>
                  <p className="mt-2 max-w-[70ch] whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-stone-300">{f.body}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};

const PlatformFeedbackPanel: React.FC<{
  lang: Language;
  role: 'student' | 'teacher' | 'admin';
  courseId?: string | null;
}> = ({ lang, role, courseId }) => (
  role === 'admin' ? <AdminView lang={lang} /> : <StudentView lang={lang} courseId={courseId} />
);

export default PlatformFeedbackPanel;
