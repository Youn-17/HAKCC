import { describe, expect, it } from 'vitest';
import { looksLikeToolMarkupStart, parseTextToolCalls, stripToolMarkup } from './agentLoop';

const TOOLS = ['get_learner_insights', 'search_notes'];

describe('parseTextToolCalls', () => {
  it('parses the fullwidth-bar DSML that DeepSeek writes as text', () => {
    const text = '<｜DSML｜calls>\n<｜DSML｜invoke name="get_learner_insights">\n<｜DSML｜parameter name="student_id" string="true">992050a0-7d61-4aa1-8da6-fc97210fd7e0</｜DSML｜parameter>\n</｜DSML｜invoke>\n<｜DSML｜invoke name="search_notes">\n<｜DSML｜parameter name="query" string="true">认知卸载</｜DSML｜parameter>\n<｜DSML｜parameter name="limit">5</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜calls>';
    const { toolCalls, cleanedContent } = parseTextToolCalls(text, TOOLS);
    expect(toolCalls.map(c => c.function.name)).toEqual(['get_learner_insights', 'search_notes']);
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ student_id: '992050a0-7d61-4aa1-8da6-fc97210fd7e0' });
    expect(JSON.parse(toolCalls[1].function.arguments)).toEqual({ query: '认知卸载', limit: 5 });
    expect(cleanedContent).toBe('');
  });

  it('still parses the half-width tool_calls variant relayed by DMX', () => {
    const text = 'Let me check. <|DSML||tool_calls><|DSML||invoke name="search_notes"><|DSML||parameter name="query">bias</|DSML||parameter></|DSML||invoke></|DSML||tool_calls>';
    const { toolCalls, cleanedContent } = parseTextToolCalls(text, TOOLS);
    expect(toolCalls.map(c => c.function.name)).toEqual(['search_notes']);
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ query: 'bias' });
    expect(cleanedContent).toBe('Let me check.');
  });

  it('tolerates a truncated block with no closing tag', () => {
    const text = '<｜DSML｜calls><｜DSML｜invoke name="search_notes"><｜DSML｜parameter name="query" string="true">fairness</｜DSML｜parameter>';
    const { toolCalls } = parseTextToolCalls(text, TOOLS);
    expect(toolCalls).toHaveLength(1);
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ query: 'fairness' });
  });

  it('ignores tools that are not available', () => {
    const text = '<｜DSML｜calls><｜DSML｜invoke name="delete_everything"><｜DSML｜parameter name="x">1</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>';
    expect(parseTextToolCalls(text, TOOLS).toolCalls).toHaveLength(0);
  });
});

describe('tool markup guards', () => {
  it('recognises markup at the start of an answer', () => {
    expect(looksLikeToolMarkupStart('<｜DSML｜calls>')).toBe(true);
    expect(looksLikeToolMarkupStart('<|DSML||tool_calls>')).toBe(true);
    expect(looksLikeToolMarkupStart('## 教学评估报告')).toBe(false);
    expect(looksLikeToolMarkupStart('<table>')).toBe(false);
  });

  it('strips leftover markup so nothing machine-looking reaches the teacher', () => {
    const text = '结论如下。\n<｜DSML｜calls><｜DSML｜invoke name="x"></｜DSML｜invoke></｜DSML｜calls>\n\n\n再看一眼。';
    expect(stripToolMarkup(text)).toBe('结论如下。\n\n再看一眼。');
  });
});
