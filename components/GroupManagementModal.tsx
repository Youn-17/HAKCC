import UserAvatar from './UserAvatar';
import { MORANDI, chipStyle, ink, noticeStyle, shade } from './morandiPalette';
import type { GroupTaskStats } from '../services/apiClient';

/**
 * 实验分组的三种条件走莫兰迪三色：处理组雾青、对照组暖赭、未分配中性灰。
 * 之前是 emerald / amber / zinc 三个不同色系混在一起。
 */
const CONDITION_TONE: Record<string, string> = {
  treatment: MORANDI.sage,
  control: MORANDI.ochre,
  none: MORANDI.stone,
};
const SSRL_PHASE_TONE: Record<string, string> = {
  planning: MORANDI.dustyBlue,
  monitoring: MORANDI.ochre,
  evaluating: MORANDI.sage,
};
const TASK_STATUS_TONE: Record<string, string> = {
  done: MORANDI.sage,
  in_progress: MORANDI.ochre,
  todo: MORANDI.stone,
};

import React, { useState, useEffect } from 'react';
import { 
  X, Users, UserPlus, User, Crown, CheckCircle, Circle, 
  Clock, BarChart2, Move, ListTodo, Target, RefreshCw, 
  AlertCircle, Plus, Trash2, FileText, ArrowRight
} from 'lucide-react';
import { Group, GroupTask, Member, UserRole, Language, SSRLPhase } from '../types';
import { ai as aiApi, courseSettings, courses as coursesApi, groups as groupsApi, trackEvent } from '../services/apiClient';
import type { ApiGroupTask } from '../services/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { taskBoardGroup } from './courseStanding';

interface GroupManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * 课程教职（平台管理员、创建者、课程管理员），按课内身份算。建组、分组、实验条件、逐组看任务板
   * 都只给他们；凭学生验证码入课的教师账号在这门课里是普通成员，看到的和学生一样。
   */
  isStaff: boolean;
  lang: Language;
  courseId?: string;
  onTaskCreate?: (task: GroupTask) => void; // Callback for notification generation
  spaceId?: string;
}

const TASK_STATUS_ORDER: GroupTask['status'][] = ['todo', 'in_progress', 'done'];

function apiTaskToTask(t: ApiGroupTask): GroupTask {
  return {
    id: t.id,
    groupId: t.groupId,
    title: t.title,
    description: t.description,
    assignedToId: t.assignedToId ?? '',
    createdById: t.createdById,
    status: t.status,
    ssrlPhase: t.ssrlPhase,
    createdAt: t.createdAt,
  };
}

const GroupManagementModal: React.FC<GroupManagementModalProps> = ({ isOpen, onClose, isStaff, lang, courseId, onTaskCreate, spaceId }) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'analytics' | 'experiment'>('overview');
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<GroupTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Teacher: Create/Edit
  const [newGroupName, setNewGroupName] = useState('');
  const [draggedMemberId, setDraggedMemberId] = useState<string | null>(null);
  const [isCreatingSpaces, setIsCreatingSpaces] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState('');

  // 分析页：任务板的真实分布，进标签页时才拉
  const [taskStats, setTaskStats] = useState<GroupTaskStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  useEffect(() => {
    if (!isOpen || activeTab !== 'analytics' || !courseId) return;
    let cancelled = false;
    setStatsLoading(true);
    groupsApi.taskStats(courseId)
      .then(data => { if (!cancelled) setTaskStats(data); })
      .catch(() => { if (!cancelled) setTaskStats(null); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, activeTab, courseId]);

  // Teacher: Experiment settings
  const [experimentMode, setExperimentMode] = useState<boolean | null>(null);
  const [memberOverrides, setMemberOverrides] = useState<Record<string, 'treatment' | 'control' | null>>({});

  // Student: Task Creation
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState<string>('');
  const [newTaskPhase, setNewTaskPhase] = useState<SSRLPhase>('planning');
  const [isSavingTask, setIsSavingTask] = useState(false);
  /** 状态正在往服务器存的任务。存完之前不接受第二次点击，免得两次请求先后颠倒 */
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(new Set());
  const [taskError, setTaskError] = useState('');

  const currentUserId = user?.id ?? 's1';
  /** 课程教职在任务板上选看的组；普通成员没得选，只看自己的组 */
  const [pickedGroupId, setPickedGroupId] = useState<string | null>(null);
  const boardGroup = taskBoardGroup(groups, currentUserId, isStaff, pickedGroupId);
  const boardGroupId = boardGroup?.id ?? null;

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);

    const loadGroups = courseId
      ? groupsApi.listForCourse(courseId).then(({ groups: g }) =>
          g.map(ag => ({
            id: ag.id,
            name: ag.name,
            courseId: ag.courseId,
            leaderId: ag.leaderId,
            color: ag.color,
            aiFeedbackCondition: ag.aiFeedbackCondition ?? null,
            memberIds: ag.memberIds,
            members: ag.members,
          } as Group & { members?: typeof ag.members })),
        )
      : Promise.resolve([] as Group[]);

    const loadMembers = courseId
      ? courseSettings.listMembers(courseId).then(({ members }) => {
          setMemberOverrides(Object.fromEntries(members.map(m => [m.userId, m.aiFeedbackCondition ?? null])));
          return members.map(member => ({
            id: member.userId,
            name: member.name || member.email || member.userId,
            email: member.email ?? '',
            role: ['student', 'teacher', 'admin'].includes(member.role) ? member.role as UserRole : 'student',
            avatar: member.avatar,
            status: 'active' as const,
            lastLogin: member.joinedAt,
          } as Member));
        })
      : Promise.resolve([] as Member[]);

    if (courseId && isStaff) {
      aiApi.getTriggerSettings(courseId)
        .then(({ settings }) => setExperimentMode(settings.experiment_mode === true))
        .catch(() => setExperimentMode(false));
    }

    Promise.all([loadGroups, loadMembers])
      .then(([gData, mData]) => {
        setGroups(gData);
        const backendMembers = gData.flatMap((group: any) =>
          ((group.members ?? []) as Array<{ id: string; name?: string; avatar?: string | null }>).map(member => ({
            id: member.id,
            name: member.name || member.id,
            email: '',
            role: 'student' as const,
            avatar: member.avatar ?? undefined,
            status: 'active' as const,
          })),
        );
        // 课程成员接口里的身份为准：小组接口带回的成员一律当学生，放后面会把组里教师的身份盖掉
        const memberMap = new Map<string, Member>();
        [...backendMembers, ...mData].forEach(member => {
          memberMap.set(member.id, member);
        });
        setMembers(Array.from(memberMap.values()));
      })
      .catch(() => { /* API unavailable — stay empty */ })
      .finally(() => setIsLoading(false));
  }, [isOpen, isStaff, courseId]);

  // 任务板只取正在看的那个组。后端只给本组成员和课程教职（ensureGroupAccess）；
  // 原先教师账号一律取第一个组，凭学生验证码入课的教师不在那个组，拿到的就是 403。
  useEffect(() => {
    setTasks([]);
    setTaskError('');
    if (!isOpen || !boardGroupId) return;
    let cancelled = false;
    groupsApi.listTasks(boardGroupId)
      .then(({ tasks: rows }) => { if (!cancelled) setTasks(rows.map(apiTaskToTask)); })
      .catch(() => { /* 拿不到就显示空板 */ });
    return () => { cancelled = true; };
  }, [isOpen, boardGroupId]);

  const t = lang === 'zh' ? {
    title: 'Group 创建与管理',
    tabs: { overview: '小组概览', tasks: '协作任务 (SSRL)', analytics: '分析' },
    create: '创建新小组',
    groupName: '小组名称',
    unassigned: '待分配',
    unassignedStudents: '学生',
    unassignedTeachers: '教师',
    teacherTag: '教师',
    leader: '组长',
    setLeader: '设为组长',
    members: '成员',
    tasks: '任务板',
    phases: { planning: '计划 (Planning)', monitoring: '监控 (Monitoring)', evaluating: '评估 (Evaluating)' },
    addTask: '添加任务',
    analyticsTitle: '协作模式分析',
    analyticsEmpty: '任务板上还没有任何任务。学生在「协作任务 (SSRL)」中创建任务之后，这里会按计划、监控、评估三个阶段显示真实分布。',
    analyticsSub: (n: number, g: number) => `共 ${n} 条任务，来自 ${g} 个小组。百分比按阶段占比计算。`,
    taskCount: (n: number) => `${n} 条`,
    doneCount: (n: number) => `完成 ${n}`,
    byGroup: '各小组的阶段分布',
    noGroup: '您尚未加入任何小组',
    dragHint: '拖拽学生到小组',
    delete: '删除',
    condition: 'AI反馈',
    conditionTreatment: '实验组',
    conditionControl: '对照组',
    conditionNone: '未分配',
    createGroupSpaces: '为每组建空间',
    groupSpacesHint: '为每个小组创建专属知识空间(组间隔离)',
    tabExperiment: '实验设置',
    expModeTitle: '实验模式',
    expModeDesc: '开启后:学生只能在小组专属空间发布笔记;未分配条件的学生默认不接收 AI 自动反馈(白名单制);共享空间不投递任何自动反馈。主动求助不受影响。',
    expModeOn: '已开启',
    expModeOff: '已关闭',
    overrideTitle: '个人反馈开关(优先于小组条件)',
    overrideDesc: '默认跟随所在小组的条件;此处可对单个学生强制开启或关闭 AI 自动反馈。',
    followGroup: '跟随小组',
    forceOn: '强制开',
    forceOff: '强制关',
    inGroup: '所在小组',
    noGroupLabel: '未入组',
    assign: '分配给',
    description: '任务描述',
    titlePlaceholder: '任务标题',
    descPlaceholder: '具体任务内容...',
    saveTask: '发布任务',
    savingTask: '发布中…',
    cancel: '取消',
    status: { todo: '待办', in_progress: '进行中', done: '完成' },
    noLeader: '尚未指定',
    boardGroup: '查看小组',
    noGroups: '这门课还没有小组',
    taskSaveFailed: '任务没有保存成功，请再试一次。',
    taskStatusFailed: '任务状态没有改成功，已恢复原状态，请再试一次。',
  } : {
    title: 'Group Management',
    tabs: { overview: 'Overview', tasks: 'Collaboration (SSRL)', analytics: 'Analytics' },
    create: 'Create Group',
    groupName: 'Group Name',
    unassigned: 'Not in a group',
    unassignedStudents: 'Students',
    unassignedTeachers: 'Teachers',
    teacherTag: 'Teacher',
    leader: 'Leader',
    setLeader: 'Make Leader',
    members: 'Members',
    tasks: 'Task Board',
    phases: { planning: 'Planning', monitoring: 'Monitoring', evaluating: 'Evaluating' },
    addTask: 'Add Task',
    analyticsTitle: 'Collaboration Patterns',
    analyticsEmpty: 'No tasks on the board yet. Once students create tasks under Collaboration (SSRL), the real distribution across planning, monitoring and evaluating appears here.',
    analyticsSub: (n: number, g: number) => `${n} task${n === 1 ? '' : 's'} across ${g} group${g === 1 ? '' : 's'}. Percentages are each phase's share.`,
    taskCount: (n: number) => `${n} task${n === 1 ? '' : 's'}`,
    doneCount: (n: number) => `${n} done`,
    byGroup: 'Phase distribution by group',
    noGroup: 'You are not in a group',
    dragHint: 'Drag students to groups',
    delete: 'Delete',
    condition: 'AI Feedback',
    conditionTreatment: 'Treatment',
    conditionControl: 'Control',
    conditionNone: 'Unassigned',
    createGroupSpaces: 'Create Group Spaces',
    groupSpacesHint: 'Create one private knowledge space per group (isolated between groups)',
    tabExperiment: 'Experiment',
    expModeTitle: 'Experiment Mode',
    expModeDesc: 'When on: students can only post in group-bound spaces; unassigned students receive no proactive AI feedback (allowlist); shared spaces get no proactive delivery. On-demand help is unaffected.',
    expModeOn: 'ON',
    expModeOff: 'OFF',
    overrideTitle: 'Individual Feedback Override (beats group condition)',
    overrideDesc: 'Defaults to the group\'s condition; force proactive AI feedback on or off per student here.',
    followGroup: 'Follow group',
    forceOn: 'Force on',
    forceOff: 'Force off',
    inGroup: 'Group',
    noGroupLabel: 'No group',
    assign: 'Assign To',
    description: 'Description',
    titlePlaceholder: 'Task Title',
    descPlaceholder: 'Task details...',
    saveTask: 'Publish Task',
    savingTask: 'Publishing…',
    cancel: 'Cancel',
    status: { todo: 'To Do', in_progress: 'In Progress', done: 'Done' },
    noLeader: 'Not set',
    boardGroup: 'Group',
    noGroups: 'No groups in this course yet',
    taskSaveFailed: 'The task was not saved. Please try again.',
    taskStatusFailed: 'The status change was not saved and has been undone. Please try again.',
  };

  // --- Handlers ---

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name || isCreatingGroup) return;
    if (!courseId) {
      setGroupError(lang === 'zh' ? '未指定课程，无法创建小组。' : 'No course selected.');
      return;
    }
    setIsCreatingGroup(true);
    setGroupError('');
    try {
      const { group } = await groupsApi.create(courseId, { name });
      setGroups(prev => [...prev, {
        id: group.id,
        name: group.name,
        courseId: group.courseId,
        leaderId: group.leaderId,
        color: group.color,
        aiFeedbackCondition: group.aiFeedbackCondition ?? null,
        memberIds: group.memberIds ?? [],
      }]);
      setNewGroupName('');
      if (spaceId) trackEvent({ event_type: 'group_created', object_type: 'group', object_id: group.id, space_id: spaceId });
    } catch (err) {
      console.error('Failed to create group', err);
      const detail = err instanceof Error ? err.message : '';
      setGroupError(lang === 'zh'
        ? `创建小组失败${detail ? `：${detail}` : '，请重试。'}`
        : `Failed to create group${detail ? `: ${detail}` : '. Please try again.'}`);
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!window.confirm(lang === 'zh' ? '确定删除该小组?' : 'Delete this group?')) return;
    try {
      await groupsApi.delete(groupId);
      setGroups(prev => prev.filter(g => g.id !== groupId));
    } catch (err) {
      console.error('Failed to delete group', err);
    }
  };

  const handleDropMember = async (groupId: string) => {
    if (!draggedMemberId) return;
    const memberId = draggedMemberId;
    setDraggedMemberId(null);

    const oldGroup = groups.find(g => g.memberIds.includes(memberId));
    if (oldGroup?.id === groupId) return;

    try {
      if (oldGroup) await groupsApi.removeMember(oldGroup.id, memberId);
      await groupsApi.addMembers(groupId, [memberId]);
      setGroups(prev => prev.map(g => {
        const without = g.memberIds.filter(id => id !== memberId);
        return g.id === groupId
          ? { ...g, memberIds: [...without, memberId] }
          : { ...g, memberIds: without };
      }));
    } catch (err) {
      console.error('Failed to move member', err);
      alert(lang === 'zh' ? '移动成员失败,请重试' : 'Failed to move member');
    }
  };

  const handleSetLeader = async (groupId: string, memberId: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, leaderId: memberId } : g));
    try {
      await groupsApi.update(groupId, { leader_id: memberId });
    } catch (err) {
      console.error('Failed to set leader', err);
    }
  };

  const handleSetCondition = async (groupId: string, condition: 'treatment' | 'control' | null) => {
    const prev = groups.find(g => g.id === groupId)?.aiFeedbackCondition ?? null;
    setGroups(gs => gs.map(g => g.id === groupId ? { ...g, aiFeedbackCondition: condition } : g));
    try {
      await groupsApi.update(groupId, { ai_feedback_condition: condition });
    } catch (err) {
      console.error('Failed to set condition', err);
      setGroups(gs => gs.map(g => g.id === groupId ? { ...g, aiFeedbackCondition: prev } : g));
      alert(lang === 'zh' ? '设置实验条件失败' : 'Failed to set condition');
    }
  };

  const handleToggleExperimentMode = async () => {
    if (!courseId || experimentMode === null) return;
    const next = !experimentMode;
    setExperimentMode(next);
    try {
      await aiApi.updateTriggerSettings(courseId, { experiment_mode: next });
    } catch (err) {
      console.error('Failed to toggle experiment mode', err);
      setExperimentMode(!next);
      alert(lang === 'zh' ? '切换实验模式失败' : 'Failed to toggle experiment mode');
    }
  };

  const handleSetMemberOverride = async (userId: string, condition: 'treatment' | 'control' | null) => {
    if (!courseId) return;
    const prev = memberOverrides[userId] ?? null;
    setMemberOverrides(o => ({ ...o, [userId]: condition }));
    try {
      await courseSettings.setMemberFeedbackCondition(courseId, userId, condition);
    } catch (err) {
      console.error('Failed to set member condition', err);
      setMemberOverrides(o => ({ ...o, [userId]: prev }));
      alert(lang === 'zh' ? '设置个人条件失败' : 'Failed to set member condition');
    }
  };

  const handleCreateGroupSpaces = async () => {
    if (!courseId || isCreatingSpaces) return;
    setIsCreatingSpaces(true);
    try {
      const { created, message } = await coursesApi.createGroupSpaces(courseId);
      alert(lang === 'zh'
        ? (created.length > 0 ? `已为 ${created.length} 个小组创建专属空间` : '每个小组都已有专属空间')
        : (created.length > 0 ? `Created ${created.length} group spaces` : (message ?? 'All groups already have spaces')));
    } catch (err) {
      console.error('Failed to create group spaces', err);
      alert(lang === 'zh' ? '创建小组空间失败' : 'Failed to create group spaces');
    } finally {
      setIsCreatingSpaces(false);
    }
  };

  /** 新任务默认分给自己；课程教职看的是别的组，自己不在名单里，就分给组里第一个人 */
  const openTaskForm = () => {
    if (!boardGroup) return;
    setNewTaskAssignee(boardGroup.memberIds.includes(currentUserId) ? currentUserId : (boardGroup.memberIds[0] ?? ''));
    setTaskError('');
    setIsAddingTask(true);
  };

  // 任务原先只加在本地状态里、从不发请求，刷新就没了，研究数据里也没有这些任务。
  const handleAddTask = async () => {
    const title = newTaskTitle.trim();
    if (!title || !boardGroup || isSavingTask) return;
    const groupId = boardGroup.id;
    const description = newTaskDescription.trim();
    const assignee = boardGroup.memberIds.includes(newTaskAssignee) ? newTaskAssignee : '';
    setIsSavingTask(true);
    setTaskError('');
    try {
      const { task } = await groupsApi.createTask(groupId, {
        title,
        description: description || undefined,
        assigned_to_id: assignee || undefined,
        ssrl_phase: newTaskPhase,
      });
      const created: GroupTask = {
        id: task.id,
        groupId,
        title,
        description,
        assignedToId: assignee,
        createdById: currentUserId,
        status: 'todo',
        ssrlPhase: newTaskPhase,
        createdAt: new Date().toISOString(),
      };
      setTasks(prev => [...prev, created]);
      onTaskCreate?.(created);
      if (spaceId) trackEvent({ event_type: 'group_task_created', object_type: 'group_task', object_id: created.id, space_id: spaceId });
      setNewTaskTitle('');
      setNewTaskDescription('');
      setIsAddingTask(false);
    } catch (err) {
      console.error('Failed to create task', err);
      setTaskError(t.taskSaveFailed);
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleCycleTaskStatus = async (task: GroupTask) => {
    if (busyTaskIds.has(task.id)) return;
    const from = task.status;
    const to = TASK_STATUS_ORDER[(TASK_STATUS_ORDER.indexOf(from) + 1) % TASK_STATUS_ORDER.length];
    const setStatus = (status: GroupTask['status']) =>
      setTasks(prev => prev.map(item => (item.id === task.id ? { ...item, status } : item)));
    const setBusy = (busy: boolean) => setBusyTaskIds(prev => {
      const next = new Set(prev);
      if (busy) next.add(task.id); else next.delete(task.id);
      return next;
    });

    setStatus(to);
    setBusy(true);
    setTaskError('');
    try {
      await groupsApi.updateTask(task.groupId, task.id, { status: to });
      if (spaceId) {
        trackEvent({
          event_type: 'group_task_status_changed',
          object_type: 'group_task',
          object_id: task.id,
          space_id: spaceId,
          metadata_json: { from, to, group_id: task.groupId },
        });
      }
    } catch (err) {
      console.error('Failed to update task status', err);
      setStatus(from);
      setTaskError(t.taskStatusFailed);
    } finally {
      setBusy(false);
    }
  };

  // --- Renderers ---

  const renderTeacherOverview = () => {
    const unassigned = members.filter(m => !groups.some(g => g.memberIds.includes(m.id)));
    const unassignedStudents = unassigned.filter(m => m.role === 'student');
    // 教师也可以进小组（和学生一起讨论、带组）。单列在学生下面，拖不拖由老师定
    const unassignedTeachers = unassigned.filter(m => m.role === 'teacher');
    const candidate = (m: Member) => (
      <div
        key={m.id}
        draggable
        onDragStart={() => setDraggedMemberId(m.id)}
        className="flex cursor-grab items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 transition-colors duration-200 hover:border-[#000080]/30 hover:bg-zinc-50 active:cursor-grabbing"
      >
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[0.6875rem] font-semibold text-zinc-600">
          {m.name.charAt(0)}
        </div>
        <span className="truncate text-[0.8125rem] text-zinc-700">{m.name}</span>
      </div>
    );

    return (
      <div className="flex h-full gap-6">
        {/* Left: Groups */}
        <div className="flex-1 overflow-y-auto space-y-4">
           <div className="mb-5 flex flex-wrap items-center gap-2">
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGroup(); }}
                placeholder={t.groupName}
                aria-label={t.groupName}
                className="min-w-[220px] flex-1 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 transition-colors focus:border-[#000080]/40 focus:outline-none focus:ring-2 focus:ring-[#000080]/10"
              />
              {/* Disabled until a name is typed — the button used to look
                  clickable but silently did nothing, which reads as "broken". */}
              <button
                onClick={handleCreateGroup}
                disabled={!newGroupName.trim() || isCreatingGroup}
                title={!newGroupName.trim() ? (lang === 'zh' ? '请先输入小组名称' : 'Enter a group name first') : undefined}
                className="flex items-center gap-1.5 rounded-xl bg-[#000080] px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#000080]/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
              >
                <Plus size={15} />
                {isCreatingGroup ? (lang === 'zh' ? '创建中…' : 'Creating…') : t.create}
              </button>
              <button
                onClick={handleCreateGroupSpaces}
                disabled={isCreatingSpaces || groups.length === 0}
                className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-all duration-200 hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:text-zinc-300"
                title={t.groupSpacesHint}
              >
                <Target size={15} />
                {isCreatingSpaces ? (lang === 'zh' ? '创建中…' : 'Creating…') : t.createGroupSpaces}
              </button>
           </div>

           {groupError && (
             <div className="mb-4 rounded-xl border px-3.5 py-2.5 text-xs" style={noticeStyle(MORANDI.rose)}>
               {groupError}
             </div>
           )}

           <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {groups.map(group => (
                <div
                  key={group.id}
                  className="group/card rounded-2xl border border-zinc-200 bg-white p-5 transition-colors duration-200 hover:border-zinc-300"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropMember(group.id)}
                >
                   <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-[0.9375rem] font-semibold tracking-tight text-zinc-950">{group.name}</h3>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {group.memberIds.length} {lang === 'zh' ? '名成员' : (group.memberIds.length === 1 ? 'member' : 'members')}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteGroup(group.id)}
                        title={t.delete}
                        aria-label={`${t.delete} ${group.name}`}
                        className="rounded-lg p-1.5 text-zinc-300 opacity-0 transition-all duration-200 focus:opacity-100 group-hover/card:opacity-100"
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = shade(MORANDI.rose, 0.9); e.currentTarget.style.color = ink(MORANDI.rose, 0.45); }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; }}
                      >
                        <Trash2 size={14}/>
                      </button>
                   </div>

                   {/* Experiment condition (cluster-randomized AI feedback trial) */}
                   <div className="mb-4 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[0.6875rem] font-medium text-zinc-400">{t.condition}</span>
                      {([['treatment', t.conditionTreatment], ['control', t.conditionControl], [null, t.conditionNone]] as const).map(([value, label]) => (
                        <button
                          key={String(value)}
                          onClick={() => handleSetCondition(group.id, value)}
                          className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors duration-200 ${
                            (group.aiFeedbackCondition ?? null) === value
                              ? ''
                              : 'border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300 hover:text-zinc-600'
                          }`}
                          style={
                            (group.aiFeedbackCondition ?? null) === value
                              ? chipStyle(CONDITION_TONE[value ?? 'none'])
                              : undefined
                          }
                        >
                          {label}
                        </button>
                      ))}
                   </div>

                   <div className="min-h-[104px] space-y-1.5 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-2.5">
                      {group.memberIds.length === 0 && <div className="py-6 text-center text-xs text-zinc-400">{t.dragHint}</div>}
                      {group.memberIds.map(mid => {
                        const mem = members.find(m => m.id === mid);
                        return (
                          <div key={mid} className="group/row flex items-center justify-between rounded-lg border border-zinc-100 bg-white px-2.5 py-2 text-[0.8125rem] text-zinc-700">
                             <div className="flex min-w-0 items-center gap-2">
                                {group.leaderId === mid && <Crown size={13} className="flex-shrink-0" style={{ color: MORANDI.ochre }}/>}
                                <span className="truncate">{mem?.name}</span>
                                {mem?.role === 'teacher' && (
                                  <span className="flex-shrink-0 rounded-full border px-1.5 text-[0.625rem] font-semibold leading-4" style={chipStyle(MORANDI.lilac)}>{t.teacherTag}</span>
                                )}
                             </div>
                             {group.leaderId !== mid && (
                               <button onClick={() => handleSetLeader(group.id, mid)} className="text-xs text-[#000080] hover:underline opacity-0 group-hover:opacity-100 transition-opacity">{t.setLeader}</button>
                             )}
                          </div>
                        );
                      })}
                   </div>
                </div>
              ))}
           </div>
        </div>

        {/* Right: Unassigned */}
        <div className="flex w-64 flex-shrink-0 flex-col border-l border-zinc-200 pl-6">
           <div className="mb-3">
             <h3 className="text-[0.8125rem] font-semibold tracking-tight text-zinc-900">{t.unassigned}</h3>
             <p className="mt-0.5 text-xs text-zinc-500">
               {unassignedStudents.length + unassignedTeachers.length} {lang === 'zh' ? '人 · 拖到左侧小组' : 'left · drag into a group'}
             </p>
           </div>
           <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              <div>
                <div className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-400">
                  {t.unassignedStudents} · {unassignedStudents.length}
                </div>
                <div className="space-y-1.5">
                  {unassignedStudents.map(candidate)}
                  {unassignedStudents.length === 0 && (
                    <div className="py-3 text-center text-xs text-zinc-400">
                      {lang === 'zh' ? '所有学生都已分组' : 'Every student has a group'}
                    </div>
                  )}
                </div>
              </div>
              {unassignedTeachers.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-400">
                    {t.unassignedTeachers} · {unassignedTeachers.length}
                  </div>
                  <div className="space-y-1.5">{unassignedTeachers.map(candidate)}</div>
                </div>
              )}
           </div>
        </div>
      </div>
    );
  };

  const renderTaskBoard = () => {
    if (!boardGroup) return <div className="flex flex-col items-center justify-center h-full text-gray-400"><AlertCircle size={48} className="mb-2"/><p>{isStaff ? t.noGroups : t.noGroup}</p></div>;

    return (
      <div className="flex h-full gap-6">
         {/* Members & Leader */}
         <div className="w-64 border-r border-gray-200 pr-6 flex flex-col">
            {isStaff && groups.length > 1 && (
              <label className="mb-4 block">
                <span className="mb-1.5 block text-xs font-medium text-zinc-500">{t.boardGroup}</span>
                <select
                  value={boardGroup.id}
                  onChange={(e) => { setPickedGroupId(e.target.value); setIsAddingTask(false); }}
                  className="min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 transition-colors focus:border-[#000080]/40 focus:outline-none focus:ring-2 focus:ring-[#000080]/10"
                >
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
            <div className="mb-6 rounded-xl border border-[#000080]/15 bg-[#000080]/[0.05] p-4">
               <h3 className="mb-1 text-lg font-bold text-[#000080]">{boardGroup.name}</h3>
               <div className="flex items-center gap-1 text-xs text-[#000080]/70"><Crown size={12}/> {t.leader}: {members.find(m => m.id === boardGroup.leaderId)?.name || t.noLeader}</div>
            </div>

            <h4 className="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wide">{t.members}</h4>
            <div className="space-y-2 flex-1 overflow-y-auto">
               {boardGroup.memberIds.map(mid => {
                 const mem = members.find(m => m.id === mid);
                 return (
                   <div key={mid} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
                      <UserAvatar name={mem?.name} avatar={mem?.avatar} size={32} />
                      <span className="text-sm font-medium text-gray-700">{mem?.name} {mid === currentUserId && '(You)'}</span>
                      {boardGroup.leaderId === mid && <Crown size={14} className="ml-auto" style={{ color: MORANDI.ochre }}/>}
                   </div>
                 );
               })}
            </div>
         </div>

         {/* SSRL Task Board */}
         <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-4">
               <h3 className="font-bold text-gray-800 flex items-center gap-2"><ListTodo size={20}/> {t.tasks}</h3>
               <button
                  onClick={() => (isAddingTask ? setIsAddingTask(false) : openTaskForm())}
                  className="flex items-center gap-2 rounded bg-[#000080] px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
               >
                  <Plus size={14}/> {t.addTask}
               </button>
            </div>

            {taskError && (
              <div className="mb-4 rounded-xl border px-3.5 py-2.5 text-xs" style={noticeStyle(MORANDI.rose)}>
                {taskError}
              </div>
            )}

            {/* Detailed Add Task Form */}
            {isAddingTask && (
               <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm animate-in slide-in-from-top-2 duration-200">
                  <h4 className="font-bold text-gray-700 mb-3 text-sm">{t.addTask}</h4>
                  <div className="space-y-3">
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="text-xs font-bold text-gray-500 block mb-1">Phase</label>
                           <select 
                              value={newTaskPhase} 
                              onChange={(e) => setNewTaskPhase(e.target.value as SSRLPhase)}
                              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-gray-50"
                           >
                              <option value="planning">{t.phases.planning}</option>
                              <option value="monitoring">{t.phases.monitoring}</option>
                              <option value="evaluating">{t.phases.evaluating}</option>
                           </select>
                        </div>
                        <div>
                           <label className="text-xs font-bold text-gray-500 block mb-1">{t.assign}</label>
                           <select 
                              value={newTaskAssignee}
                              onChange={(e) => setNewTaskAssignee(e.target.value)}
                              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-gray-50"
                           >
                              {boardGroup.memberIds.map(mid => {
                                 const m = members.find(mem => mem.id === mid);
                                 return <option key={mid} value={mid}>{m?.name}</option>
                              })}
                           </select>
                        </div>
                     </div>
                     
                     <input 
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        placeholder={t.titlePlaceholder}
                        className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                     />
                     
                     <textarea 
                        value={newTaskDescription}
                        onChange={(e) => setNewTaskDescription(e.target.value)}
                        placeholder={t.descPlaceholder}
                        className="w-full text-sm border border-gray-300 rounded px-3 py-2 h-20 resize-none"
                     />

                     <div className="flex justify-end gap-2 pt-2">
                        <button onClick={() => setIsAddingTask(false)} className="px-4 py-1.5 text-gray-500 hover:bg-gray-100 rounded text-xs font-bold">{t.cancel}</button>
                        <button
                          onClick={() => void handleAddTask()}
                          disabled={isSavingTask || !newTaskTitle.trim()}
                          className="rounded bg-[#000080] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isSavingTask ? t.savingTask : t.saveTask}
                        </button>
                     </div>
                  </div>
               </div>
            )}

            <div className="flex-1 grid grid-cols-3 gap-4 bg-gray-50 p-4 rounded-xl overflow-hidden">
               {['planning', 'monitoring', 'evaluating'].map((phase) => (
                 <div key={phase} className="flex flex-col h-full">
                    <div
                      className="flex items-center gap-2 rounded-t-lg p-3 text-xs font-bold uppercase tracking-wider text-white"
                      style={{ backgroundColor: SSRL_PHASE_TONE[phase] }}
                    >
                       {phase === 'planning' ? <Target size={14}/> : phase === 'monitoring' ? <RefreshCw size={14}/> : <CheckCircle size={14}/>}
                       {t.phases[phase as SSRLPhase]}
                    </div>
                    <div className="flex-1 bg-gray-100/50 border-x border-b border-gray-200 rounded-b-lg p-2 space-y-2 overflow-y-auto custom-scrollbar">
                       {tasks.filter(item => item.groupId === boardGroup.id && item.ssrlPhase === phase).map(task => (
                          <div key={task.id} className="group flex flex-col gap-2 rounded border border-gray-100 bg-white p-3 shadow-sm transition-colors hover:border-zinc-300">
                             <div className="text-sm font-bold text-gray-800 leading-tight">{task.title}</div>
                             {task.description && <div className="text-xs text-gray-500 line-clamp-2 leading-snug">{task.description}</div>}
                             <div className="flex justify-between items-center text-[0.6875rem] text-gray-500 border-t border-gray-50 pt-2 mt-1">
                                <div className="flex items-center gap-1">
                                   <div className="w-4 h-4 bg-gray-200 rounded-full flex items-center justify-center font-bold text-gray-600">
                                      {members.find(m=>m.id===task.assignedToId)?.name.charAt(0)}
                                   </div>
                                   <span className="truncate max-w-[8rem]">{members.find(m=>m.id===task.assignedToId)?.name}</span>
                                </div>
                                <button
                                   onClick={() => void handleCycleTaskStatus(task)}
                                   disabled={busyTaskIds.has(task.id)}
                                   className="cursor-pointer rounded px-1.5 py-0.5 transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-60"
                                   style={chipStyle(TASK_STATUS_TONE[task.status] ?? MORANDI.stone)}
                                   title={lang === 'zh' ? '点击切换状态' : 'Click to cycle status'}
                                >
                                   {t.status[task.status]}
                                </button>
                             </div>
                          </div>
                       ))}
                    </div>
                 </div>
               ))}
            </div>
         </div>
      </div>
    );
  };

  const renderExperiment = () => {
    const students = members.filter(m => m.role === 'student');
    const groupOf = (memberId: string) => groups.find(g => g.memberIds.includes(memberId));

    return (
      <div className="h-full overflow-y-auto space-y-6 max-w-3xl mx-auto">
        {/* Experiment mode switch */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-gray-800 mb-1">{t.expModeTitle}</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xl">{t.expModeDesc}</p>
            </div>
            <button
              onClick={handleToggleExperimentMode}
              disabled={experimentMode === null}
              className="relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50"
              style={{ backgroundColor: experimentMode ? MORANDI.sage : '#D4D4D8' }}
            >
              <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${
                experimentMode ? 'left-7' : 'left-1'
              }`} />
            </button>
          </div>
          <div className="mt-3 text-xs font-bold" style={{ color: experimentMode ? ink(MORANDI.sage, 0.45) : '#9CA3AF' }}>
            {experimentMode === null ? '…' : experimentMode ? t.expModeOn : t.expModeOff}
          </div>
        </div>

        {/* Per-student override list */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-1">{t.overrideTitle}</h3>
          <p className="text-xs text-gray-500 mb-4">{t.overrideDesc}</p>
          <div className="space-y-1.5">
            {students.map(student => {
              const override = memberOverrides[student.id] ?? null;
              const group = groupOf(student.id);
              return (
                <div key={student.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
                    {student.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-800 truncate">{student.name}</div>
                    <div className="text-[0.6875rem] text-gray-400 truncate">
                      {t.inGroup}: {group ? `${group.name}${group.aiFeedbackCondition ? `(${group.aiFeedbackCondition === 'treatment' ? t.conditionTreatment : t.conditionControl})` : ''}` : t.noGroupLabel}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {([[null, t.followGroup], ['treatment', t.forceOn], ['control', t.forceOff]] as const).map(([value, label]) => (
                      <button
                        key={String(value)}
                        onClick={() => handleSetMemberOverride(student.id, value)}
                        className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-bold transition-colors ${
                          override === value ? '' : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                        }`}
                        style={override === value ? chipStyle(CONDITION_TONE[value ?? 'none']) : undefined}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {students.length === 0 && (
              <div className="text-sm text-gray-400 italic text-center py-8">{t.noGroup}</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const PHASES = ['planning', 'monitoring', 'evaluating'] as const;

  const renderAnalytics = () => {
    if (statsLoading) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-zinc-400">
          {lang === 'zh' ? '正在统计⋯⋯' : 'Loading…'}
        </div>
      );
    }

    // 一条任务都没有时如实说没有。此处原先写死 45%/30%/25%，
    // 教师会据此判断小组协作状况 —— 编出来的百分比比没有数字更糟。
    if (!taskStats || taskStats.totals.total === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center p-10 text-center">
          <BarChart2 size={48} className="mb-4 text-zinc-200" />
          <h3 className="mb-2 text-base font-semibold text-zinc-700">{t.analyticsTitle}</h3>
          <p className="max-w-md text-sm leading-relaxed text-zinc-500">{t.analyticsEmpty}</p>
        </div>
      );
    }

    const { totals, groups: rows } = taskStats;
    const pct = (n: number) => Math.round((n / totals.total) * 100);

    return (
      <div className="h-full space-y-6 overflow-y-auto p-6">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">{t.analyticsTitle}</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            {t.analyticsSub(totals.total, rows.length)}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {PHASES.map(phase => {
            const bucket = totals.byPhase[phase];
            return (
              <div key={phase} className="rounded-xl border border-zinc-200 bg-white p-5 text-center shadow-sm">
                <div className="mb-1 text-3xl font-bold" style={{ color: ink(SSRL_PHASE_TONE[phase], 0.42) }}>
                  {pct(bucket.total)}%
                </div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {t.phases[phase as SSRLPhase]}
                </div>
                <div className="mt-1.5 text-[0.6875rem] text-zinc-500">
                  {t.taskCount(bucket.total)} · {t.doneCount(bucket.done)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h4 className="mb-3 text-sm font-semibold text-zinc-800">{t.byGroup}</h4>
          <div className="space-y-3">
            {rows.map(row => (
              <div key={row.groupId}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-700">{row.name}</span>
                  <span className="text-zinc-500">
                    {t.taskCount(row.total)} · {t.doneCount(row.done)}
                  </span>
                </div>
                {row.total === 0 ? (
                  <div className="h-2 rounded-full bg-zinc-100" />
                ) : (
                  <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100">
                    {PHASES.map(phase => {
                      const n = row.byPhase[phase].total;
                      if (n === 0) return null;
                      return (
                        <div
                          key={phase}
                          style={{ width: `${(n / row.total) * 100}%`, backgroundColor: SSRL_PHASE_TONE[phase] }}
                          title={`${t.phases[phase as SSRLPhase]}: ${n}`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 border-t border-zinc-100 pt-3">
            {PHASES.map(phase => (
              <span key={phase} className="flex items-center gap-1.5 text-[0.6875rem] text-zinc-500">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: SSRL_PHASE_TONE[phase] }} />
                {t.phases[phase as SSRLPhase]}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'overview', label: t.tabs.overview },
    { key: 'tasks', label: t.tabs.tasks },
    { key: 'analytics', label: t.tabs.analytics },
    ...(isStaff ? [{ key: 'experiment' as const, label: t.tabExperiment }] : []),
  ];
  // 课内身份晚于弹窗到达、判定不是教职时，「实验设置」页签已经不在了，退回概览
  const currentTab = activeTab === 'experiment' && !isStaff ? 'overview' : activeTab;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/10">

        {/* Header */}
        <div className="flex items-center justify-between gap-6 border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-zinc-950">{t.title}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {lang === 'zh'
                ? `${groups.length} 个小组 · ${members.filter(m => m.role === 'student').length} 名学生`
                : `${groups.length} groups · ${members.filter(m => m.role === 'student').length} students`}
            </p>
          </div>

          <nav className="flex items-center gap-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-3.5 py-1.5 text-[0.8125rem] transition-colors duration-200 ${
                  currentTab === tab.key
                    ? 'bg-[#000080]/[0.06] font-semibold text-[#000080]'
                    : 'font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <button
            onClick={onClose}
            aria-label={lang === 'zh' ? '关闭' : 'Close'}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden bg-zinc-50/70 p-6">
           {currentTab === 'overview' && (
              isStaff ? renderTeacherOverview() : renderTaskBoard()
           )}
           {currentTab === 'tasks' && renderTaskBoard()}
           {currentTab === 'analytics' && renderAnalytics()}
           {currentTab === 'experiment' && renderExperiment()}
        </div>

      </div>
    </div>
  );
};

export default GroupManagementModal;
