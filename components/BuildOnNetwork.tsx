import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Crosshair } from 'lucide-react';
import type { Edge, Note } from '../types';
import { RELATION_COLORS } from './relationColors';

/**
 * Build-on 网络。
 *
 * 画布已经能看到笔记和连线，所以这个面板不重复那件事。它回答的是
 * 学生自己看不见的一个问题：**我在这场讨论里处在什么位置**。
 *
 * 两点和画布不同：
 *   1. 力导向重新布局。手摆的位置会掩盖真实结构——两条紧挨着的笔记
 *      可能毫无关系，真正相连的却被拖到了两端。
 *   2. 以「我」为中心作答：我的观点被接过几次、我接过别人几次、
 *      哪几条至今没人回应。
 *
 * 刻意不做排行榜。知识建构讲的是集体认知责任，把学生按贡献排序会把人
 * 推向刷数量的浅层发帖；所以这里只给自己的数字加一个组内均值作参照，
 * 不出现任何按人排序的名单。
 */

interface Props {
  notes: Note[];
  edges: Edge[];
  currentUserId?: string;
  lang: 'zh' | 'en';
  onLocateNote?: (noteId: string) => void;
  onClose: () => void;
}

type Placed = { id: string; x: number; y: number; note: Note };

const W = 760;
const H = 520;

/** 极简力导向：斥力 + 弹簧。节点量在百级，够用且不引依赖。 */
function layout(nodes: Note[], links: Edge[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const n = Math.max(nodes.length, 1);
  nodes.forEach((note, i) => {
    // 从圆周起步而不是随机：同一批数据每次打开形状一致，学生不会以为图变了
    const angle = (i / n) * Math.PI * 2;
    pos.set(note.id, { x: Math.cos(angle) * 180, y: Math.sin(angle) * 180, vx: 0, vy: 0 });
  });

  const ids = new Set(nodes.map(x => x.id));
  const valid = links.filter(l => ids.has(l.source) && ids.has(l.target));

  for (let step = 0; step < 260; step++) {
    const cooling = 1 - step / 260;
    for (let i = 0; i < nodes.length; i++) {
      const a = pos.get(nodes[i].id)!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = pos.get(nodes[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; d2 = 4; }
        const force = 5200 / d2;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * force; a.vy += (dy / d) * force;
        b.vx -= (dx / d) * force; b.vy -= (dy / d) * force;
      }
      a.vx -= a.x * 0.012;
      a.vy -= a.y * 0.012;
    }
    for (const link of valid) {
      const a = pos.get(link.source)!;
      const b = pos.get(link.target)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = (d - 120) * 0.045;
      a.vx += (dx / d) * pull; a.vy += (dy / d) * pull;
      b.vx -= (dx / d) * pull; b.vy -= (dy / d) * pull;
    }
    for (const p of pos.values()) {
      p.x += p.vx * cooling * 0.5;
      p.y += p.vy * cooling * 0.5;
      p.vx *= 0.82;
      p.vy *= 0.82;
    }
  }
  return new Map([...pos].map(([id, p]) => [id, { x: p.x, y: p.y }]));
}

const BuildOnNetwork: React.FC<Props> = ({ notes, edges, currentUserId, lang, onLocateNote, onClose }) => {
  const zh = lang === 'zh';
  const [hovered, setHovered] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const graph = useMemo(() => {
    const visible = notes.filter(note => note.type !== 'attachment' && note.type !== 'drawing');
    const raw = layout(visible, edges);
    const xs = [...raw.values()].map(p => p.x);
    const ys = [...raw.values()].map(p => p.y);
    const minX = Math.min(...xs, 0); const maxX = Math.max(...xs, 0);
    const minY = Math.min(...ys, 0); const maxY = Math.max(...ys, 0);
    const scale = Math.min((W - 80) / Math.max(maxX - minX, 1), (H - 80) / Math.max(maxY - minY, 1), 1.6);
    const placed: Placed[] = visible.map(note => {
      const p = raw.get(note.id)!;
      return {
        id: note.id,
        x: (p.x - (minX + maxX) / 2) * scale + W / 2,
        y: (p.y - (minY + maxY) / 2) * scale + H / 2,
        note,
      };
    });
    const byId = new Map(placed.map(p => [p.id, p]));
    const ids = new Set(placed.map(p => p.id));
    return { placed, byId, links: edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
  }, [notes, edges]);

  const isMine = (note?: Note) => Boolean(note && currentUserId && note.authorId === currentUserId);

  /**
   * source 是「接的人」，target 是「被接的那条观点」。
   * 方向搞反的话「我被接了几次」和「我接了几次」会整个对调。
   */
  const stats = useMemo(() => {
    const mine = graph.placed.filter(p => isMine(p.note));
    const mineIds = new Set(mine.map(p => p.id));
    const receivedBy = new Map<string, number>();
    let given = 0;
    const partners = new Set<string>();

    for (const link of graph.links) {
      const from = graph.byId.get(link.source)?.note;
      const to = graph.byId.get(link.target)?.note;
      if (!from || !to) continue;
      if (mineIds.has(link.target) && !isMine(from)) {
        receivedBy.set(link.target, (receivedBy.get(link.target) ?? 0) + 1);
        if (from.authorId) partners.add(from.authorId);
      }
      if (mineIds.has(link.source) && !isMine(to)) {
        given += 1;
        if (to.authorId) partners.add(to.authorId);
      }
    }

    const authors = new Set(graph.placed.map(p => p.note.authorId).filter(Boolean) as string[]);
    const totalCrossLinks = graph.links.filter(l => {
      const a = graph.byId.get(l.source)?.note;
      const b = graph.byId.get(l.target)?.note;
      return a && b && a.authorId && b.authorId && a.authorId !== b.authorId;
    }).length;

    return {
      myNotes: mine.length,
      received: [...receivedBy.values()].reduce((a, b) => a + b, 0),
      given,
      partners: partners.size,
      peers: Math.max(authors.size - 1, 0),
      unanswered: mine.filter(p => !receivedBy.has(p.id)),
      groupAvgReceived: authors.size ? totalCrossLinks / authors.size : 0,
    };
  }, [graph, currentUserId]);

  const t = zh ? {
    title: 'Build-on 网络',
    sub: '每个节点是一条观点，连线表示 Build-on 关系。节点位置由关系结构计算得出，与画布上的摆放无关。',
    yours: '你在本次讨论中的位置',
    notes: '发布的观点',
    received: '被同伴建构',
    given: '建构同伴观点',
    partners: '建立过关联的同伴',
    of: '组内共',
    people: '人',
    avg: '组内人均被建构',
    unanswered: '尚无人建构的观点',
    allAnswered: '你的观点均已被同伴建构。',
    locate: '在画布中定位',
    prompt: '看清自己的位置之后，值得进一步思考：',
    close: '关闭',
    empty: '本空间尚无观点。',
  } : {
    title: 'Build-on network',
    sub: 'Each node is an idea; each line is a build-on relation. Positions are computed from the relation structure, not the canvas layout.',
    yours: 'You in this discussion',
    notes: 'ideas posted',
    received: 'built on by peers',
    given: 'you built on peers',
    partners: 'peers connected with',
    of: 'group has',
    people: 'people',
    avg: 'group average received',
    unanswered: 'Ideas nobody has answered yet',
    allAnswered: 'Every one of your ideas has been built on.',
    locate: 'Find on canvas',
    prompt: 'Now that your position is visible, it is worth asking:',
    close: 'Close',
    empty: 'No ideas in this space yet.',
  };

  /**
   * 反思提示按学生的实际处境挑，不是固定一句。
   * 只发不接、只接不发、观点没人理，需要被问的是不同的问题。
   */
  const reflection = (() => {
    if (stats.myNotes === 0) {
      return zh ? '你还没有发布观点。先写下一个你真正困惑的问题，比补一条总结更有用。'
                : 'You have not posted an idea yet. A question you genuinely puzzle over beats a summary.';
    }
    if (stats.given === 0) {
      return zh ? '你发布了观点，但还没有接过同学的。挑一条你不同意的，说说为什么。'
                : 'You post ideas but have not built on anyone. Pick one you disagree with and say why.';
    }
    if (stats.unanswered.length >= Math.max(2, stats.myNotes / 2)) {
      return zh ? '你有不少观点还没人回应。是不是写得太像结论、没给同学接话的口子？'
                : 'Several of your ideas have no replies. Are they written as conclusions, leaving nowhere to build on?';
    }
    if (stats.partners <= 1 && stats.peers > 1) {
      return zh ? '你的连接集中在少数同学身上。组里还有谁的观点你没读过？'
                : 'Your links cluster on one or two peers. Whose ideas have you not read yet?';
    }
    return zh ? '你既发布也回应。下一步可以试着把几条不同的观点连起来，提出一个更高层的问题。'
              : 'You both post and respond. Next: connect several ideas into a higher-level question.';
  })();

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="text-[1.0625rem] font-bold tracking-tight text-zinc-900 dark:text-gray-100">{t.title}</h2>
            <p className="mt-0.5 text-[0.75rem] leading-5 text-zinc-500 dark:text-gray-400">{t.sub}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-h-0 overflow-auto bg-zinc-50/60 p-4 dark:bg-gray-950/40">
            {graph.placed.length === 0 ? (
              <p className="py-20 text-center text-sm text-zinc-500">{t.empty}</p>
            ) : (
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t.title}>
                {graph.links.map(link => {
                  const a = graph.byId.get(link.source);
                  const b = graph.byId.get(link.target);
                  if (!a || !b) return null;
                  const touchesMe = isMine(a.note) || isMine(b.note);
                  return (
                    <line
                      key={link.id}
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={RELATION_COLORS[link.relationType ?? ''] ?? '#cbd5e1'}
                      strokeWidth={touchesMe ? 2.2 : 1.1}
                      strokeOpacity={touchesMe ? 0.95 : 0.35}
                    />
                  );
                })}
                {graph.placed.map(p => {
                  const mine = isMine(p.note);
                  const orphan = mine && stats.unanswered.some(u => u.id === p.id);
                  return (
                    <g
                      key={p.id}
                      onMouseEnter={() => setHovered(p.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => onLocateNote?.(p.id)}
                      className="cursor-pointer"
                    >
                      <circle
                        cx={p.x} cy={p.y}
                        r={mine ? 9 : 5.5}
                        fill={mine ? '#000080' : '#ffffff'}
                        stroke={orphan ? '#C27C7C' : mine ? '#000080' : '#cbd5e1'}
                        strokeWidth={orphan ? 3 : 1.5}
                      />
                      {hovered === p.id && (
                        <text
                          x={p.x} y={p.y - 14}
                          textAnchor="middle"
                          className="fill-zinc-900 text-[0.6875rem] font-semibold dark:fill-gray-100"
                        >
                          {(p.note.title || '（无标题）').slice(0, 18)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          <aside className="min-h-0 overflow-y-auto border-t border-zinc-100 p-5 dark:border-gray-800 lg:border-l lg:border-t-0">
            <h3 className="text-[0.8125rem] font-bold text-zinc-800 dark:text-gray-100">{t.yours}</h3>
            <dl className="mt-3 space-y-2">
              {[
                [t.notes, stats.myNotes],
                [t.received, stats.received],
                [t.given, stats.given],
                [`${t.partners}（${t.of} ${stats.peers} ${t.people}）`, stats.partners],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-baseline justify-between gap-3">
                  <dt className="text-[0.75rem] text-zinc-500 dark:text-gray-400">{label}</dt>
                  <dd className="text-[0.9375rem] font-bold text-zinc-900 dark:text-gray-100">{value}</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 border-t border-zinc-100 pt-2 dark:border-gray-800">
                <dt className="text-[0.75rem] text-zinc-400">{t.avg}</dt>
                <dd className="text-[0.8125rem] text-zinc-500 dark:text-gray-400">{stats.groupAvgReceived.toFixed(1)}</dd>
              </div>
            </dl>

            <div className="mt-5 rounded-xl bg-[#000080]/[0.05] p-3.5 dark:bg-[#4169E1]/[0.12]">
              <p className="text-[0.75rem] font-semibold text-[#000080] dark:text-[#93AAFD]">{t.prompt}</p>
              <p className="mt-1 text-[0.75rem] leading-6 text-zinc-700 dark:text-gray-300">{reflection}</p>
            </div>

            <h4 className="mt-5 text-[0.75rem] font-bold text-zinc-700 dark:text-gray-200">{t.unanswered}</h4>
            {stats.unanswered.length === 0 ? (
              <p className="mt-1.5 text-[0.75rem] leading-5 text-zinc-500 dark:text-gray-400">{t.allAnswered}</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {stats.unanswered.map(p => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onLocateNote?.(p.id)}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.75rem] text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      title={t.locate}
                    >
                      <Crosshair size={12} className="shrink-0 text-[#C27C7C]" />
                      <span className="truncate">{p.note.title || '（无标题）'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};

export default BuildOnNetwork;
