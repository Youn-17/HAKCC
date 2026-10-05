import React, { useCallback, useState } from 'react';
import { Loader2, AlertCircle, ListTree, ChevronDown } from 'lucide-react';
import { workspaceAgent as agentApi, type DiscussionDigest as Digest, type DigestScope } from '../services/apiClient';

/**
 * 讨论速览。
 *
 * 学生选一个范围（当前 View / 本组讨论 / 画布上选中的几条），拿回一份
 * 「这里都有什么」的清单：谈了哪些问题、同一问题上有哪几种说法、
 * 哪些已经一致、哪些还没人建构。
 *
 * 它做**定位**不做**综合** —— 界面上刻意没有「结论」这一栏，不同说法一律
 * 并列显示（哪怕互相矛盾）。那句更高一层的新说法要学生自己写。
 */

interface Props {
  courseId: string;
  spaceId?: string;
  /** 当前 View；null 表示整块空间 */
  viewId?: string | null;
  /** 学生在画布上多选的笔记 */
  selectedNoteIds?: string[];
  /** 学生所在小组；没有就不显示「本组讨论」这个范围 */
  groupId?: string | null;
  lang: 'zh' | 'en';
  onLocateNote?: (noteId: string) => void;
  /**
   * 收成一行，点开才展开，展开后最高占屏幕的 45%、里面自己滚动。
   * 放在 AI 助手面板里时用：它原来常开，空着也占一百多像素，生成出结果以后更能把对话区挤没。
   */
  collapsible?: boolean;
}

const T = {
  zh: {
    title: '讨论速览', run: '生成速览', rerun: '重新生成', ready: '已生成', expand: '展开', collapse: '收起',
    hint: '列出这批笔记中已有的内容，便于先掌握全貌再参与讨论',
    scopeView: '当前 View', scopeGroup: '本组讨论', scopeSel: (n: number) => `选中的 ${n} 条`,
    loading: '正在读取这些笔记⋯⋯', fail: '未能生成速览',
    notes: '笔记', authors: '人参与', buildOns: 'Build-on', aiNotes: 'AI 笔记',
    questions: '存在分歧的问题', positions: '同一问题下的不同观点',
    agreements: '已形成共识的', notBuiltOn: '尚无人建构',
    daysOpen: '天', noSel: '请先在画布上选中若干条笔记',
    boundary: '速览只呈现讨论中已有的内容，不代为得出结论 —— 那一步需要你们自己完成。',
  },
  en: {
    title: 'Discussion overview', run: 'Generate', rerun: 'Regenerate', ready: 'Ready', expand: 'Expand', collapse: 'Collapse',
    hint: 'Lists what is in these notes so you can see the whole picture before joining in',
    scopeView: 'Current view', scopeGroup: 'My group', scopeSel: (n: number) => `${n} selected`,
    loading: 'Reading the notes…', fail: 'Could not generate',
    notes: 'notes', authors: 'people', buildOns: 'build-ons', aiNotes: 'AI notes',
    questions: 'Open questions', positions: 'Different views on the same question',
    agreements: 'Agreed so far', notBuiltOn: 'Not built on yet',
    daysOpen: 'd', noSel: 'Select some notes on the canvas first',
    boundary: 'This lists what is here. It does not draw the conclusion — that part is yours.',
  },
};

const DiscussionDigestPanel: React.FC<Props> = ({
  courseId, spaceId, viewId, selectedNoteIds = [], groupId, lang, onLocateNote, collapsible = false,
}) => {
  const t = T[lang];
  const [open, setOpen] = useState(!collapsible);
  const [scope, setScope] = useState<DigestScope>('view');
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { digest: d } = await agentApi.digest(courseId, {
        scope,
        space_id: spaceId,
        view_id: viewId ?? null,
        note_ids: selectedNoteIds,
        group_id: groupId ?? undefined,
      });
      setDigest(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.fail);
    } finally {
      setLoading(false);
    }
  }, [courseId, scope, spaceId, viewId, selectedNoteIds, groupId, t.fail]);

  const scopes: Array<{ id: DigestScope; label: string; disabled?: boolean }> = [
    { id: 'view', label: t.scopeView },
    { id: 'group', label: t.scopeGroup, disabled: !groupId },
    { id: 'selection', label: t.scopeSel(selectedNoteIds.length), disabled: selectedNoteIds.length === 0 },
  ];

  const NoteLink: React.FC<{ ids: string[] }> = ({ ids }) =>
    ids.length === 0 ? null : (
      <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
        {ids.slice(0, 4).map((id, i) => (
          <button
            key={id}
            type="button"
            onClick={() => onLocateNote?.(id)}
            className="rounded border border-stone-200 bg-stone-50 px-1 font-mono text-[0.6875rem] leading-4 text-stone-500 transition hover:border-[#000080]/40 hover:text-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
          >
            {i + 1}
          </button>
        ))}
      </span>
    );

  return (
    <div className={`border-b border-stone-200 dark:border-gray-800 ${collapsible ? '' : 'px-4 py-3'}`}>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          title={open ? t.collapse : t.expand}
          className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-stone-50 dark:hover:bg-gray-900"
        >
          <ListTree size={14} className="text-[#000080] dark:text-blue-300" />
          <span className="text-[0.8125rem] font-semibold text-stone-800 dark:text-gray-200">{t.title}</span>
          {digest && !open && <span className="text-[0.6875rem] text-stone-400 dark:text-gray-500">{t.ready}</span>}
          <ChevronDown size={14} className={`ml-auto text-stone-400 transition-transform dark:text-gray-500 ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <div className="mb-2 flex items-center gap-2">
          <ListTree size={15} className="text-[#000080] dark:text-blue-300" />
          <span className="text-[0.8125rem] font-semibold text-stone-800 dark:text-gray-200">{t.title}</span>
        </div>
      )}
      {open && (
      <div className={collapsible ? 'max-h-[45vh] overflow-y-auto px-4 pb-3' : ''}>
      <p className="mb-2.5 text-[0.6875rem] leading-relaxed text-stone-500 dark:text-gray-400">{t.hint}</p>

      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {scopes.map(s => (
          <button
            key={s.id}
            type="button"
            disabled={s.disabled}
            onClick={() => setScope(s.id)}
            title={s.disabled && s.id === 'selection' ? t.noSel : undefined}
            className={`rounded-lg border px-2.5 py-1 text-[0.6875rem] font-medium transition ${
              scope === s.id
                ? 'border-[#000080] bg-[#000080] text-white'
                : 'border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900'
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1 text-[0.6875rem] font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
        >
          {loading && <Loader2 size={11} className="animate-spin" />}
          {digest ? t.rerun : t.run}
        </button>
      </div>

      {loading && (
        <p className="text-[0.6875rem] text-stone-400 dark:text-gray-500">{t.loading}</p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-[0.6875rem] text-red-600 dark:text-red-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />{error}
        </p>
      )}

      {digest && !loading && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-stone-50 px-3 py-2 text-[0.6875rem] text-stone-600 dark:bg-gray-900 dark:text-gray-400">
            <span><b className="font-mono text-stone-900 dark:text-gray-100">{digest.stats.notes}</b> {t.notes}</span>
            <span><b className="font-mono text-stone-900 dark:text-gray-100">{digest.stats.authors}</b> {t.authors}</span>
            <span><b className="font-mono text-stone-900 dark:text-gray-100">{digest.stats.buildOns}</b> {t.buildOns}</span>
            {digest.stats.aiNotes > 0 && (
              <span><b className="font-mono text-stone-900 dark:text-gray-100">{digest.stats.aiNotes}</b> {t.aiNotes}</span>
            )}
          </div>

          {digest.degraded && (
            <p className="text-[0.6875rem] text-stone-500 dark:text-gray-400">{digest.degraded}</p>
          )}

          {digest.questions.length > 0 && (
            <Block label={t.questions}>
              {digest.questions.map((q, i) => (
                <li key={i} className="text-[0.75rem] leading-relaxed text-stone-700 dark:text-gray-300">
                  {q.text}<NoteLink ids={q.noteIds} />
                </li>
              ))}
            </Block>
          )}

          {digest.positions.length > 0 && (
            <Block label={t.positions}>
              {digest.positions.map((p, i) => (
                <li key={i} className="text-[0.75rem] leading-relaxed">
                  <span className="font-semibold text-stone-800 dark:text-gray-200">{p.topic}</span>
                  <ul className="mt-1 space-y-1 border-l border-stone-200 pl-2.5 dark:border-gray-700">
                    {p.views.map((v, j) => (
                      <li key={j} className="text-stone-600 dark:text-gray-400">
                        <span className="text-stone-500 dark:text-gray-500">{v.who}：</span>
                        {v.summary}<NoteLink ids={v.noteIds} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </Block>
          )}

          {digest.agreements.length > 0 && (
            <Block label={t.agreements}>
              {digest.agreements.map((a, i) => (
                <li key={i} className="text-[0.75rem] leading-relaxed text-stone-700 dark:text-gray-300">
                  {a.text}<NoteLink ids={a.noteIds} />
                </li>
              ))}
            </Block>
          )}

          {digest.notBuiltOn.length > 0 && (
            <Block label={t.notBuiltOn}>
              {digest.notBuiltOn.slice(0, 6).map(n => (
                <li key={n.noteId} className="text-[0.75rem] leading-relaxed">
                  <button
                    type="button"
                    onClick={() => onLocateNote?.(n.noteId)}
                    className="text-left text-stone-700 transition hover:text-[#000080] dark:text-gray-300 dark:hover:text-blue-300"
                  >
                    {n.title || '—'}
                    <span className="ml-1 font-mono text-[0.6875rem] text-stone-400 dark:text-gray-500">
                      {n.author} · {n.daysOpen}{t.daysOpen}
                    </span>
                  </button>
                </li>
              ))}
            </Block>
          )}

          <p className="border-t border-stone-100 pt-2 text-[0.6875rem] leading-relaxed text-stone-400 dark:border-gray-800 dark:text-gray-500">
            {t.boundary}
          </p>
        </div>
      )}
      </div>
      )}
    </div>
  );
};

const Block: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section>
    <h4 className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400 dark:text-gray-500">{label}</h4>
    <ul className="space-y-1.5">{children}</ul>
  </section>
);

export default DiscussionDigestPanel;
