import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import RemixIcon from './RemixIcon';
import { useAuth } from '../contexts/AuthContext';
import type { Language } from '../types';
import {
  ai as aiApi,
  aiModels,
  turingTest,
  type ApiAIConfig,
  type AiModelCatalog,
  type TuringTestActivity,
  type TuringTestActivityInput,
  type TuringTestOverview,
  type TuringTestPersona,
  type TuringTestResults,
  type TuringTestStatus,
  type TuringTestTeacherMessage,
} from '../services/apiClient';

/**
 * 图灵测试 · 设置与主持（教师），挂在知识空间下（/workspace/:courseId/turing-test）。
 *
 * 入口在画布的「探究工具」里，和学生进入活动是同一处（2026-09-11 用户定：不放教师工作台）。
 * 左边是这门课的活动列表；右边是当前活动：草稿时是设置表单，开放后是进入名单和分群预估，
 * 开始后按群显示成员、消息数、判断进度，可以旁观任意一个群，公布答案后是结果。
 * 真名和 AI 身份默认遮住，点「显示身份」才出现——投屏时不会泄底。
 */

interface Props {
  lang: Language;
}

const PERSONA_PRESETS: TuringTestPersona[] = [
  { style: '普通大二学生，对这个话题有点兴趣但没深入想过', quirks: '句子短，偶尔用「感觉」「应该吧」，不太用标点' },
  { style: '爱较真的同学，喜欢反问对方', quirks: '常用「那你觉得」「不一定吧」，句末偶尔加个问号' },
  { style: '话不多的同学，回得慢也回得少', quirks: '经常只回半句，或者一个「嗯」「有道理」' },
];

const STATUS_ZH: Record<TuringTestStatus, string> = {
  draft: '草稿', open: '已开放', chatting: '对话中', voting: '判断中', revealed: '已公布答案', completed: '已结束',
};
const STATUS_EN: Record<TuringTestStatus, string> = {
  draft: 'Draft', open: 'Open', chatting: 'Chatting', voting: 'Judging', revealed: 'Revealed', completed: 'Completed',
};
const STATUS_TONE: Record<TuringTestStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  open: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  chatting: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  voting: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  revealed: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  completed: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const NEXT_STEP: Record<TuringTestStatus, { to: TuringTestStatus; zh: string; en: string; icon: string } | null> = {
  draft: { to: 'open', zh: '开放给学生', en: 'Open to students', icon: 'door-open-line' },
  open: { to: 'chatting', zh: '分群并开始对话', en: 'Group and start', icon: 'play-line' },
  chatting: { to: 'voting', zh: '结束对话，开始判断', en: 'End chat, start judging', icon: 'stop-line' },
  voting: { to: 'revealed', zh: '公布答案', en: 'Reveal', icon: 'eye-line' },
  revealed: { to: 'completed', zh: '结束活动', en: 'Finish', icon: 'flag-line' },
  completed: null,
};

const inputCls = 'min-h-[44px] w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition-colors focus:border-[#000080]/40 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
const labelCls = 'mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400';
const hintCls = 'mt-1 text-[0.6875rem] leading-relaxed text-zinc-400';
const primaryBtn = 'flex min-h-[44px] items-center gap-2 rounded-xl bg-[#000080] px-4 text-sm font-semibold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-40 dark:bg-[#4169E1] dark:hover:bg-[#4169E1]/90';
const ghostBtn = 'flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 px-4 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
const tile = 'rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800';

/** 和服务端 splitIntoRooms 同一个算法，开始前给教师一个预估 */
function plannedRooms(students: number, roomSize: number): number {
  if (students < 2) return 0;
  const size = Math.max(2, roomSize);
  return Math.max(1, Math.min(Math.round(students / size), Math.floor(students / 2)));
}

// ── 设置表单 ─────────────────────────────────────────────────────────

const ActivityForm: React.FC<{
  zh: boolean;
  initial?: TuringTestActivity | null;
  configs: ApiAIConfig[];
  catalog: AiModelCatalog | null;
  saving: boolean;
  onSave: (body: TuringTestActivityInput) => Promise<void>;
  onCancel?: () => void;
}> = ({ zh, initial, configs, catalog, saving, onSave, onCancel }) => {
  const usable = useMemo(
    () => configs.filter(c => c.providerId !== 'tavily' && (c.isVerified || c.enabledModels.length > 0)),
    [configs],
  );
  const [title, setTitle] = useState(initial?.title ?? '');
  const [topic, setTopic] = useState(initial?.topic ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [provider, setProvider] = useState(initial ? (initial.ai_provider ?? '') : 'deepseek');
  const [model, setModel] = useState(initial ? (initial.ai_model ?? '') : 'deepseek-flash');
  const [minutes, setMinutes] = useState(initial?.chat_minutes ?? 5);
  const [roomSize, setRoomSize] = useState(initial?.room_size ?? 6);
  const [aiPerRoom, setAiPerRoom] = useState(initial?.ai_per_room ?? 1);
  const [disclose, setDisclose] = useState(initial?.disclose_ai_count ?? true);
  const [persona, setPersona] = useState<TuringTestPersona>(initial?.config?.persona ?? PERSONA_PRESETS[0]);
  const [error, setError] = useState('');

  // 这门课没配 DeepSeek 时，默认值退回「自动」，免得下拉框显示的和实际存的不一致
  useEffect(() => {
    if (usable.length > 0 && provider && !usable.some(c => c.providerId === provider)) {
      setProvider('');
      setModel('');
    }
  }, [usable, provider]);

  const modelsFor = (pid: string): Array<{ id: string; label: string }> => {
    const cfg = usable.find(c => c.providerId === pid);
    const infos = pid === 'dmx' || pid === 'dmxapi'
      ? [...(catalog?.dmx.text ?? []), ...(catalog?.dmx.vision ?? [])]
      : (catalog?.native[pid] ?? []);
    return (cfg?.enabledModels ?? []).map(id => ({ id, label: infos.find(m => m.id === id)?.label ?? id }));
  };
  const presetIdx = PERSONA_PRESETS.findIndex(p => p.style === persona.style && p.quirks === persona.quirks);

  const submit = async () => {
    if (!title.trim() || !topic.trim()) {
      setError(zh ? '标题和话题不能为空' : 'Title and topic are required');
      return;
    }
    setError('');
    await onSave({
      title: title.trim(),
      topic: topic.trim(),
      instructions: instructions.trim(),
      ai_provider: provider || null,
      ai_model: provider ? (model || null) : null,
      chat_minutes: minutes,
      room_size: roomSize,
      ai_per_room: aiPerRoom,
      disclose_ai_count: disclose,
      persona,
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>{zh ? '活动标题' : 'Title'}</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder={zh ? '例如：第三周图灵测试' : 'e.g. Week 3 Turing test'} maxLength={120} />
        </div>
        <div>
          <label className={labelCls}>{zh ? '群聊话题' : 'Topic'}</label>
          <input value={topic} onChange={e => setTopic(e.target.value)} className={inputCls} placeholder={zh ? '例如：AI 会不会取代教师' : 'e.g. Will AI replace teachers?'} maxLength={300} />
        </div>
      </div>

      <div>
        <label className={labelCls}>{zh ? '给学生的任务说明' : 'Instructions for students'}</label>
        <textarea
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          rows={6}
          className={`${inputCls} py-2 leading-relaxed`}
          placeholder={zh ? '留空使用默认说明：活动目标、操作方式、只在群里交流的规则、讨论问题、至少两条线索的要求' : 'Leave blank for the default: goal, procedure, chat-only rule, discussion questions, two-clue requirement'}
          maxLength={4000}
        />
      </div>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{zh ? '谁来扮演 AI 同学' : 'The AI classmate'}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{zh ? '供应商' : 'Provider'}</label>
            <select value={provider} onChange={e => { setProvider(e.target.value); setModel(''); }} className={inputCls}>
              <option value="">{zh ? '自动（DeepSeek Flash 优先）' : 'Auto (DeepSeek Flash first)'}</option>
              {usable.map(c => <option key={c.providerId} value={c.providerId}>{c.providerId}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>{zh ? '型号' : 'Model'}</label>
            <select value={model} onChange={e => setModel(e.target.value)} className={inputCls} disabled={!provider}>
              <option value="">{zh ? '该供应商默认' : 'Provider default'}</option>
              {provider && modelsFor(provider).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <p className={hintCls}>
          {zh
            ? '默认 DeepSeek Flash，调用时关闭思考模式。回复整段出现、按人读和打字的时间延后 3 到 40 秒，一次一两句。'
            : 'Default DeepSeek Flash with thinking off. Replies appear whole, delayed 3 to 40 s by reading and typing time, one or two sentences each.'}
        </p>
        <div>
          <label className={labelCls}>{zh ? 'AI 的人设（多个 AI 时轮流用下面三种）' : 'Persona (several AIs rotate through the presets)'}</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {PERSONA_PRESETS.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPersona(p)}
                className={`rounded-xl border p-3 text-left text-xs leading-relaxed transition-colors ${presetIdx === i ? 'border-[#000080] bg-[#000080]/[0.04] dark:border-[#4169E1] dark:bg-[#4169E1]/10' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700'}`}
              >
                <div className="font-medium text-zinc-800 dark:text-zinc-100">{p.style}</div>
                <div className="mt-1 text-zinc-500">{p.quirks}</div>
              </button>
            ))}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input value={persona.style} onChange={e => setPersona({ ...persona, style: e.target.value })} className={inputCls} placeholder={zh ? '人设（可改）' : 'Persona (editable)'} maxLength={200} />
            <input value={persona.quirks} onChange={e => setPersona({ ...persona, quirks: e.target.value })} className={inputCls} placeholder={zh ? '说话习惯（可改）' : 'Speech habits (editable)'} maxLength={200} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{zh ? '怎么分群、聊多久' : 'Groups and timing'}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>{zh ? '对话时长（分钟）' : 'Chat minutes'}</label>
            <input type="number" min={2} max={30} value={minutes} onChange={e => setMinutes(Number(e.target.value) || 5)} className={inputCls} />
            <p className={hintCls}>{zh ? '图灵 1950 年的设想是提问 5 分钟后作判断' : 'Turing (1950) imagined judging after five minutes of questioning'}</p>
          </div>
          <div>
            <label className={labelCls}>{zh ? '每群学生数' : 'Students per group'}</label>
            <input type="number" min={2} max={12} value={roomSize} onChange={e => setRoomSize(Number(e.target.value) || 6)} className={inputCls} />
            <p className={hintCls}>{zh ? '进来的人数除以它就是群数；群太大每个人认不过来' : 'Joined students divided by this gives the number of groups'}</p>
          </div>
          <div>
            <label className={labelCls}>{zh ? '每群 AI 数' : 'AI per group'}</label>
            <select value={aiPerRoom} onChange={e => setAiPerRoom(Number(e.target.value))} className={inputCls}>
              {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <div>
            <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{zh ? '告诉学生群里有几个 AI' : 'Tell students how many AIs are in their group'}</div>
            <p className={hintCls}>
              {zh
                ? '公开时学生知道要找几个，和常见的图灵测试做法一致；不公开更难，也更容易把真人当成 AI。'
                : 'When shown, students know how many to find, as in the usual Turing test; hiding it is harder and makes accusing humans more likely.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={disclose}
            onClick={() => setDisclose(v => !v)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${disclose ? 'bg-[#000080] dark:bg-[#4169E1]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${disclose ? 'left-[1.375rem]' : 'left-0.5'}`} />
          </button>
        </div>
      </fieldset>

      {error && <p className="text-xs text-rose-500">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className={ghostBtn}>{zh ? '取消' : 'Cancel'}</button>}
        <button type="button" onClick={() => void submit()} disabled={saving} className={primaryBtn}>
          <RemixIcon name={saving ? 'loader-4-line' : 'save-line'} size={15} className={saving ? 'animate-spin' : ''} />
          {initial ? (zh ? '保存设置' : 'Save') : (zh ? '创建草稿' : 'Create draft')}
        </button>
      </div>
    </div>
  );
};

// ── 页面 ─────────────────────────────────────────────────────────────

const TuringTestManage: React.FC<Props> = ({ lang }) => {
  const zh = lang === 'zh';
  const { courseId = '' } = useParams<{ courseId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  /** 后端随列表带回的「是不是这门课的主持方」。null = 还没拿到，或旧版后端不带 */
  const [host, setHost] = useState<boolean | null>(null);
  // 按课内身份：凭学生验证码入课的教师账号不是主持方，这一页的接口对他全是 403，送回知识空间
  const isTeacher = host ?? (user?.role === 'teacher' || user?.role === 'admin');

  const [activities, setActivities] = useState<TuringTestActivity[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('activity'));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overview, setOverview] = useState<TuringTestOverview | null>(null);
  const [results, setResults] = useState<TuringTestResults | null>(null);
  const [configs, setConfigs] = useState<ApiAIConfig[]>([]);
  const [catalog, setCatalog] = useState<AiModelCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [showIdentity, setShowIdentity] = useState(false);
  const [watchRoomId, setWatchRoomId] = useState<string | null>(null);
  const [watchMessages, setWatchMessages] = useState<TuringTestTeacherMessage[]>([]);

  useEffect(() => {
    if (user && !isTeacher && courseId) navigate(`/workspace/${courseId}`, { replace: true });
  }, [user, isTeacher, courseId, navigate]);

  const loadList = useCallback(async () => {
    if (!courseId) return;
    try {
      const { activities: list, host: isHost } = await turingTest.list(courseId);
      if (typeof isHost === 'boolean') setHost(isHost);
      setActivities(list);
      setSelectedId(prev => (prev && list.some(a => a.id === prev) ? prev : (list[0]?.id ?? null)));
    } catch {
      // 保留旧列表
    } finally {
      setListLoaded(true);
    }
  }, [courseId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!courseId) return;
    aiApi.listConfigs(courseId).then(r => setConfigs(r.configs)).catch(() => setConfigs([]));
    aiModels.catalog().then(setCatalog).catch(() => {});
  }, [courseId]);

  const selected = useMemo(() => activities.find(a => a.id === selectedId) ?? null, [activities, selectedId]);
  const status = selected?.status;

  const loadOverview = useCallback(async () => {
    if (!courseId || !selectedId) {
      setOverview(null);
      return;
    }
    try {
      setOverview(await turingTest.overview(courseId, selectedId));
    } catch {
      // 下一轮再试
    }
  }, [courseId, selectedId]);

  useEffect(() => {
    setOverview(null);
    setResults(null);
    setWatchRoomId(null);
    setShowIdentity(false);
    void loadOverview();
  }, [loadOverview]);

  // 开放到公布答案之间每 4 秒刷新：学生陆续进来、消息在涨、判断在交
  useEffect(() => {
    if (!status || status === 'draft' || status === 'completed') return;
    const t = setInterval(() => {
      void loadOverview();
      void loadList();
    }, 4000);
    return () => clearInterval(t);
  }, [status, loadOverview, loadList]);

  const judgmentCount = overview?.judgments ?? 0;
  useEffect(() => {
    if (!courseId || !selectedId || !status) return;
    if (status === 'voting' || status === 'revealed' || status === 'completed') {
      turingTest.results(courseId, selectedId).then(setResults).catch(() => setResults(null));
    } else {
      setResults(null);
    }
  }, [courseId, selectedId, status, judgmentCount]);

  useEffect(() => {
    if (!courseId || !selectedId || !watchRoomId) {
      setWatchMessages([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      turingTest.roomMessages(courseId, selectedId, watchRoomId)
        .then(r => { if (!cancelled) setWatchMessages(r.messages); })
        .catch(() => {});
    };
    load();
    const t = status === 'chatting' ? setInterval(load, 3000) : null;
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [courseId, selectedId, watchRoomId, status]);

  const create = async (body: TuringTestActivityInput) => {
    setSaving(true);
    setNotice('');
    try {
      const { activity } = await turingTest.create(courseId, body);
      setCreating(false);
      setSelectedId(activity.id);
      await loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : (zh ? '创建失败' : 'Create failed'));
    } finally {
      setSaving(false);
    }
  };

  const update = async (body: TuringTestActivityInput) => {
    if (!selectedId) return;
    setSaving(true);
    setNotice('');
    try {
      await turingTest.update(courseId, selectedId, body);
      setEditing(false);
      await loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : (zh ? '保存失败' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const advance = async () => {
    if (!selected) return;
    const step = NEXT_STEP[selected.status];
    if (!step) return;
    if (step.to === 'chatting') {
      const n = overview?.joined.length ?? 0;
      if (n < 2) {
        setNotice(zh ? '至少要 2 名学生进入才能开始' : 'At least 2 students must join first');
        return;
      }
      const rooms = plannedRooms(n, selected.room_size);
      const ok = window.confirm(zh
        ? `现在有 ${n} 名学生进入，会分成 ${rooms} 个群，每群 ${selected.ai_per_room} 个 AI，对话 ${selected.chat_minutes} 分钟。开始后不能再进入。确定开始？`
        : `${n} students joined: ${rooms} groups with ${selected.ai_per_room} AI each, ${selected.chat_minutes} minutes. Nobody can join after start. Start?`);
      if (!ok) return;
    }
    if (step.to === 'voting' && !window.confirm(zh ? '结束对话后群里不能再发消息，学生开始判断。确定？' : 'Chat closes and students start judging. Continue?')) return;
    if (step.to === 'revealed' && !window.confirm(zh ? '公布答案后学生会看到群里谁是 AI，判断不能再改。确定？' : 'Students will see who was AI and judgments lock. Continue?')) return;
    setBusy(true);
    setNotice('');
    try {
      const r = await turingTest.updateStatus(courseId, selected.id, step.to);
      if (r.started) {
        setNotice(zh
          ? `已分成 ${r.started.rooms} 个群：${r.started.students} 名学生，${r.started.ais} 个 AI`
          : `${r.started.rooms} groups: ${r.started.students} students, ${r.started.ais} AI`);
      }
      await loadList();
      await loadOverview();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : (zh ? '操作失败' : 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    if (!selected || selected.status !== 'open') return;
    setBusy(true);
    try {
      await turingTest.updateStatus(courseId, selected.id, 'draft');
      await loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!window.confirm(zh ? `删除「${selected.title}」及其全部群聊、判断记录？` : `Delete "${selected.title}" with all chats and judgments?`)) return;
    setBusy(true);
    try {
      await turingTest.remove(courseId, selected.id);
      setSelectedId(null);
      await loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const step = selected ? NEXT_STEP[selected.status] : null;
  const revealed = status === 'revealed' || status === 'completed';
  const showAiTag = showIdentity || revealed;
  const hasRooms = (overview?.rooms.length ?? 0) > 0;
  const watchedRoom = overview?.rooms.find(r => r.id === watchRoomId) ?? null;
  const modelLabel = selected
    ? (selected.ai_provider ? `${selected.ai_provider} / ${selected.ai_model || (zh ? '默认型号' : 'default')}` : (zh ? '自动（DeepSeek Flash 优先）' : 'auto (DeepSeek Flash first)'))
    : '';

  const identityOf = (m: { is_ai: boolean; name?: string | null }) => {
    if (m.is_ai) return showAiTag ? 'AI' : null;
    return showIdentity ? (m.name ?? '') : null;
  };

  return (
    <div className="min-h-[100dvh] bg-zinc-50 dark:bg-gray-950">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => navigate(`/workspace/${courseId}`)}
              className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label={zh ? '返回知识空间' : 'Back to workspace'}
            >
              <RemixIcon name="arrow-left-line" size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{zh ? '图灵测试 · 设置与主持' : 'Turing Test · setup and host'}</h1>
              <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-zinc-500">
                {zh
                  ? '学生进入后分成若干个匿名群聊，每群混入你设定数量的 AI 同学，所有人用随机化名。限时聊完，每个人对群里其他每一位判「人」或「AI」；公布答案后各自把群聊发布成笔记继续讨论。'
                  : 'Students are split into anonymous group chats with AI classmates mixed in, everyone under a random nickname. After the chat each student marks every other member as human or AI; after the reveal they publish the chat as a note.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => { setCreating(true); setEditing(false); }} className={primaryBtn}>
            <RemixIcon name="add-line" size={15} />
            {zh ? '新建活动' : 'New activity'}
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="space-y-2">
            {!listLoaded && <div className="h-20 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />}
            {listLoaded && activities.length === 0 && !creating && (
              <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-xs leading-relaxed text-zinc-400 dark:border-zinc-800">
                {zh ? '这门课还没有活动。新建一个，设置好再开放给学生。' : 'No activities yet. Create one, configure it, then open it to students.'}
              </p>
            )}
            {activities.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => { setSelectedId(a.id); setCreating(false); setEditing(false); }}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedId === a.id && !creating ? 'border-[#000080] bg-[#000080]/[0.04] dark:border-[#4169E1] dark:bg-[#4169E1]/10' : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{a.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${STATUS_TONE[a.status]}`}>{zh ? STATUS_ZH[a.status] : STATUS_EN[a.status]}</span>
                </div>
                <div className="mt-1 truncate text-xs text-zinc-500">{a.topic}</div>
                <div className="mt-1 text-[0.6875rem] text-zinc-400">
                  {zh ? `${a.joined_count ?? 0} 人进入 · ${a.judgment_count ?? 0} 人判断` : `${a.joined_count ?? 0} joined · ${a.judgment_count ?? 0} judged`}
                </div>
              </button>
            ))}
          </aside>

          <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            {creating ? (
              <>
                <h2 className="mb-5 text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{zh ? '新建活动' : 'New activity'}</h2>
                <ActivityForm zh={zh} configs={configs} catalog={catalog} saving={saving} onSave={create} onCancel={() => setCreating(false)} />
                {notice && <p className="mt-3 text-xs text-rose-500">{notice}</p>}
              </>
            ) : !selected ? (
              <p className="text-sm text-zinc-500">{zh ? '选择左侧的活动，或新建一个。' : 'Pick an activity on the left or create one.'}</p>
            ) : editing ? (
              <>
                <h2 className="mb-5 text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{zh ? '修改设置' : 'Edit settings'}</h2>
                <ActivityForm zh={zh} initial={selected} configs={configs} catalog={catalog} saving={saving} onSave={update} onCancel={() => setEditing(false)} />
                {notice && <p className="mt-3 text-xs text-rose-500">{notice}</p>}
              </>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{selected.title}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${STATUS_TONE[selected.status]}`}>{zh ? STATUS_ZH[selected.status] : STATUS_EN[selected.status]}</span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">{selected.topic}</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                      {zh
                        ? `模型：${modelLabel}，不开思考 · ${selected.chat_minutes} 分钟 · 每群约 ${selected.room_size} 名学生 + ${selected.ai_per_room} 个 AI · ${selected.disclose_ai_count ? '告诉学生 AI 数量' : '不告诉学生 AI 数量'}`
                        : `Model: ${modelLabel}, thinking off · ${selected.chat_minutes} min · about ${selected.room_size} students + ${selected.ai_per_room} AI per group · AI count ${selected.disclose_ai_count ? 'shown' : 'hidden'}`}
                      {selected.status === 'chatting' && selected.ends_at && (zh ? ` · ${new Date(selected.ends_at).toLocaleTimeString()} 结束` : ` · ends ${new Date(selected.ends_at).toLocaleTimeString()}`)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(selected.status === 'draft' || selected.status === 'open') && (
                      <button type="button" onClick={() => setEditing(true)} className={ghostBtn}>
                        <RemixIcon name="edit-line" size={14} />{zh ? '设置' : 'Edit'}
                      </button>
                    )}
                    {selected.status === 'open' && (
                      <button type="button" onClick={() => void unpublish()} disabled={busy} className={ghostBtn}>
                        <RemixIcon name="eye-off-line" size={14} />{zh ? '收回' : 'Unpublish'}
                      </button>
                    )}
                    {hasRooms && (
                      <button type="button" onClick={() => setShowIdentity(v => !v)} aria-pressed={showIdentity} className={ghostBtn}>
                        <RemixIcon name={showIdentity ? 'eye-off-line' : 'eye-line'} size={14} />
                        {showIdentity ? (zh ? '遮住身份' : 'Hide identities') : (zh ? '显示身份' : 'Show identities')}
                      </button>
                    )}
                    {step && (
                      <button type="button" onClick={() => void advance()} disabled={busy} className={primaryBtn}>
                        <RemixIcon name={busy ? 'loader-4-line' : step.icon} size={15} className={busy ? 'animate-spin' : ''} />
                        {zh ? step.zh : step.en}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void remove()}
                      disabled={busy}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                      title={zh ? '删除' : 'Delete'}
                      aria-label={zh ? '删除活动' : 'Delete activity'}
                    >
                      <RemixIcon name="delete-bin-line" size={16} />
                    </button>
                  </div>
                </div>

                {notice && <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{notice}</p>}

                {selected.status === 'draft' && (
                  <p className="max-w-[65ch] text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {zh
                      ? '草稿对学生不可见。检查话题、模型和分群设置后点「开放给学生」，学生在画布的探究工具里就能进入。'
                      : 'Drafts are invisible to students. Check the topic, model and grouping, then open it; students enter from Inquiry tools on the canvas.'}
                  </p>
                )}

                {overview && selected.status === 'open' && (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className={tile}>
                        <div className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{overview.joined.length}</div>
                        <div className="text-[0.6875rem] text-zinc-500">{zh ? '已进入的学生' : 'Students joined'}</div>
                      </div>
                      <div className={tile}>
                        <div className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{plannedRooms(overview.joined.length, selected.room_size)}</div>
                        <div className="text-[0.6875rem] text-zinc-500">{zh ? '开始后的群数' : 'Groups on start'}</div>
                      </div>
                      <div className={tile}>
                        <div className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{plannedRooms(overview.joined.length, selected.room_size) * selected.ai_per_room}</div>
                        <div className="text-[0.6875rem] text-zinc-500">{zh ? 'AI 同学' : 'AI classmates'}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {overview.joined.map(j => (
                        <span key={j.user_id} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{j.name}</span>
                      ))}
                      {overview.joined.length === 0 && <span className="text-xs text-zinc-400">{zh ? '还没有人进来' : 'Nobody yet'}</span>}
                    </div>
                  </div>
                )}

                {overview && hasRooms && (
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{zh ? '各群情况' : 'Groups'}</h3>
                      <span className="text-xs text-zinc-400">
                        {zh ? `${overview.judgments} 人已判断 · ${overview.published} 人已发布笔记` : `${overview.judgments} judged · ${overview.published} published`}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {overview.rooms.map(room => {
                        const humans = room.members.filter(m => !m.is_ai);
                        const judgedCount = humans.filter(m => m.judged).length;
                        return (
                          <div key={room.id} className={`rounded-xl border p-4 transition-colors ${watchRoomId === room.id ? 'border-[#000080] dark:border-[#4169E1]' : 'border-zinc-200 dark:border-zinc-800'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{zh ? `第 ${room.room_no} 群` : `Group ${room.room_no}`}</span>
                              <span className="text-[0.6875rem] text-zinc-400">
                                {zh ? `真人 ${room.messages.human} 条 · AI ${room.messages.ai} 条` : `${room.messages.human} human · ${room.messages.ai} AI msgs`}
                              </span>
                            </div>
                            <ul className="mt-2 flex flex-wrap gap-1.5">
                              {room.members.map(m => {
                                const identity = identityOf(m);
                                return (
                                  <li key={m.id} className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                    {m.alias}
                                    {identity && <span className={m.is_ai ? 'font-semibold text-zinc-900 dark:text-zinc-50' : 'text-zinc-500'}>· {identity}</span>}
                                    {showIdentity && m.judged && <RemixIcon name="check-line" size={12} className="text-emerald-600" />}
                                  </li>
                                );
                              })}
                            </ul>
                            <div className="mt-3 flex items-center justify-between">
                              <span className="text-[0.6875rem] text-zinc-400">{zh ? `已判断 ${judgedCount}/${humans.length}` : `${judgedCount}/${humans.length} judged`}</span>
                              <button
                                type="button"
                                onClick={() => setWatchRoomId(watchRoomId === room.id ? null : room.id)}
                                className="min-h-[36px] rounded-lg px-2 text-xs font-medium text-[#000080] transition-colors hover:bg-[#000080]/[0.05] dark:text-[#93AAFD]"
                              >
                                {watchRoomId === room.id ? (zh ? '停止旁观' : 'Stop watching') : (zh ? '旁观' : 'Watch')}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {watchedRoom && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{zh ? `旁观 · 第 ${watchedRoom.room_no} 群` : `Watching group ${watchedRoom.room_no}`}</span>
                      {status === 'chatting' && <span className="text-[0.6875rem] text-zinc-400">{zh ? '每 3 秒刷新' : 'refreshes every 3 s'}</span>}
                    </div>
                    <div className="max-h-[28rem] space-y-2 overflow-y-auto px-4 py-3">
                      {watchMessages.length === 0 && <p className="py-6 text-center text-xs text-zinc-400">{zh ? '这个群还没有消息' : 'No messages yet'}</p>}
                      {watchMessages.map(m => {
                        const identity = identityOf(m);
                        return (
                          <div key={m.id} className="text-sm leading-relaxed">
                            <span className="mr-2 text-[0.6875rem] text-zinc-400">{new Date(m.at).toLocaleTimeString()}</span>
                            <span className="font-medium text-zinc-800 dark:text-zinc-100">{m.alias}</span>
                            {identity && <span className="ml-1 text-xs text-zinc-500">（{identity}）</span>}
                            <span className="text-zinc-700 dark:text-zinc-300">：{m.content}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {results && (status === 'voting' || revealed) && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{revealed ? (zh ? '结果' : 'Results') : (zh ? '判断进行中（学生看不到）' : 'Judging in progress (hidden from students)')}</h3>
                    <div className="grid gap-3 sm:grid-cols-4">
                      {[
                        { label: zh ? '全班判断准确率' : 'Class accuracy', value: results.class.accuracy },
                        { label: zh ? 'AI 被认出的比例' : 'AI identified', value: results.class.ai_identified_rate },
                        { label: zh ? '真人被当成 AI' : 'Humans taken for AI', value: results.class.human_mistaken_rate },
                      ].map(s => (
                        <div key={s.label} className={tile}>
                          <div className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{s.value === null ? '—' : `${s.value}%`}</div>
                          <div className="text-[0.6875rem] text-zinc-500">{s.label}</div>
                        </div>
                      ))}
                      <div className={tile}>
                        <div className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{results.class.judgments}/{results.class.students}</div>
                        <div className="text-[0.6875rem] text-zinc-500">{zh ? '已提交判断' : 'Judgments submitted'}</div>
                      </div>
                    </div>
                    <p className={hintCls}>
                      {zh
                        ? `图灵 1950 年预言：5 分钟提问之后，普通提问者认对的机会不超过 ${results.turing_line}%。`
                        : `Turing (1950) predicted an average interrogator would have no more than a ${results.turing_line}% chance of the right identification after five minutes.`}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {results.rooms.map(room => (
                        <div key={room.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                          <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{zh ? `第 ${room.room_no} 群` : `Group ${room.room_no}`}</div>
                          <ul className="mt-2 space-y-1">
                            {room.members.map(m => {
                              const identity = identityOf(m);
                              return (
                                <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                                  <span className="text-zinc-700 dark:text-zinc-200">
                                    {m.alias}
                                    {identity && <span className="ml-1 text-xs text-zinc-500">（{identity}）</span>}
                                  </span>
                                  <span className="text-xs text-zinc-500">
                                    {m.judged_by === 0 ? (zh ? '无人判断' : 'no judges') : (zh ? `${m.voted_ai}/${m.judged_by} 认为是 AI` : `${m.voted_ai}/${m.judged_by} said AI`)}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {([
                        [zh ? '认出了全部 AI 的人的线索' : 'Clues from those who found every AI', results.clues_wall.found],
                        [zh ? '没认全的人的线索' : 'Clues from those who missed an AI', results.clues_wall.missed],
                      ] as Array<[string, Array<{ clue: string; confidence: number }>]>).map(([title, list]) => (
                        <div key={title} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h4>
                          <ul className="mt-2 space-y-1.5">
                            {list.slice(0, 20).map((c, i) => (
                              <li key={i} className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                                · {c.clue} <span className="text-[0.6875rem] text-zinc-400">({c.confidence}/5)</span>
                              </li>
                            ))}
                            {list.length === 0 && <li className="text-xs text-zinc-400">{zh ? '暂无' : 'None'}</li>}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default TuringTestManage;
