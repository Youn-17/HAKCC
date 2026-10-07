/**
 * 把工具返回值压成一行人话，随 SSE 推给前端。
 *
 * 之前 tool_result 事件只推工具名，学生看到的是「搜索相关笔记 ✓」——
 * 搜到没搜到、搜到几条，全不知道。等待期间界面上没有任何东西在动，
 * 十几秒的推理模型就变成纯干等。
 *
 * 这里只做统计性的概括（几条、成没成），不复述内容 ——
 * 内容该由模型自己在回答里说，不是在进度条上剧透。
 */

type ToolEnvelope = {
  success?: boolean;
  data?: unknown;
  error?: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 从任意结构里找出「主要结果集」的长度。 */
function countOf(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (!isRecord(data)) return null;
  // get_note_context：整个空间时给的是 totalBuildOns（列表可能被截断），指定一条笔记时是 buildOnRelations
  if (typeof data.totalBuildOns === 'number') return data.totalBuildOns;
  for (const key of ['results', 'notes', 'items', 'matches', 'triggers', 'sources', 'insights', 'events', 'buildOnRelations']) {
    const v = data[key];
    if (Array.isArray(v)) return v.length;
  }
  if (typeof data.count === 'number') return data.count;
  if (typeof data.total === 'number') return data.total;
  return null;
}

const ZH: Record<string, (n: number | null, d: unknown) => string> = {
  search_notes: n => (n === 0 ? '没找到相关笔记' : `找到 ${n} 条相关笔记`),
  search_course_materials: n => (n === 0 ? '没有相关段落' : `找到 ${n} 段相关资料`),
  read_note: () => '读完了',
  get_note_context: n => (n === null ? '取到上下文' : n === 0 ? '还没有 Build-on 关系' : `找到 ${n} 条 Build-on 关系`),
  compare_notes: n => (n ? `比对了 ${n} 条` : '比对完成'),
  analyze_argument: () => '分析完成',
  web_search: n => (n === 0 ? '没搜到结果' : `搜到 ${n} 条`),
  find_sources: n => (n === 0 ? '没找到资料' : `找到 ${n} 份资料`),
  detect_triggers: n => (n === 0 ? '没有需要介入的地方' : `发现 ${n} 处`),
  generate_image: () => '生成了 1 张图',
  class_analytics: () => '统计完成',
  export_notes: n => (n ? `导出 ${n} 条` : '导出完成'),
};

const EN: Record<string, (n: number | null, d: unknown) => string> = {
  search_notes: n => (n === 0 ? 'no matching notes' : `${n} notes found`),
  search_course_materials: n => (n === 0 ? 'no relevant passages' : `${n} relevant passages`),
  read_note: () => 'read',
  get_note_context: n => (n === null ? 'context loaded' : n === 0 ? 'no Build-on links yet' : `${n} Build-on links found`),
  compare_notes: n => (n ? `compared ${n}` : 'compared'),
  analyze_argument: () => 'analysed',
  web_search: n => (n === 0 ? 'no results' : `${n} results`),
  find_sources: n => (n === 0 ? 'no sources' : `${n} sources`),
  detect_triggers: n => (n === 0 ? 'nothing to flag' : `${n} flagged`),
  generate_image: () => '1 image',
  class_analytics: () => 'computed',
  export_notes: n => (n ? `${n} exported` : 'exported'),
};

/**
 * @param lang 'zh' 给学生看的中文摘要；'en' 英文。
 * @returns 一行摘要；实在没什么可说的时候返回 undefined（前端就只显示对勾）。
 */
export function summarizeToolResult(
  toolName: string,
  result: unknown,
  lang: 'zh' | 'en' = 'zh',
): string | undefined {
  const env = isRecord(result) ? (result as ToolEnvelope) : undefined;

  if (env && env.success === false) {
    const msg = typeof env.error === 'string' ? env.error : '';
    if (lang === 'zh') return msg ? `没成功：${msg.slice(0, 40)}` : '没成功';
    return msg ? `failed: ${msg.slice(0, 40)}` : 'failed';
  }

  const data = env && 'data' in env ? env.data : result;
  const n = countOf(data);
  const table = lang === 'zh' ? ZH : EN;
  const fn = table[toolName];
  if (fn) return fn(n, data);

  if (n !== null) return lang === 'zh' ? `${n} 项结果` : `${n} results`;
  return undefined;
}
