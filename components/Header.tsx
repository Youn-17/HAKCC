import { useAuth } from '../contexts/AuthContext';
import UserAvatar from './UserAvatar';

import React, { useEffect, useRef, useState } from 'react';
import { UserRole, Language, ViewDefinition, Notification } from '../types';
import { viewColor } from './viewPalette';
import { LangSwitcher2 } from './LangSwitcher';
import RemixIcon from './RemixIcon';
import ChangePasswordModal from './auth/ChangePasswordModal';
import { useDismissible } from '../hooks/useDismissible';

interface HeaderProps {
  title?: string;
  onExit?: () => void;
  userRole?: UserRole;
  userName?: string;
  onLogout?: () => void;
  lang: Language;
  setLang: (lang: Language) => void;
  views?: ViewDefinition[];
  activeViewId?: string;
  onViewSelect?: (id: string) => void;
  onOpenViewManager?: () => void;
  notifications?: Notification[];
  onNotificationClick?: (n: Notification) => void;
  isWorkspaceAgentOpen?: boolean;
  onToggleWorkspaceAgent?: () => void;
  onOpenAnalytics?: () => void;
}

const Header: React.FC<HeaderProps> = ({
  title, onExit, userRole = 'student', userName, onLogout, lang, setLang,
  views = [], activeViewId, onViewSelect, onOpenViewManager,
  notifications = [], onNotificationClick,
  isWorkspaceAgentOpen, onToggleWorkspaceAgent,
  onOpenAnalytics,
}) => {
  const displayName = userName || 'User';
  // 顶栏展示的始终是当前登录用户，直接读 auth，不必从 Workspace 一路透传
  const { user } = useAuth();

  const [isUserMenuOpen,    setIsUserMenuOpen]    = useState(false);
  const [isViewMenuOpen,    setIsViewMenuOpen]    = useState(false);
  const [isNotifMenuOpen,   setIsNotifMenuOpen]   = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const notifMenuRef = useRef<HTMLDivElement>(null);
  const [isPwModalOpen,     setIsPwModalOpen]     = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // 原来是拿一层 fixed inset-0 的透明蒙层接管点击。它能关菜单，但会把
  // 第一次点击整个吃掉——想点别的按钮得点两下。换成全局监听，一次点击
  // 既关掉菜单，也照常落到你真正点的那个东西上。
  useDismissible({ open: isViewMenuOpen, onDismiss: () => setIsViewMenuOpen(false), ref: viewMenuRef });
  useDismissible({ open: isNotifMenuOpen, onDismiss: () => setIsNotifMenuOpen(false), ref: notifMenuRef });

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!isUserMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!userMenuRef.current?.contains(target)) {
        setIsUserMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isUserMenuOpen]);

  const zh = lang === 'zh';
  const t = {
    view:          zh ? '视图' : 'View',
    analytics:     zh ? '分析' : 'Analytics',
    ai:            zh ? 'AI 助手' : 'AI Panel',
    exit:          zh ? '退出' : 'Exit',
    profile:       zh ? '个人中心' : 'Profile',
    settings:      zh ? '设置' : 'Settings',
    changePw:      zh ? '修改密码' : 'Change Password',
    logout:        zh ? '退出登录' : 'Logout',
    switchView:    zh ? '切换视图' : 'Switch View',
    manageViews:   zh ? '管理视图' : 'Manage Views',
    welcome:       zh ? '主视图' : 'Welcome',
    notifications: zh ? '消息通知' : 'Notifications',
    noNotif:       zh ? '暂无新消息' : 'No new notifications',
    role: {
      student: zh ? '学生' : 'Student',
      teacher: zh ? '教师' : 'Teacher',
      admin:   zh ? '管理员' : 'Admin',
    },
  };

  const activeViewTitle = views.find(v => v.id === activeViewId)?.title || t.welcome;

  const getNotifIcon = (type: string) => {
    switch (type) {
      case 'task':    return <RemixIcon name="alarm-warning-line" size={14} className="text-orange-500" />;
      case 'buildon': return <RemixIcon name="git-branch-line" size={14} className="text-green-500" />;
      case 'teacher': return <RemixIcon name="user-star-line" size={14} className="text-blue-500" />;
      default:        return <RemixIcon name="chat-3-line" size={14} className="text-gray-500" />;
    }
  };

  const smallCaps: React.CSSProperties = { fontVariant: 'small-caps' };

  return (
    <div className="h-11 bg-white/85 backdrop-blur-xl flex items-stretch z-30 border-b border-gray-200 dark:border-gray-800 dark:bg-gray-950/90 select-none flex-shrink-0">

      {/* ── Brand + breadcrumb ── */}
      <div className="flex items-center gap-2 px-3 border-r border-gray-200 dark:border-gray-800 min-w-0">
        <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md bg-[#000080]">
          <RemixIcon name="book-open-line" size={13} className="text-white" />
        </div>
        <div className="hidden sm:flex items-center gap-1.5 min-w-0">
          <span className="font-medium text-gray-800 text-[0.6875rem] tracking-[0.04em]">HAKCC</span>
          {title && (
            <>
              <span className="text-gray-300 text-[0.6875rem] mx-0.5">/</span>
              <span className="text-[0.6875rem] text-gray-500 font-normal truncate max-w-[24rem]">{title}</span>
            </>
          )}
        </div>
        <span className="sm:hidden text-[0.6875rem] font-medium text-gray-700">HAKCC</span>
      </div>

      <div className="flex-1" />

      {/* ── View Selector ── */}
      {onViewSelect && (
        <div ref={viewMenuRef} className="relative flex items-center">
          <button
            onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
            className="flex items-center text-xs px-3 h-full border-r border-gray-200 dark:border-gray-800 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
          >
            <span className="text-[0.6875rem] text-gray-400 tracking-[0.06em] font-mono" style={smallCaps}>view</span>
            <span className="font-medium text-[#000080] text-[0.6875rem] ml-1.5 truncate max-w-[14rem]">{activeViewTitle}</span>
            <RemixIcon name="arrow-down-s-line" size={12} className="ml-1 text-gray-400" />
          </button>
          {isViewMenuOpen && (
            <>
              <div className="absolute top-full mt-1 right-0 w-56 bg-white/95 dark:bg-gray-950/95 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 py-1 z-50 max-h-[70vh] overflow-y-auto">
                <div className="px-3 py-1.5 text-[0.6875rem] font-medium text-gray-400 tracking-[0.08em] border-b border-gray-200 dark:border-gray-800 mb-1 font-mono" style={smallCaps}>
                  {t.switchView}
                </div>
                {views.map(view => (
                  <button
                    key={view.id}
                    onClick={() => { onViewSelect(view.id); setIsViewMenuOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-900 flex items-center justify-between transition-colors
                      ${activeViewId === view.id ? 'text-[#000080] font-medium' : 'text-gray-600'}`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="h-2 w-2 flex-shrink-0 rounded-[2px]"
                        style={{ backgroundColor: viewColor(view.id) }}
                      />
                      <span className="truncate">{view.title}</span>
                    </div>
                    {activeViewId === view.id && <RemixIcon name="check-line" size={13} className="text-[#000080] flex-shrink-0" />}
                  </button>
                ))}
                {onOpenViewManager && (
                  <>
                    <div className="my-1 h-px bg-gray-200 dark:bg-gray-800" />
                    <button
                      onClick={() => { onOpenViewManager(); setIsViewMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[#000080] transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
                    >
                      <RemixIcon name="layout-left-2-line" size={13} className="text-[#000080]/60 flex-shrink-0" />
                      <span>{t.manageViews}</span>
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Analytics ── */}
      {onOpenAnalytics && (
        <button
          onClick={onOpenAnalytics}
          className="flex items-center gap-1 px-3 border-r border-gray-200 dark:border-gray-800 text-xs text-gray-600 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
          title={t.analytics}
        >
          <RemixIcon name="bar-chart-grouped-line" size={14} className="text-gray-500" />
          <span className="hidden lg:inline text-[0.6875rem] text-gray-400 tracking-[0.05em] font-mono" style={smallCaps}>{t.analytics}</span>
        </button>
      )}


      {/* ── Agent ── */}
      {onToggleWorkspaceAgent && (
        <button
          onClick={onToggleWorkspaceAgent}
          className={`flex items-center gap-1 px-3 border-r border-gray-200 dark:border-gray-800 text-xs transition-colors
            ${isWorkspaceAgentOpen
              ? 'bg-[#000080] text-white'
              : 'text-[#000080] hover:bg-gray-100 dark:hover:bg-gray-900'}`}
          title={zh ? '知识空间 AI 助手' : 'Knowledge Space AI'}
        >
          <RemixIcon name={isWorkspaceAgentOpen ? 'sparkling-2-fill' : 'sparkling-2-line'} size={14} />
          <span className="hidden lg:inline text-[0.6875rem] tracking-[0.05em] font-mono font-medium" style={smallCaps}>{zh ? '助手' : 'agent'}</span>
        </button>
      )}

      {/* ── Notifications ── */}
      <div ref={notifMenuRef} className="relative flex items-center">
        <button
          onClick={() => setIsNotifMenuOpen(!isNotifMenuOpen)}
          className="relative flex items-center justify-center w-10 h-full border-l border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
        >
          <RemixIcon name="notification-3-line" size={15} className="text-gray-500" />
          {unreadCount > 0 && (
            <span className="absolute top-2 right-2.5 w-[6px] h-[6px] bg-[#C27C7C] rounded-full border-[1.5px] border-white" />
          )}
        </button>
        {isNotifMenuOpen && (
          <>
            <div className="absolute top-full mt-1 right-0 w-80 bg-white/95 dark:bg-gray-950/95 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 z-50 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
                <span className="font-medium text-sm text-gray-700">{t.notifications}</span>
                {unreadCount > 0 && (
                  <span className="bg-[#C27C7C]/10 text-[#C27C7C] text-[0.6875rem] font-medium px-2 py-0.5 rounded-md">{unreadCount} new</span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">{t.noNotif}</div>
                ) : (
                  notifications.map(n => (
                    <div
                      key={n.id}
                      onClick={() => { onNotificationClick?.(n); setIsNotifMenuOpen(false); }}
                      className={`p-3.5 border-b border-gray-200 dark:border-gray-800/50 hover:bg-black/[0.02] cursor-pointer flex gap-3 transition-colors ${!n.read ? 'bg-[#000080]/[0.02]' : ''}`}
                    >
                      <div className="mt-0.5 p-1.5 bg-white border border-gray-200 dark:border-gray-700 rounded-lg h-fit">
                        {getNotifIcon(n.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <span className={`text-xs ${!n.read ? 'font-medium text-gray-800' : 'text-gray-600'}`}>{n.title}</span>
                          <span className="text-[0.6875rem] text-gray-400 whitespace-nowrap font-mono">{n.createdAt.split(' ')[1]}</span>
                        </div>
                        <p className="text-[0.6875rem] text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                      </div>
                      {!n.read && <div className="w-[6px] h-[6px] bg-[#000080] rounded-full mt-1 flex-shrink-0" />}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Language ── */}
      <LangSwitcher2 value={lang as 'zh' | 'en'} onChange={v => setLang(v as Language)} />

      {/* ── User profile ── */}
      <div ref={userMenuRef} className="relative flex items-center">
        <button
          onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
          className="flex items-center gap-1.5 h-full cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-900 px-3 border-l border-gray-200 dark:border-gray-800 transition-colors"
        >
          <UserAvatar name={displayName} avatar={user?.avatar} size={24} />
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-[0.6875rem] font-medium text-gray-700">{displayName}</span>
            <span className="text-[0.6875rem] text-gray-400 font-mono tracking-[0.05em]" style={smallCaps}>{t.role[userRole]}</span>
          </div>
          <RemixIcon name="arrow-down-s-line" size={11} className="text-gray-400" />
        </button>

        {isUserMenuOpen && (
            <div className="absolute top-full mt-1 right-0 w-44 bg-white/95 dark:bg-gray-950/95 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 py-1 z-50">
              <button className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-900 flex items-center gap-2">
                <RemixIcon name="user-3-line" size={13} className="text-gray-400" /> {t.profile}
              </button>
              <button
                onClick={() => { setIsPwModalOpen(true); setIsUserMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-900 flex items-center gap-2"
              >
                <RemixIcon name="lock-password-line" size={13} className="text-gray-400" /> {t.changePw}
              </button>
              <div className="h-px bg-gray-200 dark:bg-gray-800 my-1" />
              <button
                onClick={() => { onLogout?.(); setIsUserMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs text-[#C27C7C] hover:bg-[#C27C7C]/[0.04] flex items-center gap-2 font-medium"
              >
                <RemixIcon name="logout-box-r-line" size={13} /> {t.logout}
              </button>
            </div>
        )}
      </div>

      <ChangePasswordModal open={isPwModalOpen} onClose={() => setIsPwModalOpen(false)} zh={zh} />

    </div>
  );
};

export default Header;
