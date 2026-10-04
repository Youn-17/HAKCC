import React from 'react';
import RemixIcon from '../RemixIcon';
import type { Language } from '../../types';

export type MobileTab = 'notes' | 'agent' | 'community' | 'profile';

interface MobileTabBarProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
  lang: Language;
  unreadCount?: number;
}

const TABS: { id: MobileTab; icon: string; labelZh: string; labelEn: string }[] = [
  { id: 'notes',     icon: 'sticky-note-2-line', labelZh: '笔记',   labelEn: 'Notes' },
  { id: 'agent',     icon: 'robot-2-line',       labelZh: 'AI',     labelEn: 'AI' },
  { id: 'community', icon: 'mind-map',           labelZh: '社区',   labelEn: 'Community' },
  { id: 'profile',   icon: 'user-3-line',        labelZh: '我的',   labelEn: 'Me' },
];

const MobileTabBar: React.FC<MobileTabBarProps> = ({ active, onChange, lang, unreadCount = 0 }) => {
  const lbl = (zh: string, en: string) => lang === 'zh' ? zh : en;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur-lg safe-area-bottom">
      <div className="flex h-14 items-center justify-around px-2">
        {TABS.map(tab => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                isActive ? 'text-[#000080]' : 'text-gray-400'
              }`}
            >
              <RemixIcon name={tab.icon} size={22} />
              <span className="text-[0.6875rem] font-medium leading-none">{lbl(tab.labelZh, tab.labelEn)}</span>
              {tab.id === 'agent' && unreadCount > 0 && (
                <span className="absolute top-1 right-1/4 min-w-[16px] h-4 rounded-full bg-red-500 text-[0.6875rem] text-white flex items-center justify-center px-1 font-bold">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileTabBar;
