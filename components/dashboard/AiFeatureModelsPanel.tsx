import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, ChevronDown } from 'lucide-react';
import type { Language } from '../../types';
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
import { MORANDI, noticeStyle } from '../morandiPalette';
import { modelDisplayName, modelOptionLabel, modelSpeedHint, providerDisplayName } from '../aiModelLabels';

/**
 * 课程 AI 设置里的「各功能用哪个 AI」。
 *
 * 平台上每个用到 AI 的地方列一行，可以逐项指定模型，不指定就是「自动」；另外定各入口的模型菜单里显示哪些模型。
 * 功能清单和解析规则在后端 api/src/services/aiFeatureModels.ts，这里只负责显示和保存。
 *
 * 2026-10-11 用户：太长、太晃眼。改成：每个功能一行（名字、谁会用到、下拉框），说明和「出错时换哪家」收进 ⓘ，
 * 「自动」那一项直接写现在用的是哪个；检索与解析这些不能选的折叠起来；
 * 三个入口的模型菜单合成一张表（行是模型、按服务商分组，列是入口），点服务商那一行就一次勾上或取消这家的全部模型；
 * 全部勾上就是不限制，不再另有「全部显示 / 只显示勾选的」两个选项。
 */

type Lang2 = 'zh' | 'en';

const GROUP_ORDER: AiFeatureGroup[] = ['note', 'space', 'dashboard', 'teacher'];

const GROUP_TITLE: Record<AiFeatureGroup, { zh: string; en: string }> = {
  note: { zh: '学生写笔记时', en: 'While students write notes' },
  space: { zh: '知识空间与讨论', en: 'Knowledge space and discussion' },
  dashboard: { zh: '学生仪表盘', en: 'Student dashboard' },
  teacher: { zh: '教师端', en: 'Teacher tools' },
  background: { zh: '检索与解析（自动，不用选）', en: 'Retrieval and parsing (automatic)' },
};

const WHO_LABEL: Record<AiFeatureModelRow['who'], { zh: string; en: string }> = {
  student: { zh: '学生', en: 'Students' },
  teacher: { zh: '教师', en: 'Teachers' },
  both: { zh: '学生和教师', en: 'Both' },
};

const AUTO = 'auto';
const refValue = (ref: AiModelRef) => `${ref.providerId}::${ref.model}`;
const sameRef = (a: AiModelRef, b: AiModelRef) => a.providerId === b.providerId && a.model === b.model;

function labels(lang: Lang2) {
  const zh = lang === 'zh';
  return {
    title: zh ? '各功能用哪个 AI' : 'Which AI each feature uses',
    lead: zh ? '不指定就是「自动」。指定的模型出错或排满时，会自动换下一家。' : 'Leave it on Auto, or pick a model. If the chosen model fails or is busy, the next provider takes over.',
    auto: zh ? '自动' : 'Auto',
    autoWith: (name: string) => (zh ? `自动（现在是 ${name}）` : `Auto (now ${name})`),
    fallbacks: zh ? '出错时换：' : 'On failure: ',
    about: zh ? '说明' : 'About',
    unavailable: (name: string) => (zh
      ? `指定的 ${name} 现在用不了（这门课没有那家的 key，或模型没启用），先按自动走。`
      : `The chosen ${name} is not available now (no key for it, or the model is off); using Auto for now.`),
    none: zh ? '没有可用的服务商' : 'No provider available',
    noProvider: zh
      ? '这门课还没有配置 AI 服务商，下面的功能都用不了，这里也保存不了。请先在「服务商与密钥」里添加一家。'
      : 'This course has no AI provider yet: none of these work and nothing here can be saved. Add one under "Providers & keys" first.',
    cooling: (names: string) => (zh ? `${names} 刚才连续出错，这几分钟暂时排到后面。` : `${names} failed repeatedly just now and is moved back for a few minutes.`),
    pickerTitle: zh ? '模型菜单里显示哪些模型' : 'Models shown in each model menu',
    pickerLead: zh
      ? '勾上的才会出现在那个入口的模型菜单里；全部勾上就是不限制（以后新启用的模型也会出现）。点服务商那一行，一次勾上或取消这家的全部模型。'
      : 'Only ticked models appear in that menu; tick all for no limit (newly enabled models appear too). Tick a provider row to switch all its models at once.',
    model: zh ? '模型' : 'Model',
    surface: {
      note_partner: zh ? { title: '笔记 AI 助手', desc: '笔记页左侧的 AI 助手，学生写笔记时用。' } : { title: 'Note AI partner', desc: 'The AI partner on the note page.' },
      workspace_agent: zh ? { title: '知识空间智能体', desc: '画布顶栏「智能体」打开的侧栏。' } : { title: 'Workspace assistant', desc: 'The panel opened from "Agent" in the canvas top bar.' },
      personal_agent: zh ? { title: '学生 AI 对话', desc: '学生首页的「AI 对话」；老师在自己有教职的课里不受限制。' } : { title: 'Student AI chat', desc: 'The AI chat on the student home; teachers are not limited in courses they teach.' },
    } as Record<AiPickerSurface, { title: string; desc: string }>,
    allOf: (provider: string) => (zh ? `${provider}的全部模型` : `All ${provider} models`),
    isDefault: zh ? '默认' : 'Default',
    defaultHint: zh ? '菜单里的「默认」：上表对应那一行用的模型；它没勾上时用勾上的第一个。' : '"Default" in the menu is the model of the matching row above, or the first ticked one.',
    keepOne: zh ? '每个入口至少留一个模型。' : 'Keep at least one model in each menu.',
    saving: zh ? '保存中…' : 'Saving…',
    saved: zh ? '已保存' : 'Saved',
    notSaved: zh ? '没有保存：' : 'Not saved: ',
    loadFailed: zh ? '没有加载成功：' : 'Failed to load: ',
    noCourse: zh ? '请先创建课程。' : 'Please create a course first.',
    selectFor: (name: string) => (zh ? `${name}用的模型` : `Model for ${name}`),
  };
}

const modelName = (ref: AiModelRef, lang: Lang2) => modelOptionLabel(ref.providerId, ref.model, lang);

/** 下拉框里按厂商分组的选项 */
function groupByProvider(options: AiModelRef[]) {
  const groups = new Map<string, AiModelRef[]>();
  for (const option of options) {
    const list = groups.get(option.providerId) ?? [];
    if (!list.some(o => sameRef(o, option))) list.push(option);
    groups.set(option.providerId, list);
  }
  return Array.from(groups.entries());
}

function FeatureRow({ row, lang, busy, onChoose }: {
  row: AiFeatureModelRow;
  lang: Lang2;
  busy: boolean;
  onChoose: (row: AiFeatureModelRow, value: string) => void;
}) {
  const t = labels(lang);
  const [open, setOpen] = useState(false);
  const value = row.saved && !row.savedUnavailable ? refValue(row.saved) : AUTO;
  const current = row.current;
  const autoLabel = current && current.source !== 'teacher' ? t.autoWith(modelName(current, lang)) : t.auto;
  const about = `${row.desc[lang]}${row.fallbacks.length > 0 ? ` ${t.fallbacks}${row.fallbacks.map(f => modelName(f, lang)).join(' → ')}。` : ''}`;

  return (
    <div data-feature={row.id} className="grid grid-cols-1 gap-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,18rem)] sm:items-center sm:gap-4 sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{row.label[lang]}</span>
          <span className="text-[0.6875rem] text-zinc-400 dark:text-zinc-500">{WHO_LABEL[row.who][lang]}</span>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-label={`${t.about}：${row.label[lang]}`}
            title={about}
            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-gray-900 dark:hover:text-zinc-300"
          >
            <Info size={13} />
          </button>
        </div>
        {open && <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-zinc-500 animate-in fade-in duration-150 dark:text-zinc-400">{about}</p>}
        {row.savedUnavailable && row.saved && (
          <p className="mt-1.5 rounded-lg border px-2 py-1 text-xs leading-relaxed" style={noticeStyle(MORANDI.ochre)}>{t.unavailable(modelName(row.saved, lang))}</p>
        )}
      </div>
      {row.selectable ? (
        <select
          value={value}
          disabled={busy || row.options.length === 0}
          onChange={e => onChoose(row, e.target.value)}
          aria-label={t.selectFor(row.label[lang])}
          className="h-9 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-2.5 text-sm text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus-visible:border-[#000080] focus-visible:ring-2 focus-visible:ring-[#000080]/20 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-100"
        >
          <option value={AUTO}>{row.options.length === 0 && !current ? t.none : autoLabel}</option>
          {groupByProvider(row.options).map(([providerId, options]) => (
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
  );
}

const PICKER_ORDER: AiPickerSurface[] = ['note_partner', 'workspace_agent', 'personal_agent'];

/** 某个入口的菜单设置。旧后端只返回笔记 AI 助手那一份（partnerModels），其余入口当作没有。 */
function pickerData(data: AiFeatureModelsPayload, surface: AiPickerSurface): AiPickerPolicy | null {
  const fromServer = data.pickers?.[surface];
  if (fromServer) return fromServer;
  if (surface !== 'note_partner') return null;
  return { ...data.partnerModels, options: data.features.find(f => f.id === 'note_partner')?.options ?? data.options.chat };
}

/** 勾选框；一部分勾上时显示成「半选」 */
function TriCheckbox({ checked, mixed, ...rest }: { checked: boolean; mixed?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked'>) {
  return (
    <input
      {...rest}
      type="checkbox"
      checked={checked}
      aria-checked={mixed ? 'mixed' : checked}
      ref={el => { if (el) el.indeterminate = Boolean(mixed); }}
      className="h-4 w-4 cursor-pointer accent-[#000080] disabled:cursor-not-allowed"
    />
  );
}

function PickerMatrix({ data, lang, busy, onSave }: {
  data: AiFeatureModelsPayload;
  lang: Lang2;
  busy: boolean;
  onSave: (surface: AiPickerSurface, models: AiModelRef[] | null) => void;
}) {
  const t = labels(lang);
  const [hint, setHint] = useState('');
  const columns = PICKER_ORDER
    .map(surface => ({ surface, policy: pickerData(data, surface) }))
    .filter((c): c is { surface: AiPickerSurface; policy: AiPickerPolicy } => c.policy !== null);
  const providers = groupByProvider(columns.flatMap(c => c.policy.options));

  const allowedOf = (policy: AiPickerPolicy) => (policy.restricted ? policy.allowed ?? policy.options : policy.options);
  const isOption = (policy: AiPickerPolicy, ref: AiModelRef) => policy.options.some(o => sameRef(o, ref));
  const isOn = (policy: AiPickerPolicy, ref: AiModelRef) => allowedOf(policy).some(a => sameRef(a, ref));

  const commit = (surface: AiPickerSurface, policy: AiPickerPolicy, next: AiModelRef[]) => {
    const kept = next.filter(ref => isOption(policy, ref));
    if (kept.length === 0) { setHint(t.keepOne); return; }
    setHint('');
    const everything = policy.options.every(o => kept.some(k => sameRef(k, o)));
    onSave(surface, everything ? null : kept);
  };
  const toggleModel = (surface: AiPickerSurface, policy: AiPickerPolicy, ref: AiModelRef) => {
    const current = allowedOf(policy);
    commit(surface, policy, isOn(policy, ref) ? current.filter(a => !sameRef(a, ref)) : [...current, ref]);
  };
  const toggleProvider = (surface: AiPickerSurface, policy: AiPickerPolicy, providerId: string) => {
    const models = policy.options.filter(o => o.providerId === providerId);
    const current = allowedOf(policy);
    const allOn = models.every(m => current.some(a => sameRef(a, m)));
    commit(surface, policy, allOn
      ? current.filter(a => a.providerId !== providerId)
      : [...current, ...models.filter(m => !current.some(a => sameRef(a, m)))]);
  };

  return (
    <section aria-labelledby="ai-picker-title" className="space-y-2">
      <div>
        <h3 id="ai-picker-title" className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{t.pickerTitle}</h3>
        <p className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t.pickerLead}</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <table className="w-full min-w-[30rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-gray-800 dark:text-zinc-400">
              <th scope="col" className="px-4 py-2 text-left font-medium sm:px-5">{t.model}</th>
              {columns.map(({ surface }) => (
                <th key={surface} scope="col" title={t.surface[surface].desc} className="w-28 px-2 py-2 text-center font-medium">{t.surface[surface].title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {providers.map(([providerId, models]) => {
              const provider = providerDisplayName(providerId, lang);
              return (
                <React.Fragment key={providerId}>
                  <tr className="border-t border-zinc-100 bg-zinc-50/70 dark:border-gray-900 dark:bg-gray-900/50" data-provider-row={providerId}>
                    <th scope="row" className="px-4 py-1.5 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300 sm:px-5">
                      {provider}<span className="ml-1.5 font-normal text-zinc-400">{models.length}</span>
                    </th>
                    {columns.map(({ surface, policy }) => {
                      const mine = policy.options.filter(o => o.providerId === providerId);
                      if (mine.length === 0) return <td key={surface} className="text-center text-xs text-zinc-300 dark:text-zinc-600">—</td>;
                      const onCount = mine.filter(m => isOn(policy, m)).length;
                      return (
                        <td key={surface} className="px-2 py-1.5 text-center">
                          <TriCheckbox
                            checked={onCount === mine.length}
                            mixed={onCount > 0 && onCount < mine.length}
                            disabled={busy}
                            aria-label={`${t.surface[surface].title}：${t.allOf(provider)}`}
                            onChange={() => toggleProvider(surface, policy, providerId)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                  {models.map(model => {
                    const hintText = modelSpeedHint(model.providerId, model.model, lang);
                    return (
                      <tr key={refValue(model)} className="border-t border-zinc-100 dark:border-gray-900">
                        <td className="py-1.5 pl-8 pr-2 sm:pl-9">
                          <span className="text-zinc-800 dark:text-zinc-100">{modelDisplayName(model.model, lang)}</span>
                          {hintText && <span className="ml-2 text-[0.6875rem] text-zinc-400" title={hintText.detail}>{hintText.text}</span>}
                        </td>
                        {columns.map(({ surface, policy }) => {
                          if (!isOption(policy, model)) return <td key={surface} className="text-center text-xs text-zinc-300 dark:text-zinc-600">—</td>;
                          const on = isOn(policy, model);
                          const isDefault = policy.defaultModel ? sameRef(policy.defaultModel, model) : false;
                          return (
                            <td key={surface} className="px-2 py-1.5 text-center">
                              <span className="inline-flex items-center gap-1">
                                <TriCheckbox
                                  checked={on}
                                  disabled={busy}
                                  aria-label={`${t.surface[surface].title}：${modelName(model, lang)}`}
                                  onChange={() => toggleModel(surface, policy, model)}
                                />
                                {isDefault && <span className="text-[0.625rem] font-medium text-[#000080] dark:text-[#93AAFD]" title={t.defaultHint}>{t.isDefault}</span>}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {hint && <p role="status" className="text-xs" style={{ color: MORANDI.rose }}>{hint}</p>}
    </section>
  );
}

export const AiFeatureModelsPanel: React.FC<{ lang: Language; courseId: string }> = ({ lang: rawLang, courseId }) => {
  const lang: Lang2 = rawLang === 'zh' ? 'zh' : 'en';
  const t = labels(lang);
  const [data, setData] = useState<AiFeatureModelsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showBackground, setShowBackground] = useState(false);

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
    if (value === AUTO) { void save({ features: { [row.id]: null } }); return; }
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
    return byGroup;
  }, [data]);

  if (!courseId) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t.noCourse}</p>;

  const coolingNames = (data?.coolingProviders ?? []).map(p => providerDisplayName(p, lang)).join('、');
  const busy = saving || !data?.providerConfigured;
  const background = grouped.get('background') ?? [];

  return (
    <div className="space-y-6">
      {data && !data.providerConfigured && (
        <p className="rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed" style={noticeStyle(MORANDI.ochre)}>{t.noProvider}</p>
      )}
      {coolingNames && (
        <p className="rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed" style={noticeStyle(MORANDI.ochre)}>{t.cooling(coolingNames)}</p>
      )}
      {loadError && (
        <p className="rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed" style={noticeStyle(MORANDI.rose)}>{t.loadFailed}{loadError}</p>
      )}

      {loading && !data ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-11 animate-pulse rounded-xl bg-zinc-100 dark:bg-gray-900" />)}
        </div>
      ) : data ? (
        <>
          <section aria-labelledby="ai-feature-models-title" className="space-y-2">
            <div>
              <h3 id="ai-feature-models-title" className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{t.title}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t.lead}</p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-gray-800 dark:bg-gray-950">
              {GROUP_ORDER.filter(g => grouped.has(g)).map(group => (
                <section key={group} data-group={group} aria-label={GROUP_TITLE[group][lang]} className="border-t border-zinc-100 first:border-t-0 dark:border-gray-900">
                  <h4 className="px-4 pb-0.5 pt-3 text-[0.6875rem] font-semibold text-zinc-400 dark:text-zinc-500 sm:px-5">{GROUP_TITLE[group][lang]}</h4>
                  <div className="divide-y divide-zinc-50 dark:divide-gray-900/60">
                    {grouped.get(group)!.map(row => (
                      <FeatureRow key={row.id} row={row} lang={lang} busy={busy} onChoose={chooseModel} />
                    ))}
                  </div>
                </section>
              ))}
              {background.length > 0 && (
                <section data-group="background" className="border-t border-zinc-100 dark:border-gray-900">
                  <button
                    type="button"
                    onClick={() => setShowBackground(v => !v)}
                    aria-expanded={showBackground}
                    className="flex w-full items-center gap-1 px-4 py-2.5 text-left text-[0.6875rem] font-semibold text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300 sm:px-5"
                  >
                    <ChevronDown size={13} className={`transition-transform duration-200 ${showBackground ? 'rotate-180' : ''}`} />
                    {GROUP_TITLE.background[lang]} · {background.length}
                  </button>
                  {showBackground && (
                    <div className="divide-y divide-zinc-50 animate-in fade-in duration-150 dark:divide-gray-900/60">
                      {background.map(row => <FeatureRow key={row.id} row={row} lang={lang} busy={busy} onChoose={chooseModel} />)}
                    </div>
                  )}
                </section>
              )}
            </div>
          </section>

          <PickerMatrix data={data} lang={lang} busy={busy} onSave={savePicker} />
        </>
      ) : null}

      <div aria-live="polite" className="min-h-[1.5rem] text-xs leading-relaxed">
        {saving ? (
          <span className="text-zinc-400 dark:text-zinc-500">{t.saving}</span>
        ) : saveState === 'error' && saveError ? (
          <span className="rounded-lg border px-2 py-1" style={noticeStyle(MORANDI.rose)}>{t.notSaved}{saveError}</span>
        ) : saveState === 'saved' ? (
          <span className="rounded-lg border px-2 py-1" style={noticeStyle(MORANDI.sage)}>{t.saved}</span>
        ) : null}
      </div>
    </div>
  );
};

export default AiFeatureModelsPanel;
