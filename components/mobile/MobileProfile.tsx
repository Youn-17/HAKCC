import React from 'react';
import RemixIcon from '../RemixIcon';
import type { Language, UserRole } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import UserAvatar from '../UserAvatar';

interface MobileProfileProps {
  lang: Language;
  userRole: UserRole;
  userName?: string;
  userEmail?: string;
  onLogout: () => void;
  onExitCourse: () => void;
  courseTitle?: string;
}

const MobileProfile: React.FC<MobileProfileProps> = ({
  lang, userRole, userName, userEmail, onLogout, onExitCourse, courseTitle,
}) => {
  const lbl = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const roleLabel = userRole === 'teacher' ? lbl('教师', 'Teacher') : lbl('学生', 'Student');
  // 展示的是当前登录用户，直接读 auth 拿头像
  const { user } = useAuth();

  return (
    <div className="flex flex-col h-full bg-gray-50 pb-20">
      {/* Profile card */}
      <div className="bg-white px-5 pt-6 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-4">
          <UserAvatar name={userName || userEmail} avatar={user?.avatar} size={56} />
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-gray-900 truncate">{userName || userEmail}</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold bg-[#000080]/10 text-[#000080]">{roleLabel}</span>
              {courseTitle && <span className="text-xs text-gray-400 truncate">{courseTitle}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Menu */}
      <div className="px-4 pt-4 space-y-2">
        <button
          onClick={onExitCourse}
          className="w-full flex items-center gap-3.5 bg-white rounded-xl p-4 border border-gray-100 active:scale-[0.98] transition-transform shadow-sm"
        >
          <div className="shrink-0 w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <RemixIcon name="logout-box-r-line" size={20} className="text-amber-600" />
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-semibold text-gray-900">{lbl('退出社区', 'Exit Community')}</div>
            <div className="text-xs text-gray-400 mt-0.5">{lbl('返回课程列表', 'Back to course list')}</div>
          </div>
          <RemixIcon name="arrow-right-s-line" size={18} className="text-gray-300" />
        </button>

        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3.5 bg-white rounded-xl p-4 border border-gray-100 active:scale-[0.98] transition-transform shadow-sm"
        >
          <div className="shrink-0 w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
            <RemixIcon name="shut-down-line" size={20} className="text-red-500" />
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-semibold text-red-600">{lbl('退出登录', 'Sign Out')}</div>
            <div className="text-xs text-gray-400 mt-0.5">{lbl('退出当前账号', 'Sign out of your account')}</div>
          </div>
        </button>
      </div>
    </div>
  );
};

export default MobileProfile;
