/**
 * 给 AI 生成的笔记起一个真标题。
 *
 * 原来所有自动反馈笔记的标题都写死成「🤖 AI 延伸 | Extension」—— 画布卡片只显示标题，
 * 于是一屏十几张 AI 笔记长得一模一样，学生无从判断哪条值得点开。
 *
 * 不额外调一次模型：反馈文本按提示词的约定必然包含**恰好一个**引导性问题，
 * 那个问题本身就是最好的标题（也符合知识建构里"问题驱动"的取向）。
 * 取不到问题就退回第一个句子，再取不到才用通用标签 —— 全程本地、确定性，
 * 不会因为解析失败而产生空标题。
 */

const CJK = /[一-鿿]/;

/** 中文标题的目标长度；西文按词数另算，见 clamp。 */
const CJK_TARGET = 22;
const LATIN_TARGET = 58;

function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 按句号/问号/感叹号切句。
 * 西文的 `.` 只在后面跟空格加大写/引号时才算句末 —— 否则 "GPT-3.5" 和 "i.e."
 * 会被切成两半，第一句变成半截词。
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；;])\s*|(?<=[.!?])\s+(?=["'(\[]?[A-Z])/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 削掉句首的连接词。反馈正文里那个问题常常以「那么」「所以」开头 ——
 * 承接上文时没问题，单独当标题读起来像话说到一半。
 */
const LEAD_CONNECTIVES = /^(那么|所以|因此|不过|但是|然而|而且|另外|其实|也就是说|换句话说|再想想|试着想想)[，,、\s]*/;
const LEAD_CONNECTIVES_EN = /^(so|then|but|however|also|now|in other words|that said)[,\s]+/i;

function stripLead(text: string): string {
  return text.replace(LEAD_CONNECTIVES, '').replace(LEAD_CONNECTIVES_EN, '').trim();
}

function clamp(text: string, isCjk: boolean): string {
  const target = isCjk ? CJK_TARGET : LATIN_TARGET;
  if (text.length <= target) return text;
  if (isCjk) {
    // 在最后一个标点或语气停顿处截断，避免把词切一半
    const head = text.slice(0, target);
    const cut = Math.max(head.lastIndexOf('，'), head.lastIndexOf('、'), head.lastIndexOf(' '));
    return (cut > target * 0.5 ? head.slice(0, cut) : head).trim() + '…';
  }
  const head = text.slice(0, target);
  const cut = head.lastIndexOf(' ');
  return (cut > target * 0.5 ? head.slice(0, cut) : head).trim() + '…';
}

/**
 * 从 AI 反馈正文里取标题。
 * @param fallback 取不到时用的通用标签（调用方按场景给不同的词）
 */
export function deriveAiNoteTitle(body: string, fallback: string): string {
  const text = stripMarkup(body ?? '');
  if (!text) return fallback;

  const isCjk = CJK.test(text);
  const parts = sentences(text);

  // 优先那个引导性问题
  const question = parts.find(s => /[？?]\s*$/.test(s));
  const picked = question ?? parts[0] ?? text;

  // 去掉句末标点，标题不带问号更像标题；但问句保留问号更达意，只去掉句号
  const cleaned = stripLead(picked.replace(/[。.；;]\s*$/, '').trim());

  // 太短的片段（"是吗？"）当作没取到
  const minLen = isCjk ? 6 : 12;
  if (cleaned.length < minLen) return fallback;

  return clamp(cleaned, isCjk);
}
