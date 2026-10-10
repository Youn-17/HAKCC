/**
 * 常驻的 Python 文本分析进程的源码（2026-10-09 用户：词云用 Python 对 Note 内容构建，而不是 AI 的回答）。
 *
 * 部署包里只有 dist 和 package 文件（deploy.sh），所以 Python 脚本写成一段文本随 JS 发出去，
 * 由 textWorker.ts 用 `python -u -c` 启动。服务器上的 Python 环境是 /opt/hakcc-py（jieba、wordcloud），
 * 建法见 docs/plans/2026-10-09-space-analytics.md。
 *
 * 协议：每行一个 JSON 请求 {id, op, payload}，每行一个 JSON 回答 {id, ok, result | error}。
 *   op = "ping"      → {versions}
 *   op = "keywords"  → payload {docs: [{id, text}], top_k, names?, extra_words?, extra_stop?}
 *                      分词（jieba 精确模式 + 课程词典）、去停用词和数字、按词性留实词，
 *                      权重 = 词频 × jieba 自带的 IDF（压低「问题」「方面」这类到处都有的词），
 *                      每个词记出现在哪些笔记里（点词看笔记用）。
 *   op = "changes"   → shared vocabulary, period counts and note-prevalence differences
 *   op = "cloud"     → payload {words: [{word, weight}], width, height, seed?}
 *                      wordcloud 排版，回每个词的位置（墨迹框左上角）、字号、框的宽高和到基线的距离
                      （前端画 SVG，基线在 y + ascent，用 textLength 卡住宽度，不会重叠）。
 */
export const TEXT_WORKER_SOURCE = String.raw`
import json, os, re, sys, math
from collections import Counter, defaultdict, OrderedDict

import jieba
import jieba.posseg as pseg
import jieba.analyse
from wordcloud import WordCloud
from PIL import ImageDraw, ImageFont

jieba.setLogLevel(60)

# wordcloud 量尺寸用 anchor="lt"（墨迹顶边），画字却用默认的 "la"（字体上沿线），字比量好的框往下偏，
# 偶尔压到下面的词（10-09 逐像素查过）。这个进程里只有 wordcloud 画字，统一成 "lt"；前端按同一个锚点还原。
_draw_text = ImageDraw.ImageDraw.text
def _draw_text_lt(self, xy, text, *args, **kwargs):
    kwargs.setdefault("anchor", "lt")
    return _draw_text(self, xy, text, *args, **kwargs)
ImageDraw.ImageDraw.text = _draw_text_lt

FONT_CANDIDATES = [
    os.environ.get("HAKCC_CJK_FONT", ""),
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
]
FONT = next((p for p in FONT_CANDIDATES if p and os.path.exists(p)), None)

# 课程里常见、jieba 会切错的词（「知识建构」会被切成「知识」「建构」）
COURSE_WORDS = [
    "知识建构", "知识论坛", "观点改进", "综合升华", "协同认知责任", "认知主体性", "学习共同体", "社区知识",
    "生成式AI", "生成式人工智能", "人工智能", "大语言模型", "提示词", "检索练习", "提取练习", "间隔练习", "合意困难",
    "批判性思维", "计算思维", "元认知", "自主学习", "形成性评价", "深度学习", "学习科学", "认知负荷",
    "支架", "笔记", "观点", "证据", "理论", "原笔记", "小组讨论", "数据分析", "算法", "程序", "模型",
]

STOP = set("""
的 了 着 过 是 在 有 和 与 及 或 而 并 并且 也 都 就 还 又 再 才 只 很 太 更 最 非常 比较 特别 一定 一直 已经 正在 曾经
我 我们 你 你们 他 她 它 他们 她们 它们 自己 大家 别人 人家 咱们 同学 同学们 老师 各位
这 那 这个 那个 这些 那些 这样 那样 这种 那种 这里 那里 这么 那么 此 其 其中 之 以 于 对 对于 关于 由于 因为 所以 但是 但 可是 不过
如果 假如 即使 虽然 虽说 然而 然后 而且 并且 以及 或者 还是 不是 就是 只是 只有 只要 无论 不管 除了 比如 例如 像 等 等等
可以 可能 能够 能 会 要 想 应该 应当 需要 必须 得 让 使 把 被 给 从 向 到 往 跟 同 为 为了 通过 根据 按照 进行 开始 继续
什么 怎么 怎样 怎么样 为什么 如何 哪 哪里 哪些 哪个 多少 几 吗 呢 吧 啊 呀 哦 嗯 哈 呗 嘛 么
没有 没 不 别 非 无 有些 一些 一个 一种 一样 一点 一下 一起 一般 一切 所有 每个 各种 很多 许多 不少 部分 整个
觉得 认为 感觉 知道 发现 看到 看看 说 讲 谈 提到 提出 表示 指出 写 做 用 使用 来 去 看 想想 想到 理解 明白 了解
时候 时间 现在 当时 今天 之前 之后 以后 以前 最近 后来 目前 首先 其次 最后 另外 此外 同时 然后 接着
问题 东西 事情 方面 方式 情况 内容 部分 地方 结果 过程 意思 角度 层面 程度 作用 影响 因素 关系 原因 例子
学生 对象 道理 比人 具体内容 东西们 大部分 小部分
the a an and or of to in on for with without by at from as is are was were be been being it its this that these those
i we you he she they them our your my me us not no yes do does did can could will would should may might must
have has had about into than then so such very more most also just only but if because what which who how why when where
""".split())

NUMERIC = re.compile(r"^[\d.,%％\-+/:]+$")
# 实词：名词、地名、机构名、专名、动名词、形名词、英文、成语、简称。人名（nr）单独去掉：笔记里回应同学时常写名字
KEEP_POS = ("n", "ns", "nt", "nz", "nw", "vn", "an", "eng", "i", "j")
NAME_POS = ("nr",)
BUILD_ON = re.compile(r"build[\s\-]?on", re.I)


def tokens(text, tokenizer=None, names=None):
    text = BUILD_ON.sub(" Buildon ", text or "")
    out = []
    for word, flag in (tokenizer or pseg).cut(text):
        w = word.strip()
        if not w:
            continue
        if w == "Buildon":
            out.append("Build-on")
            continue
        low = w.lower()
        if low in STOP or w in STOP or NUMERIC.match(w):
            continue
        if flag.startswith(NAME_POS) or w in (names or set()):
            continue
        if flag == "eng" or re.match(r"^[A-Za-z][A-Za-z0-9\-]*$", w):
            if len(w) < 2:
                continue
            # 英文按小写合并计数，显示时用最常见的原写法（AI、GenAI、Roediger）
            out.append(w)
            continue
        if len(w) < 2:
            continue
        if not flag.startswith(KEEP_POS):
            continue
        out.append(w)
    return out



IDF = jieba.analyse.default_tfidf.idf_freq
MEDIAN_IDF = jieba.analyse.default_tfidf.median_idf


TOKENIZERS = OrderedDict()


def request_tokenizer(payload):
    # Keep course dictionaries and member names isolated across requests.
    names = set()
    for name in payload.get("names") or []:
        if isinstance(name, str) and 1 < len(name.strip()) <= 8:
            name = name.strip()
            names.add(name)
            if len(name) == 3 and re.match(r"^[\u4e00-\u9fff]+$", name):
                names.add(name[1:])
    extra = tuple(sorted(set(w for w in payload.get("extra_words") or [] if isinstance(w, str) and 1 < len(w) <= 20)))
    key = (tuple(sorted(names)), extra)
    if key not in TOKENIZERS:
        tokenizer = jieba.Tokenizer()
        tokenizer.initialize()
        for word in COURSE_WORDS + ["Buildon"] + list(extra):
            tokenizer.add_word(word, freq=200000, tag="nz")
        for name in names:
            tokenizer.add_word(name, freq=300000, tag="nr")
        TOKENIZERS[key] = pseg.POSTokenizer(tokenizer)
        while len(TOKENIZERS) > 2:
            TOKENIZERS.popitem(last=False)
    TOKENIZERS.move_to_end(key)
    return TOKENIZERS[key], names


def collect(payload):
    tokenizer, names = request_tokenizer(payload)
    extra_stop = set(w.lower() for w in (payload.get("extra_stop") or []) if isinstance(w, str))
    tf, where, spelling, by_doc = Counter(), defaultdict(list), defaultdict(Counter), {}
    for doc in payload.get("docs") or []:
        counts = Counter()
        for t in tokens(doc.get("text") or "", tokenizer, names):
            key = t.lower() if re.match(r"^[A-Za-z]", t) else t
            if key.lower() in extra_stop:
                continue
            spelling[key][t] += 1
            counts[key] += 1
        by_doc[doc["id"]] = counts
        tf.update(counts)
        for term in counts:
            where[term].append(doc["id"])
    return tf, where, spelling, by_doc


def ranked_terms(tf, where, docs):
    scores = [(w, count * IDF.get(w, MEDIAN_IDF) * (1.0 if len(where[w]) > 1 or docs <= 2 else 0.6)) for w, count in tf.items()]
    return sorted(scores, key=lambda pair: (-pair[1], pair[0]))


def keywords(payload):
    docs = payload.get("docs") or []
    tf, where, spelling, _ = collect(payload)
    top = ranked_terms(tf, where, len(docs))[:int(payload.get("top_k") or 60)]
    peak = top[0][1] if top else 1.0
    return {
        "terms": [{"word": spelling[w].most_common(1)[0][0], "weight": round(score / peak, 4), "count": tf[w], "notes": len(where[w]), "note_ids": where[w][:50]} for w, score in top],
        "docs": len(docs), "tokens": sum(tf.values()),
    }


def changes(payload):
    docs = payload.get("docs") or []
    tf, where, spelling, by_doc = collect(payload)
    periods = {}
    ids = {}
    for period in ("before", "after"):
        ids[period] = [d["id"] for d in docs if d.get("period") == period]
        periods[period] = {"docs": len(ids[period]), "tokens": sum(sum(by_doc[i].values()) for i in ids[period])}
    terms = []
    for word, _ in ranked_terms(tf, where, len(docs))[:int(payload.get("top_k") or 30)]:
        term = {"word": spelling[word].most_common(1)[0][0]}
        for period in ("before", "after"):
            found = [i for i in ids[period] if by_doc[i][word] > 0]
            term[period] = {"count": sum(by_doc[i][word] for i in ids[period]), "notes": len(found), "note_ids": found[:50]}
        before = term["before"]["notes"] / max(1, periods["before"]["docs"])
        after = term["after"]["notes"] / max(1, periods["after"]["docs"])
        term["delta"] = round(after - before, 6)
        terms.append(term)
    return {"terms": terms, "periods": periods}



def focus(payload):
    docs = payload.get("docs") or []
    _, _, spelling, by_doc = collect(payload)
    authors = defaultdict(list)
    for doc in docs:
        authors[doc["authorId"]].append(doc["id"])
    result = []
    for author, ids in authors.items():
        tf, where = Counter(), defaultdict(list)
        for id in ids:
            tf.update(by_doc[id])
            for word in by_doc[id]:
                where[word].append(id)
        terms = [{"word": spelling[word].most_common(1)[0][0], "note_ids": where[word][:50]} for word, _ in ranked_terms(tf, where, len(ids))[:20]]
        result.append({"id": author, "terms": terms})
    return {"authors": result}



def topic_coverage(payload):
    docs = payload.get("docs") or []
    author = payload.get("author_id")
    selected = [d for d in docs if not author or d["authorId"] == author]
    rows = []
    for topic in payload.get("topics") or []:
        patterns = [re.compile((r"(?<![A-Za-z0-9_])" + re.escape(term) + r"(?![A-Za-z0-9_])") if re.search(r"[A-Za-z]", term) else re.escape(term), re.IGNORECASE) for term in topic["terms"]]
        found = [d for d in docs if any(pattern.search(d.get("text") or "") for pattern in patterns)]
        own = [d for d in found if not author or d["authorId"] == author]
        peers = [d for d in found if author and d["authorId"] != author]
        rows.append({**topic, "notes": len(own), "students": len(set(d["authorId"] for d in own)), "note_ids": [d["id"] for d in own][:50], "peer_note_ids": [d["id"] for d in peers][:50]})
    return {"docs": len(selected), "topics": rows}


def cloud(payload):
    words = {w["word"]: float(w["weight"]) for w in (payload.get("words") or []) if w.get("word") and float(w.get("weight") or 0) > 0}
    if not words:
        return {"items": [], "width": 0, "height": 0}
    if FONT is None:
        raise RuntimeError("no CJK font found for the word cloud")
    width = max(300, min(1600, int(payload.get("width") or 900)))
    height = max(200, min(1000, int(payload.get("height") or 420)))
    wc = WordCloud(
        font_path=FONT, width=width, height=height, mode="RGBA", background_color=None,
        prefer_horizontal=1.0, max_words=len(words), min_font_size=11, max_font_size=int(height * 0.32),
        relative_scaling=0.45, margin=6, random_state=int(payload.get("seed") or 7), collocations=False,
    ).generate_from_frequencies(words)
    items = []
    for (word, freq), size, position, orientation, color in wc.layout_:
        font = ImageFont.truetype(FONT, int(size))
        left, top, right, bottom = font.getbbox(word, anchor="lt")
        # x, y 是墨迹框的左上角；ascent 是从 y 到基线的距离，前端把基线画在 y + ascent
        ink_top = font.getbbox(word, anchor="ls")[1]
        items.append({
            "word": word, "weight": round(float(freq), 4), "size": int(size),
            "x": int(position[1]), "y": int(position[0]), "w": int(right), "h": int(bottom), "ascent": int(round(-ink_top)),
        })
    return {"items": items, "width": width, "height": height}


def ping(_payload):
    import wordcloud as wcmod
    return {"jieba": jieba.__version__, "wordcloud": wcmod.__version__, "font": bool(FONT), "python": sys.version.split()[0]}


OPS = {"ping": ping, "keywords": keywords, "cloud": cloud, "changes": changes, "focus": focus, "topics": topic_coverage}

sys.stdout.write(json.dumps({"id": None, "ok": True, "result": {"ready": True}}) + "\n")
sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        rid = req.get("id")
    except Exception:
        continue
    try:
        result = OPS[req.get("op")](req.get("payload") or {})
        out = {"id": rid, "ok": True, "result": result}
    except Exception as exc:
        out = {"id": rid, "ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    sys.stdout.flush()
`;
