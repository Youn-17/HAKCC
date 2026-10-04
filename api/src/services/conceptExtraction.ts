/**
 * 概念抽取 —— 无监督术语发现。
 *
 * 原本私有在 dashboard.ts 里，只服务学生个人知识图谱。小组观点图谱要用同一套
 * 算法，抽出来共用而不是复制一份 —— 两份实现漂移之后，同一批笔记在两个界面上
 * 会抽出不同的概念，学生和教师看到的东西对不上。
 *
 * 判据：
 *  - 凝固度（PMI）：真词的字比随机共现黏得紧，「光合作用」高而「一个问题」低；
 *  - 边界自由度（左右邻熵）：真词出现在多样的上下文里，长词的碎片只会看到固定邻居；
 *  - 课堂通用词黑名单 + 标题出现加权。
 */

const ZH_STOP_CHARS = new Set('的了是在有和就不人都一个上也很到说要去你会着没看好这那我他她它们么什吗呢吧啊把被让向从对于与及或等但因所以如果虽然而且还有其中没有可以'.split(''));
// Classroom/discussion filler terms — frequent but carry no domain meaning
const ZH_GENERIC_TERMS = new Set([
  '我们', '你们', '他们', '大家', '自己', '老师', '同学', '同伴', '因为', '所以', '但是', '然后',
  '觉得', '认为', '感觉', '知道', '了解', '发现', '出现', '进行', '通过', '可能', '应该', '需要',
  '可以', '不能', '没有', '还有', '这个', '那个', '这样', '那样', '这些', '那些', '什么', '怎么',
  '为什么', '怎么样', '问题', '想法', '意见', '观点', '看法', '例子', '方面', '方法', '时候', '东西',
  '内容', '情况', '事情', '地方', '现在', '今天', '明天', '开始', '最后', '首先', '其次', '比如',
  '如果', '虽然', '而且', '或者', '并且', '不过', '其实', '真的', '非常', '比较', '一些', '一起',
  '一样', '不同', '相同', '重要', '主要', '很多', '许多', '所有', '每个', '大概', '大约', '基本',
  '笔记', '讨论', '分享', '交流', '回复', '评论', '支持', '同意', '反对', '补充', '提出', '表示',
]);
/**
 * 课堂讨论里高频但没有区分度的词。
 *
 * 与 ZH_GENERIC_TERMS 分开：那份是通用填充词（我们、觉得、这个），任何场景都该滤掉；
 * 这份是**在学习科学课堂里**人人都会说、因此区分不出观点的词。做个人知识图谱时
 * 保留它们尚可（它们确实是学生的关注点），但做小组观点图谱时留着就是噪声 ——
 * 一张写着「学习 / 学生 / 思考 / 知识」的图，学生看了不会知道任何新东西。
 */
const ZH_CLASSROOM_UBIQUITOUS = new Set([
  '学习', '学生', '老师', '教师', '教学', '课堂', '教育', '知识', '思考', '过程', '能力',
  '部分', '目前', '具体', '变成', '根本', '直接', '回答', '未来', '现实', '理想', '关键',
  '角色', '模式', '系统', '工具', '技术', '效果', '影响', '作用', '研究', '理论', '设计',
  '提供', '实现', '解决', '改变', '提升', '增强', '避免', '关注', '强调', '指出', '说明',
  '领域', '平均', '确定', '任何', '记住', '跟踪', '答案', '真的', '完全', '一定', '大量',
  'extension', 'ai', '延伸',
]);

const EN_STOP_WORDS = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'have', 'will', 'would', 'could', 'should', 'about', 'which', 'their', 'there', 'these', 'those', 'because', 'been', 'were', 'they', 'them', 'then', 'than', 'also', 'more', 'some', 'such', 'very', 'when', 'what', 'your', 'into', 'only', 'other', 'most', 'like', 'just', 'think', 'know', 'want', 'need', 'good', 'make', 'made', 'many', 'much', 'each', 'both', 'same', 'different', 'example', 'question', 'answer', 'idea', 'ideas', 'note', 'notes', 'discuss', 'discussion']);

interface TermStat {
  freq: number;
  docs: Set<string>;
  titleHits: number;
  left: Map<string, number>;
  right: Map<string, number>;
}

function shannonEntropy(counts: Map<string, number>): number {
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Unsupervised term discovery for classroom discourse.
 * Domain terms are found by combining:
 *  - cohesion (PMI-style): the characters inside a term stick together far more
 *    often than chance, so 光合作用 scores high while 一个问题 does not;
 *  - boundary freedom (left/right neighbor entropy): a real term appears in
 *    varied contexts, whereas fragments of longer words always see the same
 *    neighbor and get absorbed into the longer term instead;
 *  - a generic-classroom-word blacklist and title-occurrence boosting.
 */
/**
 * 拦掉悬挂在概念前面的动词和虚字。
 *
 * 「觉得计算思维」「需要老师」「变成学习」「回答问题」都能通过凝固度检验
 * ——它们确实常一起出现——但前面那个动词不属于学生想表达的概念。
 *
 * 只查**前导**，不查结尾：两个常见词构成的复合概念（情感支持、思考过程、
 * 知识传递、传统课堂）是真概念，按结尾拦会把它们一起误杀。
 */
const ZH_LEADING_VERBS = [
  '觉得', '认为', '感觉', '知道', '了解', '发现', '出现', '进行', '通过', '应该',
  '需要', '可以', '不能', '没有', '还有', '变成', '成为', '提出', '表示', '强调',
  '指出', '说明', '避免', '关注', '实现', '解决', '改变', '提升', '增强', '提供',
  '回答', '使用', '包括', '属于', '来自', '造成', '导致', '意味',
];
/** 概念不会以这些字开头或结尾 —— 一律是虚字或结构助词。 */
const ZH_DANGLING_CHARS = new Set('的了得是在和与就都也还很太更把被让使对为以及所之其个种此该并且或又再比真最没有会能要说'.split(''));

function hasStopWordBoundary(term: string): boolean {
  if (!/[一-鿿]/.test(term) || term.length < 3) return false;
  if (ZH_DANGLING_CHARS.has(term[0]) || ZH_DANGLING_CHARS.has(term[term.length - 1])) return true;
  return ZH_LEADING_VERBS.some(v => term.startsWith(v) && term.length > v.length);
}

export type ConceptScoringOptions = {
  /**
   * 区分度模式。默认关闭以保持学生个人知识图谱的既有行为。
   *
   * 开启后做两件事：滤掉课堂泛词；把「出现在多少篇笔记里」从线性奖励改成
   * sqrt(df)·log2(1+N/df) —— 出现在 12/21 篇的词不再靠频率屠榜，排名交给
   * 凝固度、词长和标题命中来决定。小组观点图谱要的是「这个组独有的观点」，
   * 不是「这门课人人都在说的词」。
   */
  discriminative?: boolean;
};

export function extractConceptsScored(
  docs: { id: string; title: string; text: string }[],
  maxConcepts: number,
  options: ConceptScoringOptions = {},
): Map<string, { docs: Set<string>; score: number }> {
  const discriminative = options.discriminative === true;
  const stats = new Map<string, TermStat>();
  let totalChars = 0;
  const charFreq = new Map<string, number>();

  const bump = (term: string, docId: string, leftCh: string, rightCh: string, inTitle: boolean) => {
    let s = stats.get(term);
    if (!s) {
      s = { freq: 0, docs: new Set(), titleHits: 0, left: new Map(), right: new Map() };
      stats.set(term, s);
    }
    s.freq++;
    s.docs.add(docId);
    if (inTitle) s.titleHits++;
    s.left.set(leftCh, (s.left.get(leftCh) ?? 0) + 1);
    s.right.set(rightCh, (s.right.get(rightCh) ?? 0) + 1);
  };

  for (const doc of docs) {
    const clean = (t: string) => t.replace(/<[^>]*>/g, ' ');
    const segments: { text: string; inTitle: boolean }[] = [
      { text: clean(doc.title ?? ''), inTitle: true },
      { text: clean(doc.text ?? ''), inTitle: false },
    ];
    for (const seg of segments) {
      // English terms (single words, 3+ chars)
      for (const m of seg.text.matchAll(/[a-zA-Z][a-zA-Z-]{2,}/g)) {
        const w = m[0].toLowerCase();
        if (EN_STOP_WORDS.has(w)) continue;
        bump(w, doc.id, ' ', ' ', seg.inTitle);
      }
      // Chinese n-grams (2-6 chars) within contiguous CJK runs
      for (const run of seg.text.matchAll(/[一-鿿]{2,}/g)) {
        const s = run[0];
        for (const ch of s) {
          charFreq.set(ch, (charFreq.get(ch) ?? 0) + 1);
          totalChars++;
        }
        for (let len = 2; len <= Math.min(6, s.length); len++) {
          for (let i = 0; i + len <= s.length; i++) {
            const gram = s.slice(i, i + len);
            if (ZH_STOP_CHARS.has(gram[0]) || ZH_STOP_CHARS.has(gram[gram.length - 1])) continue;
            const leftCh = i > 0 ? s[i - 1] : '';
            const rightCh = i + len < s.length ? s[i + len] : '';
            bump(gram, doc.id, leftCh, rightCh, seg.inTitle);
          }
        }
      }
    }
  }

  // 试过在区分度模式下放宽到 1 篇（只要该词进过标题），想捞出「数字鸿沟」这类
  // 还没被别人接住的观点。实测得不偿失：n-gram 上限 6 字会把长标题切碎，
  // 「自适应学习系」「两个标准差问」这类断词全涌进来，而 freq=1 时左右邻熵恒为 0，
  // 现有的边界自由度过滤器拦不住它们。噪声压过了收益，维持 2 篇门槛。
  const minDocs = docs.length >= 6 ? 2 : 1;
  const scored: { term: string; docs: Set<string>; score: number }[] = [];

  for (const [term, s] of stats) {
    if (s.docs.size < minDocs) continue;
    if (ZH_GENERIC_TERMS.has(term)) continue;
    if (discriminative && ZH_CLASSROOM_UBIQUITOUS.has(term)) continue;
    if (discriminative && hasStopWordBoundary(term)) continue;

    const isCjk = /[一-鿿]/.test(term);
    let cohesion = 1;
    if (isCjk && term.length >= 2 && totalChars > 0) {
      // Min over binary splits of freq(term)/(freq(prefix)*freq(suffix)) using
      // sub-gram counts; low cohesion = co-occurring by chance, not a term.
      let minRatio = Infinity;
      for (let cut = 1; cut < term.length; cut++) {
        const a = stats.get(term.slice(0, cut))?.freq ?? charFreq.get(term.slice(0, cut)) ?? 1;
        const b = stats.get(term.slice(cut))?.freq ?? charFreq.get(term.slice(cut)) ?? 1;
        minRatio = Math.min(minRatio, (s.freq * totalChars) / (a * b));
      }
      cohesion = minRatio;
      if (cohesion < 8) continue;
    }

    let freedom = 1;
    if (isCjk) {
      freedom = Math.min(shannonEntropy(s.left), shannonEntropy(s.right));
      // Fragments of longer terms always see the same neighbor -> ~0 entropy
      if (freedom < 0.35 && s.freq >= 3) continue;
    }

    const lengthBoost = isCjk ? Math.log2(1 + term.length) : 1.2;
    const titleBoost = 1 + Math.min(s.titleHits, 3) * 0.8;
    // 线性的 docs.size 会让泛词按出现篇数直接屠榜；区分度模式改用
    // sqrt(df)·log2(1+N/df)，让 df 从 2 到 12 的权重基本持平。
    const dfWeight = discriminative
      ? Math.sqrt(s.docs.size) * Math.log2(1 + docs.length / s.docs.size)
      : s.docs.size;
    const score = dfWeight * Math.log2(1 + s.freq) * lengthBoost * titleBoost * Math.min(1 + Math.log2(Math.max(cohesion, 1)) / 10, 2) * (0.5 + Math.min(freedom, 2) / 2);
    scored.push({ term, docs: s.docs, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // Substring dedup: drop a term when a stronger kept term contains it (or vice
  // versa) with similar coverage — keeps 光合作用 over 光合 + 合作用 fragments.
  const kept: { term: string; docs: Set<string>; score: number }[] = [];
  for (const cand of scored) {
    if (!discriminative && kept.length >= maxConcepts) break;

    const containedByIdx = kept.findIndex(k => cand.term.includes(k.term) && cand.term !== k.term);
    const containsIdx = kept.findIndex(k => k.term.includes(cand.term));

    if (discriminative && containedByIdx >= 0 && containsIdx < 0) {
      // 候选词比已保留的更长、更具体（「认知卸载」vs「认知」）。贪心按分数排序时
      // 泛化的短词总是先被留下，把长词挤掉 —— 对观点图谱这正好反了：学生说的是
      // 「认知卸载」，图上却只显示「认知」，等于把观点抹平成学科名词。
      // 覆盖面接近就顶替；差得远说明短词另有独立用法，两个都留。
      const k = kept[containedByIdx];
      const overlap = [...cand.docs].filter(d => k.docs.has(d)).length;
      if (overlap / k.docs.size >= 0.5) {
        kept[containedByIdx] = cand;
        continue;
      }
      kept.push(cand);
      continue;
    }

    if (containedByIdx < 0 && containsIdx < 0) kept.push(cand);
  }
  if (kept.length > maxConcepts) kept.length = maxConcepts;
  return new Map(kept.map(k => [k.term, { docs: k.docs, score: Math.round(k.score * 10) / 10 }]));
}

// Backwards-compatible wrapper used by the knowledge-graph endpoint
export function extractConcepts(docs: { id: string; text: string; title?: string }[], maxConcepts: number): Map<string, Set<string>> {
  const scored = extractConceptsScored(
    docs.map(d => ({ id: d.id, title: d.title ?? '', text: d.text })),
    maxConcepts,
  );
  return new Map(Array.from(scored.entries()).map(([term, v]) => [term, v.docs]));
}
