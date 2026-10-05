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
