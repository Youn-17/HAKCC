
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Search, Filter, RefreshCw, Shield, User, Mail, AlertCircle, UserPlus } from 'lucide-react';
import { Member, Language, UserRole } from '../types';
import UserAvatar from './UserAvatar';
import { MORANDI, chipStyle } from './morandiPalette';

/** 角色与状态的色调映射。角色是分类不是优劣，同一角色在全站取同一个色。 */
const ROLE_TONE: Record<string, string> = {
  admin: MORANDI.lilac,
  teacher: MORANDI.dustyBlue,
  student: MORANDI.sage,
};
import { courseSettings, loginLogs, type LoginRecord } from '../services/apiClient';
import { LoginHistoryList, formatLoginTime } from './dashboard/LoginLogPanel';

interface MemberManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * 课程教职（创建者、课程管理员、平台管理员），按课内身份算。成员管理是教职的工具，
   * 和学生一样，在这门课里只是普通成员的教师账号打不开。
   */
  isStaff: boolean;
  lang: Language;
  courseId?: string;
}

const MemberManagementModal: React.FC<MemberManagementModalProps> = ({ isOpen, onClose, isStaff, lang, courseId }) => {
  const navigate = useNavigate();
  const [viewerStanding, setViewerStanding] = useState<'owner' | 'manager' | 'member' | 'none'>('none');
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  // 真实登录数据：最近一次 + 30 天次数；只有课程创建者/管理员拿得到
  const [loginSummary, setLoginSummary] = useState<Record<string, { lastLoginAt: string | null; count: number }>>({});
  const [historyMember, setHistoryMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<LoginRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRetention, setHistoryRetention] = useState<number | undefined>();

  const canAccess = isStaff;

  useEffect(() => {
    if (isOpen && canAccess) {
      setIsLoading(true);
      if (!courseId) {
        setMembers([]);
        setIsLoading(false);
        return;
      }
      courseSettings.listMembers(courseId)
        .then(({ members: loaded, viewerStanding: standing }) => {
          setViewerStanding(standing);
          setMembers(loaded.map(member => ({
            id: member.userId,
            name: member.name || member.email || member.userId,
            email: member.email ?? '',
            role: ['student', 'teacher', 'admin'].includes(member.role) ? member.role as UserRole : 'student',
            courseRole: member.courseRole,
            avatar: member.avatar,
            status: 'active',
            lastLogin: undefined,
          })));
          if (standing === 'owner' || standing === 'manager') {
            loginLogs.course(courseId, 30)
              .then(res => setLoginSummary(Object.fromEntries(res.members.map(m => [m.userId, { lastLoginAt: m.lastLoginAt, count: m.count }]))))
              .catch(() => setLoginSummary({}));
          }
        })
        .catch(() => setMembers([]))
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, canAccess, courseId]);

  const t = lang === 'zh' ? {
    title: '成员管理',
    subtitle: '查看与管理知识社区的成员及其角色',
    search: '搜索用户名或邮箱...',
    allRoles: '所有角色',
    name: '用户名',
    email: '邮箱',
    role: '角色',
    status: '状态',
    lastLogin: '最后登录',
    student: '学生',
    teacher: '教师',
    admin: '管理员',
    active: '活跃',
    inactive: '非活跃',
    accessDenied: '成员管理只对这门课的创建者和课程管理员开放。',
    cancel: '取消',
    manageAccess: '协作与权限',
    courseOwner: '创建者',
    courseManager: '课程管理员',
  } : {
    title: 'Member Management',
    subtitle: 'View and manage the members of this community',
    search: 'Search username or email...',
    allRoles: 'All Roles',
    name: 'Username',
    email: 'Email',
    role: 'Role',
    status: 'Status',
    lastLogin: 'Last Login',
    student: 'Student',
    teacher: 'Teacher',
    admin: 'Admin',
    active: 'Active',
    inactive: 'Inactive',
    accessDenied: 'Member management is only open to this course’s creator and course managers.',
    cancel: 'Cancel',
    manageAccess: 'Collaboration',
    courseOwner: 'Creator',
    courseManager: 'Manager',
  };

  const filteredMembers = members.filter(m => {
    if (roleFilter !== 'all' && m.role !== roleFilter) return false;
    if (searchQuery && !m.name.toLowerCase().includes(searchQuery.toLowerCase()) && !m.email.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const openHistory = (member: Member) => {
    if (!courseId) return;
    setHistoryMember(member);
    setHistory([]);
    setHistoryLoading(true);
    loginLogs.courseUser(courseId, member.id)
      .then(res => { setHistory(res.logins); setHistoryRetention(res.retentionDays); })
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  };


  if (!isOpen) return null;

  if (!canAccess) {
      return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-xl p-8 text-center shadow-xl max-w-md w-full relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                <AlertCircle size={48} className="mx-auto mb-4" style={{ color: MORANDI.rose }}/>
                <h3 className="text-lg font-bold text-gray-800 mb-2">Access Denied</h3>
                <p className="text-gray-600">{t.accessDenied}</p>
            </div>
        </div>
      );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200">
        
        {/* Header */}
        <div className="bg-white border-b border-gray-200 p-6 flex justify-between items-center">
            <div>
                <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                    <Shield size={24} style={{ color: '#000080' }} /> {t.title}
                </h2>
                <p className="text-gray-500 text-sm mt-1">{t.subtitle}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                <X size={24} />
            </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex gap-4 items-center">
            <div className="relative flex-1 max-w-md">
                <Search size={16} className="absolute left-3 top-2.5 text-gray-400"/>
                <input 
                    type="text" 
                    placeholder={t.search}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm outline-none transition-colors focus:border-[#000080]/50 focus:ring-2 focus:ring-[#000080]/10 bg-white"
                />
            </div>
            <div className="flex items-center gap-2 border border-gray-300 rounded-lg bg-white px-2">
                <Filter size={16} className="text-gray-400"/>
                <select 
                    className="py-2 text-sm bg-transparent outline-none text-gray-700"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value as any)}
                >
                    <option value="all">{t.allRoles}</option>
                    <option value="student">{t.student}</option>
                    <option value="teacher">{t.teacher}</option>
                    <option value="admin">{t.admin}</option>
                </select>
            </div>
            {/* 邀请和授权统一放在课程设置里，这里只留入口：
                权限 UI 有两份的话，改了一处忘了另一处是迟早的事 */}
            {viewerStanding === 'owner' && courseId && (
              <button
                onClick={() => navigate(`/course/${courseId}/settings?tab=access`)}
                className="px-4 py-2 bg-[#000080] text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-[#000060] active:scale-[0.98] transition-all"
              >
                <UserPlus size={16} /> {t.manageAccess}
              </button>
            )}
            <div className="flex-1 text-right text-sm text-gray-500">
                Total: <span className="font-bold text-gray-800">{filteredMembers.length}</span>
            </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto bg-white">
            {isLoading ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                    <RefreshCw className="animate-spin mr-2"/> Loading...
                </div>
            ) : (
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase sticky top-0 z-10 border-b border-gray-200">
                        <tr>
                            <th className="p-4">{t.name}</th>
                            <th className="p-4">{t.role}</th>
                            <th className="p-4">{t.email}</th>
                            <th className="p-4">{t.status}</th>
                            <th className="p-4">{t.lastLogin}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm">
                        {filteredMembers.map(member => (
                            <tr key={member.id} className="transition-colors hover:bg-stone-50">
                                <td className="p-4">
                                    <div className="flex items-center gap-3">
                                        <UserAvatar name={member.name} avatar={member.avatar} size={32} />
                                        <span className="font-medium text-gray-800">{member.name}</span>
                                    </div>
                                </td>
                                <td className="p-4">
                                    <span
                                        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium"
                                        style={chipStyle(ROLE_TONE[member.role] ?? MORANDI.stone)}
                                    >
                                        {member.role === 'admin' && <Shield size={10}/>}
                                        {member.role === 'teacher' && <User size={10}/>}
                                        {t[member.role]}
                                    </span>
                                    {member.courseRole === 'owner' && (
                                      <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                                        {t.courseOwner}
                                      </span>
                                    )}
                                    {member.courseRole === 'manager' && (
                                      <span className="ml-1.5 rounded-full bg-[#000080]/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-[#000080] dark:bg-[#93AAFD]/15 dark:text-[#93AAFD]">
                                        {t.courseManager}
                                      </span>
                                    )}
                                </td>
                                <td className="p-4 text-gray-600 flex items-center gap-2">
                                    <Mail size={14} className="text-gray-400"/> {member.email}
                                </td>
                                <td className="p-4">
                                    <span
                                        className="rounded px-2 py-0.5 text-xs font-medium"
                                        style={chipStyle(member.status === 'active' ? MORANDI.sage : MORANDI.stone)}
                                    >
                                        {t[member.status]}
                                    </span>
                                </td>
                                <td className="p-4 text-xs text-gray-600">
                                    {loginSummary[member.id] ? (
                                        <button
                                            type="button"
                                            onClick={() => openHistory(member)}
                                            className="text-left hover:underline"
                                            title={lang === 'zh' ? '查看登录明细' : 'View sign-in history'}
                                        >
                                            <div>{formatLoginTime(loginSummary[member.id].lastLoginAt, lang)}</div>
                                            <div className="text-gray-400">{lang === 'zh' ? `30 天内 ${loginSummary[member.id].count} 次` : `${loginSummary[member.id].count} in 30 d`}</div>
                                        </button>
                                    ) : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>

        {historyMember && (
            <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px] flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setHistoryMember(null); }}>
                <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full border border-gray-200 animate-in zoom-in-95 duration-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-1">{lang === 'zh' ? '登录记录' : 'Sign-in history'}</h3>
                    <p className="text-sm text-gray-500 mb-4">{historyMember.name} · {historyMember.email}</p>
                    <LoginHistoryList records={history} lang={lang} retentionDays={historyRetention} loading={historyLoading} />
                    <button
                        onClick={() => setHistoryMember(null)}
                        className="mt-4 w-full py-2 border border-gray-300 rounded-lg text-gray-600 font-bold text-sm hover:bg-gray-50"
                    >
                        {t.cancel}
                    </button>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};

export default MemberManagementModal;
