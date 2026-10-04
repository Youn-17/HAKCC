/**
 * 视图面板。
 *
 * 上一版是个九个字段的配置表单：筛选条件、布局、排序、四个显示选项、个人/共享、
 * 克隆、四个"智能推荐"。其中布局、排序、显示选项从来没有任何渲染代码读过 ——
 * 学生选了"列表视图"保存成功，画面纹丝不动；而筛选条件会把 View 归属整个短路掉，
 * 让这块画布冒出别处的笔记。线上一个 View 都没人建过。
 *
 * 现在只剩四个动作：进入、新建、把某个视图放到当前画布、改名或删除自己建的。
 */
import React, { useEffect, useRef, useState } from 'react';
import RemixIcon from './RemixIcon';
import { ViewDefinition, Language } from '../types';
import { viewColor } from './viewPalette';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  views: ViewDefinition[];
  activeViewId: string;
  noteCounts: Map<string, number>;
  /** 已经在当前画布上有卡片的视图，不再重复提供「放到这里」。 */
  placedViewIds: Set<string>;
  onSelectView: (id: string) => void;
  onCreateView: (title: string) => void;
  onPlaceCard: (viewId: string) => void;
  onRenameView: (id: string, title: string) => void;
  onDeleteView: (id: string) => void;
  lang: Language;
  currentUserId?: string;
  /** 课程教职（按课内身份）能改名、删除别人建的视图，和后端 PUT/DELETE /views/:id 同口径 */
  isStaff: boolean;
  /** 侧栏可以拖宽到 180px，面板得跟着走，不能写死。 */
  offsetLeft: number;
}

const ViewPanel: React.FC<Props> = ({
  isOpen, onClose, views, activeViewId, noteCounts, placedViewIds,
  onSelectView, onCreateView, onPlaceCard, onRenameView, onDeleteView,
  lang, currentUserId, isStaff, offsetLeft,
}) => {
  const zh = lang === 'zh';
  const [draft, setDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (!isOpen) { setRenamingId(null); setDraft(''); }
  }, [isOpen]);

  const submitCreate = () => {
    const title = draft.trim();
    if (!title) return;
    onCreateView(title);
    setDraft('');
  };

  const submitRename = () => {
    if (!renamingId) return;
    const title = renameDraft.trim();
    if (title) onRenameView(renamingId, title);
    setRenamingId(null);
  };

  const canManage = (view: ViewDefinition) =>
    view.creatorId !== '' &&
    (view.creatorId === currentUserId || isStaff);

  if (!isOpen) return null;

  return (
    <div
      className="absolute top-0 bottom-0 z-40 flex w-72 flex-col border-r border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950"
      style={{ left: offsetLeft }}
    >
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-gray-200 px-4 dark:border-gray-800">
        <RemixIcon name="layout-grid-line" size={16} className="text-[#000080] dark:text-[#93AAFD]" />
        <span className="text-[0.8125rem] font-semibold text-gray-900 dark:text-gray-100">{zh ? '视图' : 'Views'}</span>
        <span className="ml-auto text-[0.6875rem] text-gray-400">{views.length}</span>
        <button
          onClick={onClose}
          aria-label={zh ? '关闭' : 'Close'}
          className="-mr-1.5 flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-900"
        >
          <RemixIcon name="close-line" size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-2 transition-colors focus-within:border-[#000080]/50 dark:border-gray-700">
          <RemixIcon name="add-line" size={15} className="flex-shrink-0 text-gray-400" />
          <input
            value={draft}
            maxLength={60}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitCreate(); }}
            placeholder={zh ? '起个名字，回车新建' : 'Name it, press enter'}
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
          />
        </div>

        {views.map(view => {
          const isActive = view.id === activeViewId;
          const color = viewColor(view.id);
          const count = noteCounts.get(view.id) ?? 0;
          const canPlace = !isActive && !placedViewIds.has(view.id);
          const manageable = canManage(view);

          return (
            <div
              key={view.id}
              className={`mb-0.5 rounded-xl px-2.5 py-2 transition-colors ${
                isActive ? 'bg-gray-100 dark:bg-gray-900' : 'hover:bg-gray-50 dark:hover:bg-gray-900/60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-[3px]"
                  style={{ backgroundColor: color }}
                />

                {renamingId === view.id ? (
                  <input
                    ref={renameRef}
                    value={renameDraft}
                    maxLength={60}
                    onChange={e => setRenameDraft(e.target.value)}
                    onBlur={submitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') submitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-[0.8125rem] text-gray-900 outline-none focus:border-[#000080]/50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                ) : (
                  <button
                    onClick={() => onSelectView(view.id)}
                    className="min-w-0 flex-1 truncate text-left text-[0.8125rem] text-gray-900 dark:text-gray-100"
                  >
                    {view.title}
                  </button>
                )}

                {isActive && (
                  <RemixIcon name="check-line" size={15} className="flex-shrink-0 text-[#000080] dark:text-[#93AAFD]" />
                )}

                {manageable && renamingId !== view.id && (
                  <>
                    <button
                      onClick={() => { setRenamingId(view.id); setRenameDraft(view.title); }}
                      aria-label={zh ? '改名' : 'Rename'}
                      title={zh ? '改名' : 'Rename'}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-800"
                    >
                      <RemixIcon name="pencil-line" size={14} />
                    </button>
                    <button
                      onClick={() => onDeleteView(view.id)}
                      aria-label={zh ? '删除视图' : 'Delete view'}
                      title={zh ? '删除视图' : 'Delete view'}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                    >
                      <RemixIcon name="delete-bin-line" size={14} />
                    </button>
                  </>
                )}
              </div>

              <div className="mt-0.5 flex items-center gap-2 pl-5 text-[0.6875rem] text-gray-500 dark:text-gray-400">
                <span>{count} {zh ? '条笔记' : count === 1 ? 'note' : 'notes'}</span>
                {canPlace && (
                  <button
                    onClick={() => onPlaceCard(view.id)}
                    className="font-medium text-[#000080] transition-colors hover:underline dark:text-[#93AAFD]"
                  >
                    {zh ? '放到这里' : 'Place here'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-shrink-0 border-t border-gray-200 px-4 py-3 text-[0.6875rem] leading-relaxed text-gray-500 dark:border-gray-800 dark:text-gray-400">
        {zh
          ? '每个视图是一块独立画布。「放到这里」会在当前画布上留一张卡片，点一下就能过去。'
          : 'Each view is its own canvas. "Place here" leaves a card on this canvas that takes you there.'}
      </div>
    </div>
  );
};

export default ViewPanel;
