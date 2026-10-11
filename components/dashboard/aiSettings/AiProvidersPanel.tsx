import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, Trash2, X, ChevronDown } from 'lucide-react';
import type { Language } from '../../../types';
import { ai as aiApi, aiModels, type AiModelCatalog, type ApiAIConfig } from '../../../services/apiClient';
import { isKnownModel, modelDisplayName, modelSpeedHint } from '../../aiModelLabels';
import { MORANDI, noticeStyle } from '../../morandiPalette';
import { ALL_PROVIDERS, providerById, providerImageModels, providerModelOptions, type ProviderMeta } from './providers';

/**
 * 服务商与密钥（2026-10-11 用户：AI 设置太长太复杂，配置 AI 的部分要紧凑）。
 *
 * 原来 14 家服务商各画一张大卡片（图标、介绍、支持模型、按钮），一屏只看得到四五家。
 * 现在：已配置的每家一行（验证状态、启用了几个模型、管理）；没配置的缩成一排小按钮，点开再填。
 * 选模型改成清楚的勾选框（默认全勾，可全选/全不选）——原来「一个都不选等于全选」，点一个反而只剩一个；
 * 改勾选不用重输 Key；接口地址、自定义模型收在「高级」里。
 */

interface Props {
  lang: Language;
  courseId: string;
}

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string };
const TONE = { ok: MORANDI.sage, warn: MORANDI.ochre, error: MORANDI.rose } as const;

function copy(zh: boolean) {
  return {
    configured: zh ? '已配置' : 'Configured',
    none: zh
      ? '这门课还没有配置 AI 服务商，AI 功能都用不了。从下面选一家添加，一般先加 DMXAPI 聚合或 DeepSeek。'
      : 'No AI provider yet, so no AI feature works in this course. Add one below; DMXAPI or DeepSeek is a good start.',
    add: zh ? '添加服务商' : 'Add a provider',
    manage: zh ? '管理' : 'Manage',
    remove: zh ? '移除' : 'Remove',
    confirmRemove: zh ? '确定移除？' : 'Remove it?',
    cancel: zh ? '取消' : 'Cancel',
    verified: zh ? '已验证' : 'Verified',
    unverified: zh ? 'Key 没通过验证' : 'Key not verified',
    modelsOn: (n: number) => (zh ? `启用 ${n} 个模型` : `${n} model${n === 1 ? '' : 's'} on`),
    webSearch: zh ? '网页证据检索' : 'Web evidence search',
    loading: zh ? '加载中…' : 'Loading…',
    loadFailed: zh ? '没有加载成功：' : 'Failed to load: ',
    removed: (name: string) => (zh ? `已移除 ${name}。` : `${name} removed.`),
    removeFailed: zh ? '没有移除成功，请再试一次。' : 'Could not remove it. Please try again.',
    savedVerified: zh ? '已保存，Key 验证通过。' : 'Saved. The key was verified.',
    savedUnverified: zh ? '已保存，但 Key 没有通过连通性验证，请检查 Key 是否正确。' : 'Saved, but the key failed the connectivity check. Please check it.',
    savedModels: zh ? '已保存启用的模型。' : 'Enabled models saved.',
  };
}

const AiProvidersPanel: React.FC<Props> = ({ lang, courseId }) => {
  const zh = lang === 'zh';
  const t = copy(zh);
  const [configs, setConfigs] = useState<ApiAIConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<AiModelCatalog | null>(null);
  const [dialog, setDialog] = useState<{ provider: ProviderMeta; existing: ApiAIConfig | null } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => { aiModels.catalog().then(setCatalog).catch(() => setCatalog(null)); }, []);

  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    aiApi.listConfigs(courseId)
      .then(({ configs: list }) => { if (alive) setConfigs(list); })
      .catch(err => { if (alive) setLoadError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [courseId]);

  const configured = useMemo(
    () => ALL_PROVIDERS.filter(p => configs.some(c => c.providerId === p.id))
      .map(p => ({ provider: p, config: configs.find(c => c.providerId === p.id)! })),
    [configs],
  );
  const unconfigured = useMemo(() => ALL_PROVIDERS.filter(p => !configs.some(c => c.providerId === p.id)), [configs]);

  const remove = async (providerId: string) => {
    setConfirming(null);
    try {
      await aiApi.deleteConfig(courseId, providerId);
      setConfigs(prev => prev.filter(c => c.providerId !== providerId));
      setNotice({ tone: 'ok', text: t.removed(zh ? providerById(providerId)?.nameZh ?? providerId : providerById(providerId)?.name ?? providerId) });
    } catch {
      setNotice({ tone: 'error', text: t.removeFailed });
    }
  };

  const onSaved = (config: ApiAIConfig, outcome: 'verified' | 'unverified' | 'models') => {
    setConfigs(prev => [...prev.filter(c => c.providerId !== config.providerId), config]);
    setDialog(null);
    setNotice(outcome === 'verified'
      ? { tone: 'ok', text: t.savedVerified }
      : outcome === 'unverified' ? { tone: 'warn', text: t.savedUnverified } : { tone: 'ok', text: t.savedModels });
  };

  const modelSummary = (provider: ProviderMeta, config: ApiAIConfig) => {
    if (provider.models.length === 0 && config.enabledModels.length === 0) return t.webSearch;
    const names = config.enabledModels.slice(0, 2).map(m => (isKnownModel(m) ? modelDisplayName(m, zh ? 'zh' : 'en') : m));
    const more = config.enabledModels.length > 2 ? (zh ? ` 等` : ', …') : '';
    return `${t.modelsOn(config.enabledModels.length)}${names.length ? `${zh ? '：' : ': '}${names.join(zh ? '、' : ', ')}${more}` : ''}`;
  };

  return (
    <div className="space-y-6">
      {notice && (
        <p role="status" className="rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed animate-in fade-in duration-200" style={noticeStyle(TONE[notice.tone])}>
          {notice.text}
        </p>
      )}

      {loadError ? (
        <p className="rounded-xl border px-3.5 py-2.5 text-sm" style={noticeStyle(MORANDI.rose)}>{t.loadFailed}{loadError}</p>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-zinc-100 dark:bg-gray-900" />)}
        </div>
      ) : (
        <>
          <section>
            <h3 className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{t.configured} · {configured.length}</h3>
            {configured.length === 0 ? (
              <p className="rounded-xl border px-4 py-3 text-sm leading-relaxed" style={noticeStyle(MORANDI.ochre)}>{t.none}</p>
            ) : (
              <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-gray-900 dark:border-gray-800 dark:bg-gray-950">
                {configured.map(({ provider, config }) => {
                  const Icon = provider.icon;
                  const name = zh ? provider.nameZh : provider.name;
                  return (
                    <li key={provider.id} className="flex items-center gap-3 px-4 py-3" data-provider={provider.id}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-gray-900 dark:text-zinc-200">
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{name}</span>
                          <span className="shrink-0 text-[0.6875rem] font-medium" style={{ color: config.isVerified ? MORANDI.sage : MORANDI.ochre }}>
                            {config.isVerified ? t.verified : t.unverified}
                          </span>
                        </div>
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {modelSummary(provider, config)}{providerImageModels(provider, catalog).length > 0 ? (zh ? ' · 能画图' : ' · can draw') : ''}{config.apiKeyMasked ? ` · ${config.apiKeyMasked}` : ''}
                        </p>
                      </div>
                      {confirming === provider.id ? (
                        <div className="flex shrink-0 items-center gap-1.5 animate-in fade-in duration-150">
                          <span className="text-xs text-zinc-500">{t.confirmRemove}</span>
                          <button type="button" onClick={() => void remove(provider.id)} className="min-h-9 rounded-lg px-2.5 text-xs font-semibold transition-colors hover:brightness-95" style={noticeStyle(MORANDI.rose)}>
                            {t.remove}
                          </button>
                          <button type="button" onClick={() => setConfirming(null)} className="min-h-9 rounded-lg px-2.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-gray-900">
                            {t.cancel}
                          </button>
                        </div>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDialog({ provider, existing: config })}
                            className="min-h-9 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-gray-700 dark:text-zinc-200 dark:hover:bg-gray-900"
                          >
                            {t.manage}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming(provider.id)}
                            aria-label={`${t.remove} ${name}`}
                            title={t.remove}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-gray-900"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {unconfigured.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{t.add}</h3>
              <div className="flex flex-wrap gap-2">
                {unconfigured.map(provider => {
                  const Icon = provider.icon;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => setDialog({ provider, existing: null })}
                      title={zh ? provider.summaryZh : provider.summaryEn}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition-all hover:border-[#000080]/30 hover:text-[#000080] active:scale-[0.98] dark:border-gray-700 dark:bg-gray-950 dark:text-zinc-200"
                    >
                      <Icon size={13} />
                      {zh ? provider.nameZh : provider.name}
                      <Plus size={12} className="text-zinc-400" />
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {dialog && (
        <ProviderDialog
          key={dialog.provider.id}
          lang={lang}
          courseId={courseId}
          provider={dialog.provider}
          existing={dialog.existing}
          catalog={catalog}
          onClose={() => setDialog(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
};

/** 添加或管理一家服务商：Key、启用的模型；接口地址和自定义模型在「高级」里 */
function ProviderDialog({ lang, courseId, provider, existing, catalog, onClose, onSaved }: {
  lang: Language;
  courseId: string;
  provider: ProviderMeta;
  existing: ApiAIConfig | null;
  catalog: AiModelCatalog | null;
  onClose: () => void;
  onSaved: (config: ApiAIConfig, outcome: 'verified' | 'unverified' | 'models') => void;
}) {
  const zh = lang === 'zh';
  const l: 'zh' | 'en' = zh ? 'zh' : 'en';
  const keyRef = useRef<HTMLInputElement>(null);
  const baseOptions = useMemo(() => providerModelOptions(provider, catalog), [provider, catalog]);
  const imageModels = useMemo(() => providerImageModels(provider, catalog), [provider, catalog]);
  // 生图型号不在勾选里（配好 Key 就能画）：早先 APIKEY.FAN 只画图时存下的生图型号不当成手填的对话模型
  const [extra, setExtra] = useState<string[]>(() => (existing?.enabledModels ?? []).filter(m => !providerModelOptions(provider, null).some(o => o.id === m) && !providerImageModels(provider, null).some(o => o.id === m)));
  const options = useMemo(() => {
    const ids = new Set(baseOptions.map(o => o.id));
    return [...baseOptions, ...extra.filter(m => !ids.has(m)).map(id => ({ id, label: id }))];
  }, [baseOptions, extra]);
  const hasModels = provider.models.length > 0 || options.length > 0;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(existing ? existing.enabledModels : providerModelOptions(provider, catalog).map(o => o.id)));
  // 目录晚到：新加的服务商默认全勾
  const touched = useRef(false);
  useEffect(() => {
    if (!existing && !touched.current) setSelected(new Set(baseOptions.map(o => o.id)));
  }, [baseOptions, existing]);
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState(existing?.endpointUrl ?? '');
  const [advanced, setAdvanced] = useState(Boolean(existing?.endpointUrl));
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { keyRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const toggle = (id: string) => {
    touched.current = true;
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const setAll = (on: boolean) => { touched.current = true; setSelected(on ? new Set(options.map(o => o.id)) : new Set()); };
  const addCustom = () => {
    const id = custom.trim();
    if (!id) return;
    touched.current = true;
    setExtra(prev => (prev.includes(id) ? prev : [...prev, id]));
    setSelected(prev => new Set(prev).add(id));
    setCustom('');
  };

  const chosen = options.map(o => o.id).filter(id => selected.has(id));
  const modelsOnly = Boolean(existing) && !apiKey.trim();
  const needModel = hasModels && chosen.length === 0;
  const canSave = !saving && !needModel && (modelsOnly ? hasModels : apiKey.trim().length > 0);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (modelsOnly && existing) {
        const { config } = await aiApi.updateConfigModels(courseId, provider.id, chosen);
        onSaved(config, 'models');
      } else {
        const { config, verified } = await aiApi.saveConfig(courseId, {
          provider_id: provider.id,
          api_key: apiKey.trim(),
          endpoint_url: endpoint.trim() || undefined,
          enabled_models: hasModels ? chosen : [],
        });
        onSaved(config, verified ? 'verified' : 'unverified');
      }
    } catch (e) {
      setError(`${zh ? '没有保存：' : 'Not saved: '}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const Icon = provider.icon;
  const name = zh ? provider.nameZh : provider.name;
  const endpointPlaceholder = provider.id === 'dmx' || provider.id === 'dmxapi'
    ? 'https://www.dmxapi.cn/v1/chat/completions'
    : provider.id === 'zhipu' ? 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions' : 'https://…/v1/chat/completions';
  const endpointHint = provider.id === 'zhipu'
    ? (zh ? 'Coding Plan 订阅填上面这个地址，走订阅额度；留空用普通 API。' : 'For a Coding Plan subscription use the address above; leave empty for the standard API.')
    : (zh ? '一般留空。DMX 的 COM、SSVIP 令牌才需要填对应站点的地址。' : 'Usually empty. Only DMX COM/SSVIP tokens need their own address.');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-sm animate-in fade-in duration-150" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={name} className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl animate-in zoom-in-95 duration-200 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start gap-3 border-b border-zinc-100 px-5 py-4 dark:border-gray-900">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-gray-900 dark:text-zinc-200"><Icon size={16} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{existing ? (zh ? `管理 ${name}` : `Manage ${name}`) : (zh ? `添加 ${name}` : `Add ${name}`)}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{zh ? provider.summaryZh : provider.summaryEn}</p>
            {(zh ? provider.setupZh : provider.setupEn) && (
              <p className="mt-1.5 rounded-lg border px-2 py-1 text-xs leading-relaxed" style={noticeStyle(MORANDI.dustyBlue)} data-setup-hint>{zh ? provider.setupZh : provider.setupEn}</p>
            )}
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={zh ? '关闭' : 'Close'} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-gray-900">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">API Key</span>
            <input
              ref={keyRef}
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={existing ? (zh ? `已保存（${existing.apiKeyMasked || '••••'}），不换就留空` : `Saved (${existing.apiKeyMasked || '••••'}); leave empty to keep it`) : (zh ? '粘贴 API Key' : 'Paste the API key')}
              autoComplete="off"
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 font-mono text-sm text-zinc-900 outline-none transition-colors focus:border-[#000080]/40 focus:ring-2 focus:ring-[#000080]/10 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-100"
            />
          </label>

          {hasModels ? (
            <fieldset>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <legend className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  {zh ? `启用的模型 · ${chosen.length}/${options.length}` : `Enabled models · ${chosen.length}/${options.length}`}
                </legend>
                <div className="flex gap-1 text-xs">
                  <button type="button" onClick={() => setAll(true)} className="rounded-md px-2 py-1 font-medium text-[#000080] transition-colors hover:bg-[#000080]/[0.06] dark:text-[#93AAFD]">{zh ? '全选' : 'All'}</button>
                  <button type="button" onClick={() => setAll(false)} className="rounded-md px-2 py-1 font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-gray-900">{zh ? '全不选' : 'None'}</button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {options.map(option => {
                  const hint = modelSpeedHint(provider.id, option.id, l);
                  const label = isKnownModel(option.id) ? modelDisplayName(option.id, l) : option.label;
                  return (
                    <label key={option.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-gray-900" title={option.id}>
                      <input type="checkbox" checked={selected.has(option.id)} onChange={() => toggle(option.id)} className="h-4 w-4 shrink-0 accent-[#000080]" />
                      <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-100">{label}</span>
                      {hint && <span className="shrink-0 text-[0.6875rem] text-zinc-400" title={hint.detail}>{hint.text}</span>}
                    </label>
                  );
                })}
              </div>
              {needModel && <p className="mt-1.5 text-xs" style={{ color: MORANDI.rose }}>{zh ? '至少勾一个模型。' : 'Tick at least one model.'}</p>}
            </fieldset>
          ) : (
            <p className="rounded-xl border px-3 py-2 text-xs leading-relaxed" style={noticeStyle(MORANDI.dustyBlue)}>
              {zh ? '保存后，这门课的 AI 助手可以检索网页证据。学生看不到 Key，也不能直接调用。' : 'After saving, the course AI can search the web for evidence. Students never see the key.'}
            </p>
          )}

          {imageModels.length > 0 && (
            <div className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-gray-800" data-image-models>
              <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{zh ? `能画图 · ${imageModels.length}` : `Image models · ${imageModels.length}`}</p>
              <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-100">
                {imageModels.map(m => (isKnownModel(m.id) ? modelDisplayName(m.id, l) : m.label)).join(zh ? '、' : ', ')}
              </p>
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-zinc-400">
                {zh ? '配好 Key 就能画图；用哪个，在「各功能用哪个 AI」的「生成图片」里选。' : 'Ready once the key is saved; choose which one under "Image generation" in Models per feature.'}
              </p>
            </div>
          )}

          <div>
            <button type="button" onClick={() => setAdvanced(v => !v)} aria-expanded={advanced} className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:hover:text-zinc-200">
              <ChevronDown size={14} className={`transition-transform duration-200 ${advanced ? 'rotate-180' : ''}`} />
              {zh ? '高级：接口地址、自定义模型' : 'Advanced: endpoint, custom models'}
            </button>
            {advanced && (
              <div className="mt-3 space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">{zh ? '接口地址（可选）' : 'Endpoint URL (optional)'}</span>
                  <input
                    type="url"
                    value={endpoint}
                    onChange={e => setEndpoint(e.target.value)}
                    placeholder={endpointPlaceholder}
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 font-mono text-xs text-zinc-900 outline-none transition-colors focus:border-[#000080]/40 focus:ring-2 focus:ring-[#000080]/10 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-100"
                  />
                  <span className="mt-1 block text-[0.6875rem] leading-relaxed text-zinc-400">{endpointHint}{existing ? (zh ? ' 改接口地址要连 Key 一起填。' : ' Changing it requires the key too.') : ''}</span>
                </label>
                {hasModels && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={custom}
                      onChange={e => setCustom(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                      aria-label={zh ? '自定义模型 ID' : 'Custom model ID'}
                      placeholder={zh ? '自定义模型 ID，如 glm-5.2' : 'Custom model ID, e.g. glm-5.2'}
                      className="h-9 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 font-mono text-xs text-zinc-900 outline-none focus:border-[#000080]/40 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-100"
                    />
                    <button type="button" onClick={addCustom} disabled={!custom.trim()} className="h-9 rounded-xl border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-gray-700 dark:text-zinc-200">
                      {zh ? '添加' : 'Add'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <p className="rounded-xl border px-3 py-2 text-xs leading-relaxed" style={noticeStyle(MORANDI.rose)}>{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-zinc-100 px-5 py-3.5 dark:border-gray-900">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-10 flex-1 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-gray-700 dark:text-zinc-200 dark:hover:bg-gray-900">
            {zh ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#000080] text-sm font-semibold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving && <RefreshCw size={14} className="animate-spin" />}
            {saving ? (zh ? '保存中…' : 'Saving…') : modelsOnly ? (zh ? '保存勾选' : 'Save models') : (zh ? '验证并保存' : 'Verify & save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AiProvidersPanel;
