import React, { useState } from 'react';
import { type UserRole, type Language } from '../../types';
import RemixIcon from '../RemixIcon';
import UserAvatar from '../UserAvatar';
import ThemeToggle from '../ThemeToggle';
import { LangCycleButton, type Lang3 } from '../LangSwitcher';
import { type DashboardTabId } from './teacherDashboardConfig';
import ChangelogPanel, { ChangelogTrigger, changelogAudienceFor, useUnseenRelease } from './ChangelogPanel';
import { readPublicLanguage, saveLanguagePreference } from '../../utils/languagePreference';
import ChangePasswordModal from '../auth/ChangePasswordModal';
import NotificationBell from './NotificationBell';

interface SidebarProps {
  role: UserRole;
  lang: Language;
  activeTab: DashboardTabId | 'profile';
  onTabChange: (tab: DashboardTabId | 'profile') => void;
  onLogout: () => void;
  onLangChange: (lang3: Lang3) => void;
  userName?: string;
  userAvatar?: string;
  /** 待补记的课次数量，显示在「教学日志」上 */
  pendingSessions?: number;
}

interface NavItem {
  id: DashboardTabId | 'profile';
  icon: string;
  label: string;
  section?: string;
  badge?: boolean;
}

function getNavItems(role: UserRole, lang: Language): NavItem[] {
  const zh = lang === 'zh';

  // 个人资料三种角色共用，放在「主要」里 —— 头像要能被找到才有人去设。
  const common: NavItem[] = [
    { id: 'overview', icon: 'dashboard-3-line', label: zh ? '概览' : 'Overview', section: zh ? '主要' : 'Main' },
    { id: 'profile', icon: 'user-3-line', label: zh ? '个人资料' : 'Profile' },
  ];

  if (role === 'student') {
    return [
      ...common,
      { id: 'discover', icon: 'compass-3-line', label: zh ? '发现课程' : 'Discover' },
      { id: 'note-activity', icon: 'file-text-line', label: zh ? '笔记动态' : 'Note Activity', section: zh ? '学习' : 'Learning' },
      { id: 'knowledge-graph', icon: 'node-tree', label: zh ? '知识图谱' : 'Knowledge Graph' },
      { id: 'promising-ideas', icon: 'seedling-line', label: zh ? '潜力想法' : 'Promising Ideas' },
      { id: 'thinking-dev', icon: 'brain-line', label: zh ? '思维发展' : 'Thinking Dev' },
      { id: 'collab-network', icon: 'share-line', label: zh ? '协作网络' : 'Collaboration', section: zh ? '社区' : 'Community' },
      { id: 'feedback', icon: 'message-3-line', label: zh ? '教师反馈' : 'Feedback' },
      { id: 'ai-agent', icon: 'sparkling-2-line', label: zh ? 'AI 对话' : 'AI Chat', section: zh ? 'AI 智能体' : 'AI Agents' },
      { id: 'thinking-trainer', icon: 'lightbulb-line', label: zh ? '思维练习助手' : 'Thinking Coach' },
      { id: 'coding-trainer', icon: 'code-s-slash-line', label: zh ? '编程练习助手' : 'Coding Coach' },
      { id: 'manual', icon: 'book-read-line', label: zh ? '使用手册' : 'User Manual', section: zh ? '平台理念与帮助' : 'Rationale & Help' },
      // 英文不能也叫 Feedback —— 上面「教师反馈」已经占了这个词。用动词区分：那条是收到的，这条是发出的。
      { id: 'platform-feedback', icon: 'chat-smile-2-line', label: zh ? '使用反馈' : 'Send Feedback' },
    ];
  }

  if (role === 'teacher') {
    return [
      ...common,
      { id: 'courses', icon: 'book-open-line', label: zh ? '我的课程' : 'My Courses' },
      { id: 'teaching-log', icon: 'calendar-check-line', label: zh ? '教学日志' : 'Teaching Log' },
      { id: 'agent-chat', icon: 'message-3-line', label: zh ? 'AI 对话' : 'AI Chat', section: zh ? 'AI 智能体' : 'AI Agents' },
      { id: 'agent-lesson', icon: 'draft-line', label: zh ? '备课助手' : 'Lesson Prep' },
      { id: 'agent-analytics', icon: 'line-chart-line', label: zh ? '学情分析' : 'Analytics' },
      { id: 'agent-assess', icon: 'clipboard-line', label: zh ? '教学评估' : 'Assessment' },
      { id: 'student-help', icon: 'lifebuoy-line', label: zh ? '学生求助' : 'Student Help' },
      { id: 'ai-settings', icon: 'settings-3-line', label: zh ? 'AI 设置' : 'AI Settings' },
      { id: 'r-overview', icon: 'dashboard-3-line', label: zh ? '研究概览' : 'Overview', section: zh ? '研究' : 'Research' },
      { id: 'r-temporal', icon: 'time-line', label: zh ? '时序分析' : 'Temporal' },
      { id: 'r-sna', icon: 'share-line', label: zh ? '网络分析' : 'SNA' },
      { id: 'r-lsa', icon: 'bar-chart-grouped-line', label: zh ? '序列分析' : 'LSA' },
      { id: 'r-discourse', icon: 'chat-quote-line', label: zh ? '话语分析' : 'Discourse' },
      { id: 'r-equity', icon: 'scales-3-line', label: zh ? '参与公平性' : 'Equity' },
      { id: 'r-ai-insights', icon: 'sparkling-2-line', label: zh ? 'AI 建议' : 'AI Insights' },
      { id: 'r-coding', icon: 'code-s-slash-line', label: zh ? '质性编码' : 'Coding' },
      { id: 'r-export', icon: 'download-2-line', label: zh ? '数据导出' : 'Export' },
      { id: 'manual', icon: 'book-read-line', label: zh ? '使用手册' : 'User Manual', section: zh ? '平台理念与帮助' : 'Rationale & Help' },
      { id: 'philosophy', icon: 'compass-3-line', label: zh ? '平台理念' : 'Design Rationale' },
    ];
  }

  return [
    ...common,
    { id: 'approvals', icon: 'shield-check-line', label: zh ? '审批' : 'Approvals' },
    { id: 'ai-analysis', icon: 'bar-chart-2-line', label: zh ? 'AI 分析' : 'AI Analytics' },
    { id: 'courses', icon: 'book-open-line', label: zh ? '课程管理' : 'Courses' },
    { id: 'platform-feedback', icon: 'chat-smile-2-line', label: zh ? '使用反馈' : 'Feedback' },
  ];
}

const DashboardSidebar: React.FC<SidebarProps> = ({
  role, lang, activeTab, onTabChange, onLogout, onLangChange, userName, userAvatar, pendingSessions = 0,
}) => {
  const zh = lang === 'zh';
  const items = getNavItems(role, lang);

  const [displayLang, setDisplayLang] = useState<Lang3>(() => readPublicLanguage());
  const [isPwModalOpen, setIsPwModalOpen] = useState(false);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const changelogAudience = changelogAudienceFor(role);
  const [unseenRelease, markReleaseSeen] = useUnseenRelease(changelogAudience);

  const handleLangCycle = (next: Lang3) => {
    saveLanguagePreference(next);
    setDisplayLang(next);
    onLangChange(next);
  };

  // 栏宽按语言和角色分开。标签左边固定占 52px（内边距 + 图标 + 间距），右边还有 24px 内边距，
  // 所以够用的宽度 = 最宽标签 + 76px。实测最宽标签：中文两种角色都是 78px（「参与公平性」「思维练习助手」），
  // 英文教师 / 管理员 94px（Teaching Log）、英文学生 126px（Knowledge Graph）——一个宽度迁就学生，
  // 教师那边就会空出一大片。英文教师这一档的下限其实是底部「v1.19 · What's new」那行（约 176px），
  // 不是导航标签。改导航文案后要重新量一遍。
  // 宽度由最宽的那条标签决定，而不是写死一个像素值：同样的字号，Windows 上的
  // 微软雅黑比 macOS 的苹方宽出一截，写死的宽度在 Mac 上刚好、在 Windows 上就把
  // 「参与公平性」挤成两行。标签禁止换行，栏宽跟着内容走，再给一个上下限。
  const railWidth = zh ? 'w-max min-w-[8.75rem] max-w-[13rem]' : 'w-max min-w-[9.5rem] max-w-[14rem]';

  return (
    <aside className={`dashboard-sidebar flex-shrink-0 h-screen sticky top-0 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 ${railWidth}`}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 h-14 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 px-5">
        <div className="w-7 h-7 rounded-lg bg-[#000080] flex items-center justify-center flex-shrink-0">
          <RemixIcon name="book-open-line" size={14} className="text-white" />
        </div>
        <span className="font-bold text-sm tracking-wide text-gray-900 dark:text-gray-100">HAKCC</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {items.map((item, i) => {
          const showSection = item.section && (i === 0 || items[i - 1]?.section !== item.section);
          return (
            <React.Fragment key={item.id}>
              {showSection && (
                <div className="px-3 pt-4 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-600 select-none">
                  {item.section}
                </div>
              )}
              <button
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center gap-2.5 rounded-lg text-[0.8125rem] transition-colors duration-150 mb-0.5 px-3 py-2 ${
                  activeTab === item.id
                    ? 'bg-[#000080]/[0.07] dark:bg-[#4169E1]/[0.12] text-[#000080] dark:text-[#93AAFD] font-semibold'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900'
                }`}
              >
                <RemixIcon name={item.icon} size={16} className="flex-shrink-0" />
                <span className="whitespace-nowrap leading-tight">{item.label}</span>
                {item.id === 'teaching-log' && pendingSessions > 0 && (
                  <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[0.6875rem] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    {pendingSessions}
                  </span>
                )}
                {item.badge && (
                  <span className="ml-auto text-[0.6875rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#000080]/[0.08] dark:bg-[#4169E1]/[0.12] text-[#000080] dark:text-[#93AAFD]">
                    New
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Bottom: utility controls + user */}
      <div className="border-t border-gray-200 dark:border-gray-800 p-2 flex-shrink-0">
        {/* 更新日志入口。只占一行小字，不侵占概览的主内容区。 */}
        <ChangelogTrigger
          audience={changelogAudience}
          lang={lang === 'zh' ? 'zh' : 'en'}
          unseen={unseenRelease}
          onClick={() => { setIsChangelogOpen(true); markReleaseSeen(); }}
        />

        {/* 主题、语言、通知、改密码、退出：沿整行均匀分布。
            侧栏宽度现在跟着最宽标签走，五个按钮挤在左边会在右侧留下一大块空白（用户反馈）。
            按钮尺寸写死 26px 不用 rem：图标本来就是固定 16px，框跟着字号放大只是多出留白。 */}
        <div className="mb-1 flex items-center justify-between px-1 [&_button]:!h-[26px] [&_button]:!w-[26px] [&_button]:!flex-none">
          <ThemeToggle />
          <LangCycleButton value={displayLang} onChange={handleLangCycle} />
          <NotificationBell
            lang={lang === 'zh' ? 'zh' : 'en'}
            placement="sidebar"
            onOpenFeedback={role === 'student' ? () => onTabChange('feedback') : undefined}
          />
          <button
            onClick={() => setIsPwModalOpen(true)}
            className="flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            aria-label={lang === 'zh' ? '修改密码' : 'Change password'}
            title={lang === 'zh' ? '修改密码' : 'Change password'}
          >
            <RemixIcon name="lock-password-line" size={16} />
          </button>
          <button
            onClick={onLogout}
            className="flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition-colors"
            aria-label={lang === 'zh' ? '退出登录' : 'Logout'}
            title={lang === 'zh' ? '退出登录' : 'Logout'}
          >
            <RemixIcon name="logout-box-r-line" size={16} />
          </button>
        </div>

        {/* User — 桌面端进入个人资料的唯一入口 */}
        <button
          type="button"
          onClick={() => onTabChange('profile')}
          title={zh ? '个人资料' : 'Profile'}
          className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left transition-colors ${
            activeTab === 'profile'
              ? 'bg-gray-100 dark:bg-gray-900'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900/60'
          }`}
        >
          <UserAvatar name={userName} avatar={userAvatar} size={28} />
          <span className="text-[0.8125rem] font-medium text-gray-700 dark:text-gray-300 leading-tight break-words">{userName}</span>
        </button>
      </div>

      <ChangePasswordModal open={isPwModalOpen} onClose={() => setIsPwModalOpen(false)} zh={lang === 'zh'} />

      {isChangelogOpen && (
        <ChangelogPanel lang={lang === 'zh' ? 'zh' : 'en'} audience={changelogAudience} onClose={() => setIsChangelogOpen(false)} />
      )}
    </aside>
  );
};

export default DashboardSidebar;
