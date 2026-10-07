/** Contextual query construction for course-material retrieval in Note conversations. */

const MAX_QUERY_CHARS = 500;
const MAX_TURN_CHARS = 120;
/** 不超过这么长，一律当追问，补上文 */
const SHORT_CHARS = 20;
/** 不超过这么长、又带指代上文的说法，也补 */
const MEDIUM_CHARS = 60;
const REFERS_BACK = /这个|那个|这些|那些|它们?|上面|上文|前面|刚才|刚刚|第[一二三四五六七八九十\d]+[点个条步]|为什么|为啥|怎么做|举个?例子?|具体|展开|还有|那么|然后呢|呢[？?]?$/;
const UNTITLED = /^(untitled( note)?|无标题|未命名.*)$/i;

export function buildRetrievalQuery(current: string, previousUserTurns: string[], noteTitle: string | null | undefined): string {
  const question = current.trim();
  const needsContext = question.length <= SHORT_CHARS || (question.length <= MEDIUM_CHARS && REFERS_BACK.test(question));
  if (!needsContext) return question.slice(0, MAX_QUERY_CHARS);

  const earlier = previousUserTurns
    .map(t => t.trim())
    .filter(Boolean)
    .slice(-2)
    .reverse()
    .map(t => t.slice(0, MAX_TURN_CHARS));
  const title = (noteTitle ?? '').trim();
  const parts = [question];
  if (earlier.length) parts.push(`（接着问：${earlier.join('；')}）`);
  if (title && !UNTITLED.test(title)) parts.push(`（笔记：${title.slice(0, MAX_TURN_CHARS)}）`);
  return parts.join('\n').slice(0, MAX_QUERY_CHARS);
}
