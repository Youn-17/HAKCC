/**
 * 把一份材料切成可检索的片段。
 *
 * 切片的目标不是「均匀」，是**每一片自己读得懂**。检索命中之后，那一片会被原样
 * 塞进 AI 的上下文；如果它从半句话开始、到半个表格结束，AI 只能瞎猜。
 * 所以：先按标题分节（标题本身是最强的语义边界），节内按段落累积，
 * 段落本身超长才在句子处切开。
 *
 * 每片带上标题路径（「三、角色与组织结构 › 教师」）。这既让 AI 知道这段话在讲什么，
 * 也让界面能告诉学生这句话出自文档的哪一节。
 */

export interface KbChunk {
  ordinal: number;
  headingPath: string | null;
  content: string;
}

/** 目标片长。约 700–900 字一片：够一个完整论点，又不至于稀释检索信号。 */
const TARGET_CHARS = 800;
/** 超过这个长度就必须切，哪怕切在句子中间。 */
const HARD_MAX = 1600;
/** 短于这个的片没有检索价值（孤零零一个标题、一行页码）。 */
const MIN_CHARS = 40;

const HEADING = /^(#{1,6})\s+(.*)$/;

function headingPathOf(stack: string[]): string | null {
  const parts = stack.filter(Boolean);
  return parts.length ? parts.join(' › ') : null;
}

/** 在句末切开一段过长的文字。中英文标点都算句末。 */
function splitLongParagraph(text: string): string[] {
  if (text.length <= HARD_MAX) return [text];
  const sentences = text.split(/(?<=[。！？；.!?;])\s*/).filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const sentence of sentences) {
    // 单句就超长（没有标点的长串）只能硬切，否则会一直堆下去
    if (sentence.length > HARD_MAX) {
      if (buf) { out.push(buf); buf = ''; }
      for (let i = 0; i < sentence.length; i += TARGET_CHARS) {
        out.push(sentence.slice(i, i + TARGET_CHARS));
      }
      continue;
    }
    if (buf && buf.length + sentence.length > TARGET_CHARS) {
      out.push(buf);
      buf = sentence;
    } else {
      buf = buf ? `${buf}${sentence}` : sentence;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * 切分 Markdown。非 Markdown 的纯文本也能吃：没有标题就整篇按段落切。
 */
export function chunkMarkdown(markdown: string): KbChunk[] {
  const text = (markdown ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const lines = text.split('\n');
  const stack: string[] = [];
  const chunks: KbChunk[] = [];

  let buf: string[] = [];
  let bufPath: string | null = headingPathOf(stack);

  const flush = () => {
    const body = buf.join('\n').trim();
    buf = [];
    if (body.length < MIN_CHARS) return;
    for (const piece of splitLongParagraph(body)) {
      const trimmed = piece.trim();
      if (trimmed.length >= MIN_CHARS) {
        chunks.push({ ordinal: chunks.length, headingPath: bufPath, content: trimmed });
      }
    }
  };

  const currentLength = () => buf.join('\n').length;

  for (const line of lines) {
    const heading = line.match(HEADING);
    if (heading) {
      // 标题是最强的语义边界：换节先把上一节收掉
      flush();
      const level = heading[1].length;
      stack.length = Math.max(0, level - 1);
      stack[level - 1] = heading[2].trim();
      bufPath = headingPathOf(stack);
      continue;
    }

    // 空行 = 段落边界。攒够长度就在这里收，保证不从半句话开始
    if (!line.trim()) {
      if (currentLength() >= TARGET_CHARS) flush();
      else if (buf.length) buf.push('');
      continue;
    }

    buf.push(line);
    if (currentLength() >= HARD_MAX) flush();
  }
  flush();

  // ordinal 在 flush 里按 push 顺序给，这里重排一遍防止上面有分支漏掉
  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}
