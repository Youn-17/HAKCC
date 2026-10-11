/**
 * 版本更新日志。
 *
 * 写给用的人看，不是给写代码的人看：一条一条对应「你现在能多做什么」，
 * 不是「哪个函数改了名」。每条按受众标注：只关乎教师的只在教师端显示，
 * 只关乎学生的只在学生端显示，两端共有的都显示（2026-09-10 用户定）。
 * 一个版本在某一端一条都不剩时，整个版本在那一端不出现。
 *
 * 日期以 git 提交和数据库迁移为准；前期集中开发的几周只精确到月份，
 * 不编造具体到哪一天。
 */

/** 这条更新给谁看。不写就是两端都显示。 */
export type ChangelogAudience = 'teacher' | 'student';

export interface ChangelogItem {
  zh: string;
  en: string;
  /** 只关乎教师的（备课、设置、研究导出、课程管理）标 teacher；只关乎学生的标 student。 */
  for?: ChangelogAudience;
}

export interface ChangelogEntry {
  version: string;
  /** 展示用日期。精确到月的写 'YYYY-MM'。 */
  date: string;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
}

/** 最新的排最前面。加新版本就往数组头部插。 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    "version": "v1.83",
    "date": "2026-10-11",
    "titleZh": "指导策略与模板",
    "titleEn": "Guidance strategies and page templates",
    "items": [
      {
        "zh": "教师可生成、编写和采用 AI 指导策略，用于后续回答，也可撤回。",
        "en": "Teachers can generate, write and adopt AI guidance strategies for later answers, or withdraw them.",
        "for": "teacher"
      },
      {
        "zh": "有基线数据时，使用满 20 次后比较后续互动比例，未提高则自动撤回。",
        "en": "With a baseline, cards are withdrawn after 20 uses if the rate of follow-up activity does not improve.",
        "for": "teacher"
      },
      {
        "zh": "已导入笔记的网页可提取结构说明，保存为本课模板。",
        "en": "Extract structural guidance from pages imported into Notes and save it as a course template.",
        "for": "teacher"
      }
    ]
  },
  {
    "version": "v1.82",
    "date": "2026-10-11",
    "titleZh": "学习记忆管理",
    "titleEn": "Learning memory controls",
    "items": [
      {
        "zh": "学生可查看和删除本课 AI 记忆，或关闭跨对话记忆；选择与导入记录保留 60 天。",
        "en": "Students can view or delete their AI memories for this course, or turn off cross-conversation memory. Choice and import records are kept for 60 days.",
        "for": "student"
      },
      {
        "zh": "可删除自己的知识空间智能体对话，同时清除该对话摘要。",
        "en": "Delete your workspace-agent conversations and their summaries.",
        "for": "student"
      }
    ]
  },
  {
    "version": "v1.81",
    "date": "2026-10-11",
    "titleZh": "智能体网页与导入",
    "titleEn": "Agent pages and Note imports",
    "items": [
      {
        "zh": "Note AI 与知识空间智能体可列出步骤、提供方案选择，并生成或修改互动网页。",
        "en": "Note AI and the workspace agent can show steps, offer choices, and create or revise interactive pages.",
        "for": "student"
      },
      {
        "zh": "知识空间智能体的回答和网页可导入自己的笔记；有权查看笔记的人也能打开网页。",
        "en": "Import workspace-agent answers and pages into your own Notes. People with access to a Note can open its attached page.",
        "for": "student"
      }
    ]
  },
  {
    "version": "v1.80",
    "date": "2026-10",
    "titleZh": "小组任务与标识",
    "titleEn": "Group assignments and logos",
    "items": [
      {
        "zh": "教师可向所选小组发布任务，设置截止时间和显示视图，并修改或撤回。",
        "en": "Teachers can assign tasks to selected groups, set due dates and views, and edit or withdraw assignments.",
        "for": "teacher"
      },
      {
        "zh": "组员可确定组长；已有组长时由组长移交，教师可调整。",
        "en": "Members can choose a leader. An existing leader hands over the role, and teachers can change it."
      },
      {
        "zh": "教师可上传小组标识，显示在小组和视图卡片上。",
        "en": "Teachers can upload group logos for group and view cards.",
        "for": "teacher"
      }
    ]
  },
  {
    "version": "v1.79",
    "date": "2026-10-10",
    "titleZh": "协作文档",
    "titleEn": "Collaborative documents",
    "items": [
      {
        "zh": "知识空间可创建协作文档，支持多人编辑和 Word 导出。",
        "en": "Create collaborative documents in the knowledge space, edit together, and export to Word."
      },
      {
        "zh": "可保存版本并查看历史正文；历史版本只读，当前文档继续同步。",
        "en": "Save versions and preview earlier content. Historical versions are read-only while the current document keeps syncing."
      }
    ]
  },
  {
    version: 'v0.7.0', date: '2026-10-10',
    titleZh: '讨论分析与来源核对', titleEn: 'Discussion analysis and source checks',
    items: [
      { zh: '知识空间分析改为独立页面，支持词云、关键词变化、观点接力和待推进议题。', en: 'Knowledge-space analysis opens a dedicated page with word clouds, keyword changes, idea relay and open discussions.', for: 'teacher' },
      { zh: '按视图、学生和日期筛选，点击结果查看来源 Note，支持匿名展示与图像导出。', en: 'Filter by view, student and date; inspect source Notes, use anonymous display and export charts.', for: 'teacher' },
      { zh: '新增可选的课程资料引用核对和草稿支架建议。', en: 'Optional course-material citation checks and draft scaffold suggestions are added.' },
    ],
  },
  {
    version: 'v0.6.0', date: '2026-10-09',
    titleZh: '协作文档与情境绘图', titleEn: 'Shared documents and contextual drawing',
    items: [
      { zh: '知识空间新增协作文档，可多人同步编辑，保存版本并导出 Word。', en: 'Knowledge spaces add shared documents with real-time coediting, version snapshots and Word export.' },
      { zh: '协作文档提供开始、插入和视图工具栏、纸张视图、标尺及缩放。', en: 'Shared documents provide Home, Insert and View tools, a paper view, ruler and zoom.' },
      { zh: 'AI 绘图结合对话与可访问的 Note 情境，支持结构图与修改上一张图。', en: 'AI drawing uses conversation and accessible Note context, supports diagrams and revises the previous drawing.' },
      { zh: '画布新增搜索和 Build-on 折叠，改进中英文与课程设置。', en: 'Canvas search and Build-on folding are added, with language and course-setting improvements.' },
    ],
  },
  {
    version: 'v0.5.0', date: '2026-10-08',
    titleZh: '对话记忆与学生情境', titleEn: 'Conversation memory and student context',
    items: [
      { zh: '知识空间与 Note AI 恢复历史对话，保留滚动记忆并检索本人本课记录。', en: 'Knowledge-space and Note AI restore history, retain rolling memory and retrieve student-owned course records.' },
      { zh: '保留模型选择，按配置的模型上限分配历史情境。', en: 'Model choice is retained, with history budgets based on configured model limits.' },
    ],
  },
  {
    version: 'v0.4.0', date: '2026-10-07',
    titleZh: '课程知识库与来源追溯', titleEn: 'Course knowledge base and source tracing',
    items: [
      { zh: 'Note 与知识空间 AI 可以检索课程材料，回答带引用编号、来源卡片及可用页码。', en: 'Note and workspace AI can retrieve course materials with citation numbers, source cards and available page references.' },
      { zh: '教师可以管理知识库开关、材料重新解析、检索测试与处理状态。', en: 'Teachers can manage knowledge-base switches, material re-parsing, search tests and processing status.', for: 'teacher' },
      { zh: '附件需要配合文字问题；请求失败后保留问题和附件，便于修改后重试。', en: 'Attachments require a written question; failed requests restore the question and attachments for retry.' },
      { zh: '历史对话按助手与课程匹配，改进来源检索、过程统计与文件生成。', en: 'Conversation reuse respects assistant and course; retrieval, process summaries and generated files are improved.' },
    ],
  },
  {
    version: 'v0.3.0', date: '2026-10-06',
    titleZh: '观点演进与 AI 协作更新', titleEn: 'Idea progression and AI collaboration',
    items: [
      { zh: '知识地图与构建时间线独立查看，支持按 Note、成员与小组追踪观点演进。', en: 'Explore the knowledge map and construction timeline separately, with Note, participant and group filters.' },
      { zh: '采纳反馈后先改进原 Note；贡献时检查修订是否回应反馈，再决定是否生成关联 Note。', en: 'Improve the original Note after accepting feedback; contribution checks determine whether a linked Note is still needed.' },
      { zh: 'AI 助手显示执行步骤，并提供回答长度与对话偏好设置。', en: 'AI assistants show execution steps and provide answer-length and conversation preferences.' },
      { zh: '画布显示讨论主题；课程工具补充成员统计与反馈检查导出。', en: 'Canvas topics surface discussion strands; course tools add member counts and feedback-check exports.', for: 'teacher' },
    ],
  },
  {
    version: 'v0.2.0',
    date: '2026-10-04',
    titleZh: 'HAKCC 开源版本',
    titleEn: 'HAKCC open-source release',
    items: [
      { zh: '共享 Note、Build-on 与 Rise-above 支持持续改进共同观点。', en: 'Shared Notes, Build-on and Rise-above support continuing improvement of community ideas.' },
      { zh: 'AI 伙伴与选择性采纳保留学生判断和来源。', en: 'AI partners and selective uptake retain student judgment and provenance.', for: 'student' },
      { zh: '课程设置、学生支持和过程分析帮助教师组织探究。', en: 'Course settings, student support and process analysis help teachers organize inquiry.', for: 'teacher' },
    ],
  },
];

export const LATEST_VERSION = CHANGELOG[0].version;

/** 某一端看得到的日志：过滤掉不相干的条目，条目为空的版本整个去掉。 */
export function changelogFor(audience: ChangelogAudience): ChangelogEntry[] {
  return CHANGELOG
    .map((entry) => ({ ...entry, items: entry.items.filter((item) => !item.for || item.for === audience) }))
    .filter((entry) => entry.items.length > 0);
}

/** 这一端最新的版本号。教师端和学生端可能不同。 */
export function latestVersionFor(audience: ChangelogAudience): string {
  return changelogFor(audience)[0]?.version ?? LATEST_VERSION;
}
