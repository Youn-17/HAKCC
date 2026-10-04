import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Course, Language } from '../../types';
import {
  ai as aiApi,
  ApiClientError,
  type AiFeatureGroup,
  type AiFeatureModelRow,
  type AiFeatureModelsPatch,
  type AiFeatureModelsPayload,
  type AiModelRef,
  type AiPickerPolicy,
  type AiPickerSurface,
} from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { MORANDI, chipStyle, noticeStyle } from '../morandiPalette';
import {
  modelDisplayName,
  modelOptionLabel,
  modelSpeedHint,
  providerDisplayName,
  type SpeedTone,
} from '../aiModelLabels';

/**
 * 课程 AI 设置里的「各功能用哪个 AI」。
 *
 * 教师原来不知道 AI 反馈、支架建议、生图这些功能各用的是哪个模型：每处代码自己挑，
 * 界面上哪里都看不到。这里把平台上每个用到 AI 的地方列出来，写明谁会用到、现在用哪个模型、
 * 出错时换哪家，并能逐项指定；另外能限定学生在笔记 AI 助手下拉框里能选哪些模型。
 * 功能清单和解析规则在后端 api/src/services/aiFeatureModels.ts，这里只负责显示和保存。
 */

type Lang2 = 'zh' | 'en';

const GROUP_ORDER: AiFeatureGroup[] = ['note', 'space', 'dashboard', 'teacher', 'background'];

const GROUP_TITLE: Record<AiFeatureGroup, { zh: string; en: string }> = {
  note: { zh: '学生写笔记时', en: 'While students write notes' },
  space: { zh: '知识空间与讨论', en: 'Knowledge space and discussion' },
  dashboard: { zh: '学生仪表盘', en: 'Student dashboard' },
  teacher: { zh: '教师端', en: 'Teacher tools' },
  background: { zh: '检索与解析（不在这里选模型）', en: 'Retrieval and parsing (not chosen here)' },
};

const WHO_LABEL: Record<AiFeatureModelRow['who'], { zh: string; en: string; tone: string }> = {
  student: { zh: '学生', en: 'Students', tone: MORANDI.dustyBlue },
  teacher: { zh: '教师', en: 'Teachers', tone: MORANDI.lilac },
  both: { zh: '学生和教师', en: 'Both', tone: MORANDI.clay },
};

const TONE_COLOR: Record<SpeedTone, string> = {
  fast: MORANDI.sage,
  medium: MORANDI.ochre,
  slow: MORANDI.rose,
};

const AUTO = 'auto';
/** 宽屏时功能、谁会用到、现在用、指定模型四列，与表头对齐 */
const FEATURE_GRID_LG = 'lg:grid-cols-[minmax(0,1.4fr)_6.5rem_minmax(0,1.3fr)_minmax(12rem,15rem)] lg:items-start lg:gap-5';
const refValue = (ref: AiModelRef) => `${ref.providerId}::${ref.model}`;
const sameRef = (a: AiModelRef, b: AiModelRef) => a.providerId === b.providerId && a.model === b.model;

function labels(lang: Lang2) {
  const zh = lang === 'zh';
  return {
    title: zh ? '各功能用哪个 AI' : 'Which AI each feature uses',
    desc: zh
      ? '这里列出平台上每个用到 AI 的地方、谁会用到、现在用的是哪个模型。每一项都可以指定模型；不指定就是「自动」：学生在等结果的功能先用 DeepSeek Flash，生成图片先用 DMX（聊天里说「画一张……」也会自动用它出图）。'
      : 'Every place on the platform that uses AI, who uses it, and the model it uses now. You can pick a model for each; otherwise it is "Auto": features students wait on start with DeepSeek Flash, and images start with DMX (a "draw …" request in any chat also uses it).',
    failoverNote: zh
      ? '指定的模型出错，或同时请求太多排不上时，会按原来的顺序换下一家。'
      : 'If the chosen model fails or is saturated, the request moves on to the next provider in the usual order.',
    legend: zh ? '速度提示来自 2026 年 9 月的实测。' : 'Speed notes come from measurements in September 2026.',
    course: zh ? '课程' : 'Course',
    feature: zh ? '功能' : 'Feature',
    who: zh ? '谁会用到' : 'Used by',
    current: zh ? '现在用' : 'Uses now',
    choose: zh ? '指定模型' : 'Model',
    auto: zh ? '自动' : 'Auto',
    autoWith: (name: string) => (zh ? `自动（现在是 ${name}）` : `Auto (now ${name})`),
    tagTeacher: zh ? '已指定' : 'Chosen',
    tagAuto: zh ? '自动' : 'Auto',
    tagFixed: zh ? '固定' : 'Fixed',
    tagActivityDefault: zh ? '新建活动的默认' : 'Default for new activities',
    fallbacks: zh ? '出错时换：' : 'On failure: ',
    unavailable: (name: string) => (zh
      ? `指定的 ${name} 现在用不了（这门课没有那家的 key，或模型没启用），先按自动走。`
      : `The chosen ${name} is not available now (no key for it, or the model is not enabled); using Auto for now.`),
    none: zh ? '没有可用的服务商' : 'No provider available',
    noProvider: zh
      ? '这门课还没有配置 AI 服务商，下面的功能都用不了，这里也保存不了。请先在上方「AI 集成设置」里添加一个。'
      : 'This course has no AI provider yet: none of these features work and nothing here can be saved. Add one in "AI Integration Settings" above first.',
    cooling: (names: string) => (zh ? `${names} 刚才连续出错，这几分钟暂时排到后面。` : `${names} failed repeatedly just now and is moved back for a few minutes.`),
    pickerTitle: zh ? '各入口的模型菜单里显示哪些模型' : 'Which models each model menu shows',
    pickerDesc: zh
      ? '勾上的模型才会出现在那个入口的模型菜单里，可以多选。菜单里的「默认」是上表对应那一行的模型；那个模型没勾上时，「默认」改用勾上的里排在最前的。'
      : 'Only ticked models appear in that entry\'s model menu; tick as many as you like. "Default" in the menu is the model of the matching row above; if that model is not ticked, Default uses the first ticked one.',
    pickerSurface: {
      note_partner: zh
        ? { title: '笔记 AI 助手', desc: '笔记页左侧的 AI 助手，学生写笔记时用。' }
        : { title: 'Note AI partner', desc: 'The AI partner on the left of the note page, used while writing notes.' },
      workspace_agent: zh
        ? { title: '知识空间助手', desc: '画布顶栏「助手」打开的侧栏。' }
        : { title: 'Workspace assistant', desc: 'The side panel opened from "Agent" in the canvas top bar.' },
      personal_agent: zh
        ? { title: '学生首页的「AI 对话」', desc: '只管学生；老师在自己有教职的课里不受这份名单限制。' }
        : { title: 'Students\' AI chat', desc: 'Applies to students only; teachers are not limited in courses they teach.' },
    } as Record<AiPickerSurface, { title: string; desc: string }>,
    partnerAll: zh ? '全部显示（这门课启用的对话模型）' : 'Show all chat models enabled for this course',
    partnerSome: zh ? '只显示勾选的' : 'Show only the ticked ones',
    partnerDefault: zh ? '默认' : 'Default',
    keepOne: zh ? '至少留一个' : 'Keep at least one',
    saving: zh ? '保存中…' : 'Saving…',
    saved: zh ? '已保存' : 'Saved',
    notSaved: zh ? '没有保存：' : 'Not saved: ',
    loadFailed: zh ? '没有加载成功：' : 'Failed to load: ',
    noCourse: zh ? '请先创建课程。' : 'Please create a course first.',
    selectFor: (name: string) => (zh ? `${name}用的模型` : `Model for ${name}`),
  };
}

function SpeedChip({ providerId, model, lang }: { providerId: string; model: string; lang: Lang2 }) {
  const hint = modelSpeedHint(providerId, model, lang);
  if (!hint) return null;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium"
      style={chipStyle(TONE_COLOR[hint.tone])}
      title={hint.detail}
    >
      {hint.text}
    </span>
  );
}

function modelName(ref: AiModelRef, lang: Lang2) {
  return modelOptionLabel(ref.providerId, ref.model, lang);
}

/** 下拉框里按厂商分组的选项 */
function groupOptions(options: AiModelRef[]) {
  const groups = new Map<string, AiModelRef[]>();
  for (const option of options) {
    const list = groups.get(option.providerId) ?? [];
    list.push(option);
    groups.set(option.providerId, list);
  }
  return Array.from(groups.entries());
}

function FeatureRow({
  row, lang, busy, onChoose,
}: {
  row: AiFeatureModelRow;
  lang: Lang2;
  busy: boolean;
  onChoose: (row: AiFeatureModelRow, value: string) => void;
}) {
  const t = labels(lang);
  const who = WHO_LABEL[row.who];
  const current = row.current;
  const value = row.saved && !row.savedUnavailable ? refValue(row.saved) : AUTO;
  const autoName = current && current.source !== 'teacher' ? modelName(current, lang) : null;
  const sourceTags: Record<NonNullable<AiFeatureModelRow['current']>['source'], string> = {
    teacher: t.tagTeacher,
    default: t.tagAuto,
    auto: t.tagAuto,
    fixed: t.tagFixed,
    activity_default: t.tagActivityDefault,
  };
  const sourceTag = current ? sourceTags[current.source] : null;

  // 手机上一列往下排；平板左边是说明、右边是下拉框；宽屏四列对齐表头
  return (
    <div
      className={`grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] sm:gap-x-6 sm:px-5 ${FEATURE_GRID_LG}`}
      data-feature={row.id}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{row.label[lang]}</div>
        <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{row.desc[lang]}</p>
      </div>

      <div className="sm:col-start-1 lg:col-start-auto">
        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium" style={chipStyle(who.tone)}>
          {who[lang]}
        </span>
      </div>

      <div className="min-w-0 space-y-1.5 sm:col-start-1 lg:col-start-auto">
        {current ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100" data-current-model>{modelName(current, lang)}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{providerDisplayName(current.providerId, lang)}</span>
              {sourceTag && (current.source === 'teacher' ? (
                <span className="inline-flex items-center rounded-full border border-[#000080] px-1.5 py-0.5 text-[0.625rem] font-semibold text-[#000080] dark:border-[#93AAFD] dark:text-[#93AAFD]">
                  {sourceTag}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold" style={chipStyle(MORANDI.stone)}>
                  {sourceTag}
                </span>
              ))}
              <SpeedChip providerId={current.providerId} model={current.model} lang={lang} />
            </div>
            {row.fallbacks.length > 0 && (
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {t.fallbacks}{row.fallbacks.map(f => modelName(f, lang)).join(' → ')}
              </p>
            )}
          </>
        ) : (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{t.none}</span>
        )}
        {row.savedUnavailable && row.saved && (
          <p className="rounded-lg border px-2 py-1 text-xs leading-relaxed" style={noticeStyle(MORANDI.ochre)}>
            {t.unavailable(modelName(row.saved, lang))}
          </p>
        )}
      </div>

      <div className="min-w-0 sm:col-start-2 sm:row-span-3 sm:row-start-1 lg:col-start-auto lg:row-span-1 lg:row-start-auto">
        {row.selectable ? (
          <select
            value={value}
            disabled={busy || row.options.length === 0}
            onChange={e => onChoose(row, e.target.value)}
            aria-label={t.selectFor(row.label[lang])}
            title={value === AUTO ? (autoName ? t.autoWith(autoName) : t.auto) : (row.saved ? modelName(row.saved, lang) : undefined)}
            className="h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus-visible:border-[#000080] focus-visible:ring-2 focus-visible:ring-[#000080]/20 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-100 sm:h-10"
          >
            <option value={AUTO}>{t.auto}</option>
            {groupOptions(row.options).map(([providerId, options]) => (
              <optgroup key={providerId} label={providerDisplayName(providerId, lang)}>
                {options.map(option => {
                  const hint = modelSpeedHint(option.providerId, option.model, lang);
                  return (
                    <option key={refValue(option)} value={refValue(option)}>
                      {modelDisplayName(option.model, lang)}{hint ? ` · ${hint.text}` : ''}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        ) : (
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{row.fixedNote?.[lang]}</p>
        )}
      </div>
    </div>
  );
}

const PICKER_ORDER: AiPickerSurface[] = ['note_partner', 'workspace_agent', 'personal_agent'];

/** 某个入口的菜单设置。旧后端只返回笔记 AI 助手那一份（partnerModels），其余入口当作没有。 */
function pickerData(data: AiFeatureModelsPayload, surface: AiPickerSurface): AiPickerPolicy | null {
  const fromServer = data.pickers?.[surface];
  if (fromServer) return fromServer;
  if (surface !== 'note_partner') return null;
  return {
    ...data.partnerModels,
    options: data.features.find(f => f.id === 'note_partner')?.options ?? data.options.chat,
  };
}

function PickerBlock({
  surface, policy, lang, busy, onSave,
}: {
  surface: AiPickerSurface;
  policy: AiPickerPolicy;
  lang: Lang2;
  busy: boolean;
  onSave: (surface: AiPickerSurface, models: AiModelRef[] | null) => void;
}) {
  const t = labels(lang);
  const { options, restricted, defaultModel } = policy;
  const allowed = policy.allowed ?? options;
  const isAllowed = (ref: AiModelRef) => allowed.some(a => sameRef(a, ref));
  const headingId = `ai-picker-${surface}`;

  const toggle = (ref: AiModelRef) => {
    const next = isAllowed(ref) ? allowed.filter(a => !sameRef(a, ref)) : [...allowed, ref];
    if (next.length === 0) return;
    onSave(surface, next);
  };

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-gray-800" role="group" aria-labelledby={headingId}>
      <div>
        <h4 id={headingId} className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{t.pickerSurface[surface].title}</h4>
        <p className="mt-0.5 max-w-[65ch] text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t.pickerSurface[surface].desc}</p>
      </div>

      <div className="flex flex-col gap-1 sm:flex-row sm:gap-6" role="radiogroup" aria-labelledby={headingId}>
        {[
          { value: false, text: t.partnerAll },
          { value: true, text: t.partnerSome },
        ].map(choice => (
          <label key={String(choice.value)} className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
            <input
              type="radio"
              name={`ai-picker-scope-${surface}`}
              checked={restricted === choice.value}
              disabled={busy || options.length === 0}
              onChange={() => onSave(surface, choice.value ? (policy.allowed ?? options) : null)}
              className="h-4 w-4 accent-[#000080]"
            />
            {choice.text}
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {options.map(option => {
          const checked = isAllowed(option);
          const lastOne = restricted && checked && allowed.length === 1;
          const isDefault = defaultModel ? sameRef(defaultModel, option) : false;
          return (
            <label
              key={refValue(option)}
              className={`flex min-h-[44px] items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
                restricted ? 'cursor-pointer border-zinc-200 hover:bg-zinc-50 dark:border-gray-700 dark:hover:bg-gray-900' : 'border-zinc-100 opacity-70 dark:border-gray-800'
              }`}
              title={lastOne ? t.keepOne : modelSpeedHint(option.providerId, option.model, lang)?.detail}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!restricted || busy || lastOne}
                onChange={() => toggle(option)}
                className="h-4 w-4 shrink-0 accent-[#000080]"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-zinc-800 dark:text-zinc-100">{modelName(option, lang)}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{providerDisplayName(option.providerId, lang)}{isDefault ? ` · ${t.partnerDefault}` : ''}</span>
                  <SpeedChip providerId={option.providerId} model={option.model} lang={lang} />
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PickerModels({
  data, lang, busy, onSave,
}: {
  data: AiFeatureModelsPayload;
  lang: Lang2;
  busy: boolean;
  onSave: (surface: AiPickerSurface, models: AiModelRef[] | null) => void;
}) {
  const t = labels(lang);
  const blocks = PICKER_ORDER
    .map(surface => ({ surface, policy: pickerData(data, surface) }))
    .filter((b): b is { surface: AiPickerSurface; policy: AiPickerPolicy } => b.policy !== null);

  return (
    <div className="space-y-4 border-t border-zinc-200 px-4 py-5 dark:border-gray-800 sm:px-5">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{t.pickerTitle}</h3>
        <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t.pickerDesc}</p>
      </div>
      {blocks.map(({ surface, policy }) => (
        <PickerBlock key={surface} surface={surface} policy={policy} lang={lang} busy={busy} onSave={onSave} />
      ))}
    </div>
  );
}

export const AiFeatureModelsPanel: React.FC<{ lang: Language; courseId: string; courses?: Course[] }> = ({ lang: rawLang, courseId: initialCourseId, courses = [] }) => {
  const lang: Lang2 = rawLang === 'zh' ? 'zh' : 'en';
  const t = labels(lang);
  const [activeCourseId, setActiveCourseId] = useState(initialCourseId);
  const courseId = activeCourseId || initialCourseId;
  const [data, setData] = useState<AiFeatureModelsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setSaveState('idle');
    setSaveError(null);
    aiApi.getFeatureModels(courseId)
      .then(payload => { if (alive) setData(payload); })
      .catch(err => { if (alive) setLoadError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [courseId]);

  const save = useCallback(async (patch: AiFeatureModelsPatch) => {
    if (!courseId) return;
    setSaving(true);
    setSaveError(null);
    try {
      setData(await aiApi.updateFeatureModels(courseId, patch));
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof ApiClientError || err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [courseId]);

  const chooseModel = useCallback((row: AiFeatureModelRow, value: string) => {
    if (value === AUTO) {
      void save({ features: { [row.id]: null } });
      return;
    }
    const [providerId, ...rest] = value.split('::');
    void save({ features: { [row.id]: { provider_id: providerId, model: rest.join('::') } } });
  }, [save]);

  const savePicker = useCallback((surface: AiPickerSurface, models: AiModelRef[] | null) => {
    const list = models ? models.map(m => ({ provider_id: m.providerId, model: m.model })) : null;
    // 笔记 AI 助手沿用原来的 partner_models，另外两个入口走 picker_models
    void save(surface === 'note_partner' ? { partner_models: list } : { picker_models: { [surface]: list } });
  }, [save]);

  const grouped = useMemo(() => {
    const byGroup = new Map<AiFeatureGroup, AiFeatureModelRow[]>();
    for (const row of data?.features ?? []) {
      const list = byGroup.get(row.group) ?? [];
      list.push(row);
      byGroup.set(row.group, list);
    }
    return GROUP_ORDER.filter(g => byGroup.has(g)).map(g => [g, byGroup.get(g)!] as const);
  }, [data]);

  if (!courseId) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t.noCourse}</p>;

  const coolingNames = (data?.coolingProviders ?? []).map(p => providerDisplayName(p, lang)).join('、');

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white dark:border-gray-800 dark:bg-gray-950" aria-labelledby="ai-feature-models-title">
      <div className="space-y-4 px-4 pt-5 sm:px-5 sm:pt-6">
        {courses.length > 1 && (
          <label className="block max-w-md">
            <span className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">{t.course}</span>
            <select
              value={courseId}
              onChange={e => setActiveCourseId(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none focus-visible:border-[#000080] focus-visible:ring-2 focus-visible:ring-[#000080]/20 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-100"
            >
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        )}

        <div>
          <div className="flex items-center gap-2">
            <RemixIcon name="route-line" size={16} className="text-[#000080] dark:text-[#93AAFD]" />
            <h3 id="ai-feature-models-title" className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{t.title}</h3>
          </div>
          <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{t.desc}</p>
          <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{t.failoverNote}</p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t.legend}</p>
        </div>

        {data && !data.providerConfigured && (
          <p className="rounded-xl border px-3 py-2 text-sm leading-relaxed" style={noticeStyle(MORANDI.ochre)}>{t.noProvider}</p>
        )}
        {coolingNames && (
          <p className="rounded-xl border px-3 py-2 text-sm leading-relaxed" style={noticeStyle(MORANDI.ochre)}>{t.cooling(coolingNames)}</p>
        )}
        {loadError && (
          <p className="rounded-xl border px-3 py-2 text-sm leading-relaxed" style={noticeStyle(MORANDI.rose)}>{t.loadFailed}{loadError}</p>
        )}
      </div>

      {loading && !data ? (
        <div className="space-y-3 px-4 py-5 sm:px-5" aria-busy="true">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`grid grid-cols-1 gap-3 ${FEATURE_GRID_LG}`}>
              <div className="h-10 animate-pulse rounded-lg bg-zinc-100 dark:bg-gray-900" />
              <div className="h-6 animate-pulse rounded-full bg-zinc-100 dark:bg-gray-900" />
              <div className="h-10 animate-pulse rounded-lg bg-zinc-100 dark:bg-gray-900" />
              <div className="h-10 animate-pulse rounded-xl bg-zinc-100 dark:bg-gray-900" />
            </div>
          ))}
        </div>
      ) : data ? (
        <>
          <div className="mt-4">
            <div
              aria-hidden="true"
              className={`hidden border-y border-zinc-200 bg-zinc-50 px-5 py-2 text-xs font-medium text-zinc-500 dark:border-gray-800 dark:bg-gray-900 dark:text-zinc-400 lg:grid ${FEATURE_GRID_LG}`}
            >
              <span>{t.feature}</span>
              <span>{t.who}</span>
              <span>{t.current}</span>
              <span>{t.choose}</span>
            </div>
            {grouped.map(([group, rows]) => (
              <section key={group} data-group={group} aria-label={GROUP_TITLE[group][lang]}>
                <h4 className="border-b border-zinc-200 px-4 pb-2 pt-5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-gray-800 dark:text-zinc-400 sm:px-5">
                  {GROUP_TITLE[group][lang]}
                </h4>
                <div className="divide-y divide-zinc-100 dark:divide-gray-900">
                  {rows.map(row => (
                    <FeatureRow key={row.id} row={row} lang={lang} busy={saving || !data.providerConfigured} onChoose={chooseModel} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <PickerModels data={data} lang={lang} busy={saving || !data.providerConfigured} onSave={savePicker} />
        </>
      ) : null}

      <div aria-live="polite" className="min-h-[2.75rem] px-4 pb-4 text-xs leading-relaxed sm:px-5">
        {saving ? (
          <span className="text-zinc-400 dark:text-zinc-500">{t.saving}</span>
        ) : saveState === 'error' && saveError ? (
          <span className="rounded-lg border px-2 py-1" style={noticeStyle(MORANDI.rose)}>{t.notSaved}{saveError}</span>
        ) : saveState === 'saved' ? (
          <span className="rounded-lg border px-2 py-1" style={noticeStyle(MORANDI.sage)}>{t.saved}</span>
        ) : null}
      </div>
    </section>
  );
};

export default AiFeatureModelsPanel;
