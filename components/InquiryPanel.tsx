import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import RemixIcon from './RemixIcon';
import { Language } from '../types';
import { turingTest as turingTestApi } from '../services/apiClient';
import type { TuringTestActivity } from '../services/apiClient';

interface InquiryPanelProps {
  courseId: string;
  /**
   * 课程教职（创建者、课程管理员、平台管理员），按课内身份算。图灵测试的设置与主持后端只放行他们；
   * 在这门课里只是普通成员的教师账号和学生一样，是参加测试的人。
   */
  isStaff: boolean;
  lang: Language;
  onClose: () => void;
}

const InquiryPanel: React.FC<InquiryPanelProps> = ({ courseId, isStaff, lang, onClose }) => {
  const navigate = useNavigate();
  const zh = lang === 'zh';

  const [ttActivities, setTTActivities] = useState<TuringTestActivity[]>([]);
  const [ttLoading, setTTLoading] = useState(true);

  // 学生只拿得到教师已开放的活动；一个都没有时整块不显示。教师在仪表盘「图灵测试」里设置。
  useEffect(() => {
    if (!courseId || courseId === 'default') { setTTLoading(false); return; }
    setTTLoading(true);
    turingTestApi.list(courseId)
      // 教师看到全部（含草稿）以便管理；学生本来就只拿得到已开放的
      .then(({ activities }) => setTTActivities(activities.filter(a => a.status !== 'completed')))
      .catch(() => {})
      .finally(() => setTTLoading(false));
  }, [courseId]);

  const statusLabels: Record<string, string> = {
    draft: '草稿', open: '可进入', chatting: '对话中', voting: '判断中', revealed: '已揭晓',
  };
  const statusLabelsEn: Record<string, string> = {
    draft: 'Draft', open: 'Open', chatting: 'Chatting', voting: 'Voting', revealed: 'Revealed',
  };
  const statusColors: Record<string, string> = {
    draft: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    open: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
    chatting: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    voting: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    revealed: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  };

  const showTuring = !ttLoading && (ttActivities.length > 0 || isStaff);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#000080]/10 flex items-center justify-center">
            <RemixIcon name="compass-3-line" size={16} className="text-[#000080] dark:text-[#93AAFD]" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {zh ? '探究工具' : 'Inquiry Tools'}
            </h2>
            <p className="text-[0.6875rem] text-zinc-400 mt-0.5">
              {zh ? '选择探究活动' : 'Choose an inquiry activity'}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <RemixIcon name="close-line" size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── Turing Test Section ── */}
        {showTuring && (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 flex items-center justify-center shrink-0">
                <RemixIcon name="robot-2-line" size={20} className="text-sky-600 dark:text-sky-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  {zh ? '图灵测试' : 'Turing Test'}
                </div>
                <div className="text-[0.6875rem] text-zinc-400 mt-0.5 leading-relaxed">
                  {zh ? '匿名群聊里混着 AI 同学，限时聊完判断群里谁是 AI' : 'An anonymous group chat with AI classmates mixed in. Chat, then decide who is AI'}
                </div>
              </div>
              {isStaff && (
                <button
                  type="button"
                  onClick={() => { onClose(); navigate(`/workspace/${courseId}/turing-test`); }}
                  className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <RemixIcon name="settings-3-line" size={13} />
                  {zh ? '设置与主持' : 'Set up'}
                </button>
              )}
            </div>
            <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 px-4 py-3 space-y-2">
              {ttActivities.map(a => (
                <button
                  key={a.id}
                  onClick={() => { onClose(); navigate(isStaff ? `/workspace/${courseId}/turing-test?activity=${a.id}` : `/workspace/${courseId}/turing-test/${a.id}`); }}
                  className="w-full flex items-center gap-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-2.5 text-left transition-colors hover:border-[#000080]/20"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate">{a.title}</div>
                    <div className="text-[0.6875rem] text-zinc-400 truncate">{a.topic}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium shrink-0 ${statusColors[a.status] ?? 'bg-zinc-100 text-zinc-500'}`}>
                    {zh ? (statusLabels[a.status] ?? a.status) : (statusLabelsEn[a.status] ?? a.status)}
                  </span>
                </button>
              ))}
              {ttActivities.length === 0 && (
                <p className="text-center text-[0.6875rem] text-zinc-400 py-2">
                  {zh ? '还没有活动。点右上角「设置与主持」新建一个' : 'No activity yet. Use "Set up" to create one'}
                </p>
              )}
            </div>
          </section>
        )}

        {/* ── Computational Thinking Tool Section ── */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <button
            onClick={() => { onClose(); navigate(`/workspace/${courseId}/ct-tool`); }}
            className="w-full flex items-center gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 flex items-center justify-center shrink-0">
              <RemixIcon name="flow-chart" size={20} className="text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {zh ? '计算思维工具' : 'Computational Thinking'}
              </div>
              <div className="text-[0.6875rem] text-zinc-400 mt-0.5 leading-relaxed">
                {zh ? '分解、模式识别、抽象、算法设计' : 'Decomposition, patterns, abstraction, algorithms'}
              </div>
            </div>
            <RemixIcon name="arrow-right-s-line" size={16} className="text-zinc-300 shrink-0" />
          </button>
        </section>
      </div>
    </div>
  );
};

export default InquiryPanel;
