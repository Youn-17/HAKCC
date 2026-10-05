import React from 'react';
import RemixIcon from '../RemixIcon';
import type { Language } from '../../types';

interface MobileCommunityProps {
  lang: Language;
  onOpenMap: () => void;
  onOpenTimeline: () => void;
  onOpenGroups: () => void;
  onOpenMembers: () => void;
  courseTitle?: string;
  noteCount: number;
  memberCount?: number;
}

const MobileCommunity: React.FC<MobileCommunityProps> = ({
  lang, onOpenMap, onOpenTimeline, onOpenGroups, onOpenMembers,
  courseTitle, noteCount, memberCount = 0,
}) => {
  const lbl = (zh: string, en: string) => lang === 'zh' ? zh : en;

  const items = [
    { icon: 'git-branch-line',   label: lbl('Build-on 网络', 'Build-on Network'), desc: lbl('追踪观点的依据、分支与汇合', 'Follow idea foundations, branches and convergences'), onClick: onOpenMap, color: 'bg-blue-50 text-blue-600' },
    { icon: 'calendar-todo-line', label: lbl('时间线', 'Timeline'),          desc: lbl('按时间查看知识建构活动', 'View KB activity over time'),       onClick: onOpenTimeline, color: 'bg-amber-50 text-amber-600' },
    { icon: 'group-2-line',       label: lbl('小组', 'Groups'),             desc: lbl('查看和管理小组', 'View and manage groups'),                  onClick: onOpenGroups,   color: 'bg-green-50 text-green-600' },
    { icon: 'team-line',          label: lbl('成员', 'Members'),            desc: lbl('查看社区成员', 'View community members'),                    onClick: onOpenMembers,  color: 'bg-purple-50 text-purple-600' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 pb-20">
      {/* Header stats */}
      <div className="bg-white px-5 pt-5 pb-4 border-b border-gray-100">
        <h2 className="text-lg font-bold text-gray-900">{courseTitle || lbl('社区', 'Community')}</h2>
        <div className="mt-3 flex gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <RemixIcon name="sticky-note-2-line" size={16} className="text-blue-600" />
            </div>
            <div>
              <div className="text-base font-bold text-gray-900">{noteCount}</div>
              <div className="text-[0.6875rem] text-gray-400">{lbl('条笔记', 'notes')}</div>
            </div>
          </div>
          {memberCount > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                <RemixIcon name="team-line" size={16} className="text-purple-600" />
              </div>
              <div>
                <div className="text-base font-bold text-gray-900">{memberCount}</div>
                <div className="text-[0.6875rem] text-gray-400">{lbl('位成员', 'members')}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Menu items */}
      <div className="px-4 pt-4 space-y-2">
        {items.map(item => (
          <button
            key={item.icon}
            onClick={item.onClick}
            className="w-full flex items-center gap-3.5 bg-white rounded-xl p-4 border border-gray-100 active:scale-[0.98] transition-transform shadow-sm"
          >
            <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${item.color}`}>
              <RemixIcon name={item.icon} size={20} />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-semibold text-gray-900">{item.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{item.desc}</div>
            </div>
            <RemixIcon name="arrow-right-s-line" size={18} className="text-gray-300" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default MobileCommunity;
