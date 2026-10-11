import React, { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Language } from '../../../types';
import { ai as aiApi, ApiClientError, type TriggerSettings } from '../../../services/apiClient';
import { MORANDI, noticeStyle } from '../../morandiPalette';

/**
 * 自动反馈（原「AI 触发设置」，原来写在 Dashboard.tsx 里）。
 *
 * 2026-10-11 用户：AI 设置太长、太晃眼。改成：总开关一行；关着的时候下面什么都不显示；
 * 检查哪些情况用一排可点的标签（说明放在悬停提示里，不再每项一张带说明的卡片）；
 * 灵敏度和反馈语言并排；冷却时间、最长字数这两个很少改的收进「更多设置」。
 * 每改一项立刻保存，保存失败说出原因（以前失败被吞掉，界面照样显示「已保存」）。
 */

const TRIGGERS: { id: string; zh: string; en: string; descZh: string; descEn: string }[] = [
  { id: 'undigested_ai', zh: '未消化的 AI 内容', en: 'Undigested AI text', descZh: '学生把 AI 的回答直接贴进来，没有自己的话（T1）', descEn: 'AI output pasted without the student\'s own voice (T1)' },
  { id: 'no_reasoning', zh: '缺少推理', en: 'No reasoning', descZh: '有观点，但没说为什么（T2）', descEn: 'An opinion without explanation (T2)' },
  { id: 'no_evidence', zh: '缺少证据', en: 'No evidence', descZh: '提出主张，但没有证据支撑（T3）', descEn: 'A claim without evidence (T3)' },
  { id: 'no_connection', zh: '缺少关联', en: 'No connection', descZh: '罗列要点，但没有把它们联系起来（T4）', descEn: 'Points listed without connections (T4)' },
  { id: 'promising_seed', zh: '有潜力的想法', en: 'Promising idea', descZh: '想法不错，可以再深入（正面反馈，T5）', descEn: 'A good idea that could go deeper (positive, T5)' },
  { id: 'unclear', zh: '表意不清', en: 'Unclear', descZh: '意思不清楚，或者是真问题（T6）', descEn: 'Meaning unclear, or a genuine question (T6)' },
];

function copy(zh: boolean) {
  return {
    autoFeedback: zh ? '学生写笔记时，AI 自动给反馈' : 'AI gives feedback while students write',
    autoFeedbackHint: zh ? '关掉后，下面这些都不起作用。' : 'When off, the settings below have no effect.',
    triggers: zh ? '检查哪些情况' : 'Look for',
    sensitivity: zh ? '灵敏度' : 'Sensitivity',
    sensitivityOptions: zh ? { conservative: '保守', balanced: '平衡', aggressive: '积极' } : { conservative: 'Conservative', balanced: 'Balanced', aggressive: 'Active' },
    responseLang: zh ? '反馈用的语言' : 'Feedback language',
    responseLangOptions: { auto: zh ? '自动' : 'Auto', zh: '中文', en: 'English' },
    responseLangHint: zh ? '自动：跟学生笔记的语言走。' : 'Auto follows the language of the note.',
    customContext: zh ? '课程背景（可选）' : 'Course context (optional)',
    customContextHint: zh ? '一两句话说明这门课在讨论什么，帮 AI 读懂学生的笔记。' : 'A sentence or two about the course, to help the AI read notes.',
    more: zh ? '更多设置：冷却时间、反馈最长字数' : 'More: cooldown, max length',
    cooldown: zh ? '同一个学生两次反馈至少隔' : 'Minimum gap between two feedbacks',
    maxLength: zh ? '反馈最长' : 'Max feedback length',
    chars: zh ? '字' : 'chars',
    viewTopics: zh ? '画布顶上滚动显示讨论主题' : 'Rolling discussion topics above the canvas',
    viewTopicsHint: zh ? 'AI 按笔记总结这个视图在谈哪几个主题，最快 3 分钟更新一次；实验对照组看不到。' : 'The AI sums up the topics in the view from the notes, at most every 3 minutes; hidden from the control group.',
    saving: zh ? '保存中…' : 'Saving…',
    saved: zh ? '已保存' : 'Saved',
    notSaved: zh ? '没有保存：' : 'Not saved: ',
    loadFailed: zh ? '自动反馈设置没有加载成功：' : 'Auto-feedback settings failed to load: ',
    noCourse: zh ? '请先创建课程。' : 'Please create a course first.',
    noProvider: zh
      ? '这门课还没有配置 AI 服务商：自动反馈不会运行，这里的设置也保存不了。请先在「服务商与密钥」里添加一家。'
      : 'This course has no AI provider yet: feedback will not run and nothing here can be saved. Add one under "Providers & keys" first.',
    noProviderSave: zh
      ? '这门课还没有配置 AI 服务商。请先在「服务商与密钥」里添加一家。'
      : 'this course has no AI provider yet. Add one under "Providers & keys" first.',
  };
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 disabled:opacity-50 ${on ? 'bg-[#000080] dark:bg-[#4169E1]' : 'bg-zinc-300 dark:bg-gray-700'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${on ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-0.5 dark:border-gray-800 dark:bg-gray-900">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`min-h-8 rounded-[0.6rem] px-3 text-sm font-medium transition-all duration-200 ${value === v ? 'bg-white text-[#000080] shadow-sm dark:bg-gray-800 dark:text-[#93AAFD]' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export const TriggerSettingsPanel: React.FC<{ lang: Language; courseId: string }> = ({ lang, courseId }) => {
  const zh = lang === 'zh';
  const t = copy(zh);
  const [settings, setSettings] = useState<TriggerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 设置存在服务商配置行上，一行都没有时保存必然 404
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setSaveState('idle');
    setSaveError(null);
    aiApi.getTriggerSettings(courseId)
      .then(({ settings: s, providerConfigured: configured }) => {
        if (!alive) return;
        setSettings(s);
        setProviderConfigured(configured !== false);
      })
      .catch(err => { if (alive) setLoadError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [courseId]);

  const save = async (patch: Partial<TriggerSettings>) => {
    if (!courseId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { settings: updated } = await aiApi.updateTriggerSettings(courseId, patch);
      setSettings(updated);
      setProviderConfigured(true);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      if (err instanceof ApiClientError && err.status === 404) {
        setProviderConfigured(false);
        setSaveError(`${t.notSaved}${t.noProviderSave}`);
      } else {
        setSaveError(`${t.notSaved}${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!courseId) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t.noCourse}</p>;

  if (loadError) {
    return <p className="rounded-xl border px-3.5 py-2.5 text-sm" style={noticeStyle(MORANDI.rose)}>{t.loadFailed}{loadError}</p>;
  }
  if (loading || !settings) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-100 dark:bg-gray-900" />)}
      </div>
    );
  }

  const on = settings.auto_feedback_enabled;
  return (
    <div className="space-y-4">
      {!providerConfigured && (
        <p className="rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed" style={noticeStyle(MORANDI.ochre)}>{t.noProvider}</p>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.autoFeedback}</p>
            {!on && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t.autoFeedbackHint}</p>}
          </div>
          <Switch on={on} label={t.autoFeedback} onChange={() => void save({ auto_feedback_enabled: !on })} />
        </div>

        {on && (
          <div className="space-y-5 border-t border-zinc-100 px-4 py-4 animate-in fade-in slide-in-from-top-1 duration-200 dark:border-gray-900 sm:px-5">
            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{t.triggers}</p>
              <div className="flex flex-wrap gap-1.5">
                {TRIGGERS.map(trigger => {
                  const enabled = settings.enabled_triggers.includes(trigger.id);
                  return (
                    <button
                      key={trigger.id}
                      type="button"
                      aria-pressed={enabled}
                      title={zh ? trigger.descZh : trigger.descEn}
                      onClick={() => void save({
                        enabled_triggers: enabled ? settings.enabled_triggers.filter(x => x !== trigger.id) : [...settings.enabled_triggers, trigger.id],
                      })}
                      className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-sm transition-all duration-200 active:scale-[0.97] ${enabled
                        ? 'border-[#000080]/30 bg-[#000080]/[0.06] font-medium text-[#000080] dark:border-[#93AAFD]/40 dark:bg-[#93AAFD]/10 dark:text-[#93AAFD]'
                        : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:border-gray-700 dark:text-zinc-400'}`}
                    >
                      {enabled && <Check size={13} />}
                      {zh ? trigger.zh : trigger.en}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{t.sensitivity}</p>
                <Segmented
                  label={t.sensitivity}
                  value={settings.sensitivity}
                  onChange={v => void save({ sensitivity: v })}
                  options={(['conservative', 'balanced', 'aggressive'] as const).map(v => [v, t.sensitivityOptions[v]] as [typeof v, string])}
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400" title={t.responseLangHint}>{t.responseLang}</p>
                <Segmented
                  label={t.responseLang}
                  value={settings.response_language}
                  onChange={v => void save({ response_language: v })}
                  options={(['auto', 'zh', 'en'] as const).map(v => [v, t.responseLangOptions[v]] as [typeof v, string])}
                />
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">{t.customContext}</span>
              <textarea
                value={settings.custom_context}
                onChange={e => setSettings({ ...settings, custom_context: e.target.value })}
                onBlur={() => void save({ custom_context: settings.custom_context })}
                rows={2}
                maxLength={500}
                placeholder={t.customContextHint}
                className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition-colors focus:border-[#000080]/40 focus:ring-2 focus:ring-[#000080]/10 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-100"
              />
            </label>

            <div>
              <button type="button" onClick={() => setMore(v => !v)} aria-expanded={more} className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:hover:text-zinc-200">
                <ChevronDown size={14} className={`transition-transform duration-200 ${more ? 'rotate-180' : ''}`} />
                {t.more}
              </button>
              {more && (
                <div className="mt-3 grid gap-4 animate-in fade-in slide-in-from-top-1 duration-150 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 flex items-baseline justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      {t.cooldown}
                      <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-200">{settings.cooldown_seconds}s</span>
                    </span>
                    <input
                      type="range" min={30} max={600} step={30}
                      value={settings.cooldown_seconds}
                      onChange={e => setSettings({ ...settings, cooldown_seconds: Number(e.target.value) })}
                      onPointerUp={() => void save({ cooldown_seconds: settings.cooldown_seconds })}
                      onKeyUp={() => void save({ cooldown_seconds: settings.cooldown_seconds })}
                      className="w-full accent-[#000080]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 flex items-baseline justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      {t.maxLength}
                      <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-200">{settings.max_feedback_length} {t.chars}</span>
                    </span>
                    <input
                      type="range" min={50} max={1000} step={50}
                      value={settings.max_feedback_length}
                      onChange={e => setSettings({ ...settings, max_feedback_length: Number(e.target.value) })}
                      onPointerUp={() => void save({ max_feedback_length: settings.max_feedback_length })}
                      onKeyUp={() => void save({ max_feedback_length: settings.max_feedback_length })}
                      className="w-full accent-[#000080]"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 dark:border-gray-800 dark:bg-gray-950 sm:px-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.viewTopics}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t.viewTopicsHint}</p>
        </div>
        <Switch on={settings.view_topics_enabled !== false} label={t.viewTopics} onChange={() => void save({ view_topics_enabled: settings.view_topics_enabled === false })} />
      </section>

      <div aria-live="polite" className="min-h-[1.25rem] text-xs leading-relaxed">
        {saving ? (
          <span className="text-zinc-400 dark:text-zinc-500">{t.saving}</span>
        ) : saveState === 'error' && saveError ? (
          <span className="rounded-lg border px-2 py-1" style={noticeStyle(MORANDI.rose)}>{saveError}</span>
        ) : saveState === 'saved' ? (
          <span className="rounded-lg border px-2 py-1" style={noticeStyle(MORANDI.sage)}>{t.saved}</span>
        ) : null}
      </div>
    </div>
  );
};

export default TriggerSettingsPanel;
