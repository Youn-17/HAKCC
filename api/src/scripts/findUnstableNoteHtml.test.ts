import { describe, expect, it } from 'vitest';
import { checkNoteHtmlStability, reparseNoteHtml } from './findUnstableNoteHtml';

/**
 * 清单脚本的判定。下面三种嵌套照着 2026-09-28 生产库里查到的形状写（字和 id 换成了假的）。
 */
const scaffold = (id: string, body: string) =>
  `<p data-scaffold-id="${id}" data-scaffold-l1="KB" data-scaffold-title="话头${id}"><strong data-scaffold-tag="">话头${id}</strong>` +
  `<span data-scaffold-slot=""><span data-scaffold-bracket="">[</span><span data-scaffold-input="">${body}</span><span data-scaffold-bracket="">]</span></span></p>`;

const aiBlock = '<div data-ai-source="genai" data-provider-id="deepseek" data-model="deepseek-flash"><div><p>AI 给的一段话</p></div></div>';

const changed = (html: string) => Object.fromEntries(checkNoteHtmlStability(html).statChanges.map(c => [c.field, [c.stored, c.rendered]]));

describe('正文解析稳定性', () => {
  it('编辑器正常存下来的正文：稳定', () => {
    const html = `<p>自己写的</p>${scaffold('A', '括号里的话')}${aiBlock}<p><br></p>`;
    expect(reparseNoteHtml(html)).toBe(html);
    expect(checkNoteHtmlStability(html)).toEqual({ stable: true, statChanges: [] });
  });

  it('只是实体写法不同（旧的 &#039;）：不算不稳定', () => {
    expect(checkNoteHtmlStability('<p>it&#039;s</p>').stable).toBe(true);
  });

  it('支架段套在支架段里：库里记成外层的 id，显示出来是里面两条', () => {
    const html = `<p data-scaffold-id="A" data-scaffold-l1="KB" data-scaffold-title="话头A">${scaffold('B', '第一句')}${scaffold('C', '第二句')}<p></p></p>`;
    const result = checkNoteHtmlStability(html);
    expect(result.stable).toBe(false);
    expect(changed(html).scaffoldIds).toEqual([['A'], ['B', 'C']]);
  });

  it('普通段落里套着支架段：学生自己写的字在库里被算进了支架段', () => {
    const html = `<p>我先写的${scaffold('A', '括号里')}</p>`;
    expect(changed(html).plainChars).toEqual([0, '我先写的'.length]);
  });

  it('AI 插入块套在段落里：后面学生写的字在库里被算成 AI 的', () => {
    const html = `<p><br></p><p>${aiBlock}<p><br></p>学生接着写<br></p>`;
    const diff = changed(html);
    expect(diff.plainChars).toEqual([0, '学生接着写'.length]);
    expect((diff.aiChars as number[])[0]).toBeGreaterThan((diff.aiChars as number[])[1]);
  });

  it('结构变了但切分不受影响（表格补 tbody）：列出来，统计项为空', () => {
    const result = checkNoteHtmlStability('<table><tr><td>格</td></tr></table>');
    expect(result).toEqual({ stable: false, statChanges: [] });
  });
});
