import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 从笔记 HTML 里去标签取字的地方。
 *
 * 只写 replace(/<[^>]*>/g, …) 不解码实体：预览里显示 "&nbsp;"，字数把它算成一个词，
 * 搜索比的是标签和属性。卡片预览、Build-on 预览、词汇分析、侧栏字数、手机端搜索先后都出过
 * 这个错（2026-09），所以用测试挡：新代码用 components/noteText.ts 或 api/src/services/noteText.ts；
 * 没改的每一处登记在下面，写明为什么。
 *
 * 名单上的数值多数入库、进研究导出或要跨学期比较，改口径由研究者决定，不在这里顺手改。
 */
const ROOT = resolve(__dirname, '..');
const DIRS = ['components', 'hooks', 'services', 'contexts', 'pages', 'src', 'utils', 'lib', 'api/src'];
const ROOT_FILES = ['App.tsx', 'index.tsx'];
const HELPERS = new Set(['components/noteText.ts', 'api/src/services/noteText.ts']);
const STRIP = /\.replace(?:All)?\(\s*\/<\[\^>\][*+]>\/g/;

const RESEARCH = '研究口径：数值入库、进研究导出或要跨学期比较，改不改由研究者定';
const AI_INPUT = '只进模型的提示词或工具结果；模型的回答入库、进研究导出，要改和 AI 链路一起改';

const ALLOWED: { file: string; snippet: string; why: string }[] = [
  { file: 'api/src/services/researchExport.ts', snippet: ".replace(/<[^>]+>/g, ' ')", why: '研究导出自带的一份，已完整解码，规则与 notePreviewText 相同' },
  { file: 'api/src/services/noteSegments.ts', snippet: ".replace(/<[^>]*>/g, '')", why: `${RESEARCH}（content_segments / segment_stats）` },
  { file: 'api/src/routes/research.ts', snippet: "(n.content ?? '').replace(/<[^>]*>/g, '').length", why: `${RESEARCH}（话语分析内容长度，可下载 CSV）` },
  { file: 'api/src/routes/researchCharts.ts', snippet: "(n.content ?? '')).replace(/<[^>]*>/g, '')", why: `${RESEARCH}（研究图表的关键词、词汇熵）` },
  { file: 'api/src/routes/researchAdvanced.ts', snippet: "(n.content ?? '')).replace(/<[^>]*>/g, '')", why: `${RESEARCH}（观点多样性、词汇熵、主题关键词网络，可下载 CSV）` },
  { file: 'api/src/routes/coding.ts', snippet: "note.content?.replace(/<[^>]*>/g, '')", why: `${RESEARCH}（AI 编码建议的字符偏移写进 coding_references）` },
  { file: 'api/src/services/conceptExtraction.ts', snippet: "t.replace(/<[^>]*>/g, ' ')", why: `${RESEARCH}（小组观点图谱的快照入库、逐期比较）` },
  { file: 'api/src/services/groupIdeaGraph.ts', snippet: "s.replace(/<[^>]*>/g, ' ')", why: '同上' },
  { file: 'api/src/services/triggerEngine.ts', snippet: "text.replace(/<[^>]+>/g, ' ')", why: '触发门控的特征，属于实验干预；已解 &nbsp;' },
  { file: 'api/src/routes/noteAiFeedback.ts', snippet: "(value ?? '').replace(/<[^>]+>/g, ' ')", why: `${RESEARCH}（反馈卡的 draft_length / word_count / draft_excerpt）；已解 &nbsp;` },
  { file: 'components/NoteEditorModal.tsx', snippet: "(value ?? '').replace(/<[^>]+>/g, ' ')", why: '自动反馈的前置门槛（120 字）和去重哈希，挪了会改变触发时机；已解 &nbsp;' },
  { file: 'api/src/routes/feedback.ts', snippet: "noteRow.content.replace(/<[^>]*>/g, '')", why: '教师「生成 AI 反馈」的提示词和兜底文字，入库 note_feedbacks' },
  { file: 'api/src/routes/feedback.ts', snippet: "(noteRow.content ?? '').replace(/<[^>]*>/g, '')", why: '同上' },
  { file: 'api/src/services/embeddingService.ts', snippet: ".replace(/<[^>]+>/g, ' ')", why: '向量入库，按文本哈希决定要不要重算；已解 &nbsp;' },
  { file: 'api/src/services/agentContext.ts', snippet: "value.replace(/<[^>]+>/g, ' ')", why: AI_INPUT },
  { file: 'api/src/services/agentTools.ts', snippet: ".replace(/<[^>]+>/g, ' ')", why: `${AI_INPUT}；已解 &nbsp;` },
  { file: 'api/src/routes/noteConversations.ts', snippet: "value.replace(/<[^>]+>/g, ' ')", why: AI_INPUT },
  { file: 'api/src/routes/noteConversationTools.ts', snippet: "value.replace(/<[^>]+>/g, ' ')", why: `${AI_INPUT}；已解 &nbsp;` },
  { file: 'api/src/routes/riseAbove.ts', snippet: "s.replace(/<[^>]*>/g, ' ')", why: AI_INPUT },
  { file: 'api/src/services/discussionDigest.ts', snippet: "s.replace(/<[^>]*>/g, ' ')", why: AI_INPUT },
  { file: 'api/src/services/aiNoteTitle.ts', snippet: ".replace(/<[^>]+>/g, ' ')", why: '处理的是模型写的反馈文本，不是笔记正文' },
];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(path);
      }
    }
  };
  DIRS.map(d => join(ROOT, d)).filter(existsSync).forEach(walk);
  ROOT_FILES.map(f => join(ROOT, f)).filter(existsSync).forEach(f => out.push(f));
  return out;
}

function stripSites() {
  return sourceFiles().flatMap(path => {
    const file = relative(ROOT, path).split('\\').join('/');
    if (HELPERS.has(file)) return [];
    return readFileSync(path, 'utf-8').split('\n').flatMap((line, i) => {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || !STRIP.test(line)) return [];
      return [{ file, line: i + 1, code }];
    });
  });
}

describe('去标签取字的地方', () => {
  it('新代码用 noteText 里的函数，旧的登记过为什么不改', () => {
    const unlisted = stripSites()
      .filter(s => !ALLOWED.some(a => a.file === s.file && s.code.includes(a.snippet)))
      .map(s => `${s.file}:${s.line}  ${s.code}`);
    expect(unlisted).toEqual([]);
  });

  it('名单里没有过期条目', () => {
    const found = stripSites();
    const stale = ALLOWED
      .filter(a => !found.some(s => s.file === a.file && s.code.includes(a.snippet)))
      .map(a => `${a.file}  ${a.snippet}`);
    expect(stale).toEqual([]);
  });
});
