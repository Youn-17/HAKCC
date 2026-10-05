# 功能说明的核对记录

核对日期：2026-10-06。当前代码基于 `9f1e83a` 和已检查的工作区修改，具体发布内容由文件指纹标识。新增路径见 [v0.3.0 补充说明](UPDATES_v0.3.0.md)。本文件记录说明文档与功能的对应，方便后续版本更新；下列路径对应本仓库中的公开源代码；发布清理记录见 evidence/source_snapshot.json。

| 文档主题 | 主要实现位置 | 本次验证 |
| --- | --- | --- |
| 课程与角色 | `components/courseStanding.ts`、`components/courseSettings/CourseSettingsPage.tsx` | 源码与教师实机界面 |
| Note 与共享工作台 | `components/Sidebar.tsx`、`components/NoteEditorModal.tsx` | 实机打开目标课程与 Note |
| Build-on | `types.ts`、`api/src/routes/notes.ts` | 实机查看 Note 关系与网络 |
| 支架 | `components/NoteEditorModal.tsx`、`api/src/routes/scaffolds.ts` | 实机切换知识建构支架组 |
| AI 角色与工具 | `api/src/services/noteAgentCatalog.ts`、`api/src/services/agentTools.ts` | 核对角色和工具；实机完成一次 AI 提问及回复 |
| AI 采纳 | `api/src/routes/notes.ts`、`components/NoteAiPanel.tsx` | 核对采纳与来源；实机打开理由界面，未确认发布 |
| 自动反馈 | `api/src/routes/noteAiFeedback.ts`、`components/NoteEditorModal.tsx` | 核对条件；实机读取已有反馈 |
| Rise-above | `components/RiseAboveRoom.tsx`、`api/src/routes/riseAbove.ts`、`api/src/services/riseAboveRoom.ts` | 源码核对；本轮没有完整实机发布验证 |
| 教师课程组织 | `components/courseSettings/` | 实机查看目标课程设置、资料与教学安排 |
| 教师与学生导航 | `components/dashboard/teacherDashboardConfig.ts` | 源码核对；教师端实机查看，学生登录待补 |
| 研究导出 | `api/src/services/researchExport.ts`、`components/dashboard/ResearchZone.tsx` | 核对 10 类数据集与默认参与者编码；未导出真实课程数据 |
| 技术架构 | `package.json`、`api/package.json`、`contexts/AuthContext.tsx` | 依赖与模块核对 |

理论参考的原始全文来自 IKIT 托管的 Scardamalia (2002, 2003)、Scardamalia 与 Bereiter (2006)，以及 Tarchi 等 (2013)。条目标题、作者与年份已与原文核对。平台设计对应属于 HAKCC 的解释，不作为这些作者对 AI 功能的实证结论。
