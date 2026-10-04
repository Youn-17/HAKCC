/**
 * 课程名的行内编辑。
 *
 * 放在课程名旁边，而不是藏进「课程设置」弹窗 —— 改名的入口应该出现在
 * 名字本身所在的位置，否则教师看着课程名，找不到任何可以动它的地方。
 *
 * 铅笔常驻显示，不做 hover 才出现 —— 藏在 hover 后面等于没有：
 * 教师不会为了找一个不知道存不存在的功能去逐行划过鼠标。
 *
 * 只有课程创建者看得到编辑入口；权限最终以后端为准（前端列表可能是过期数据），
 * 所以后端拒绝时保持编辑态并把服务器的原因显示出来。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { ApiClientError, courses as coursesApi } from '../../services/apiClient';
import type { Language } from '../../types';

interface Props {
  courseId: string;
  title: string;
  /** 当前用户是否为课程创建者。false 时不渲染任何编辑入口。 */
  canRename: boolean;
  lang: Language;
  onRenamed: (courseId: string, title: string) => void;
  /** 标题的排版类名，让调用方决定字号字重。 */
  titleClassName?: string;
}

const CourseTitleEditor: React.FC<Props> = ({
  courseId, title, canRename, lang, onRenamed, titleClassName = '',
}) => {
  const zh = lang === 'zh';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(title); }, [title]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  // 整行本身是「进入课程」的点击区，编辑控件的事件一律不能冒泡上去。
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const cancel = () => { setEditing(false); setDraft(title); setError(null); };

  const commit = async () => {
    const next = draft.trim();
    if (!next) { setError(zh ? '课程名称不能为空' : 'The course name cannot be empty'); return; }
    if (next === title) { cancel(); return; }
    setSaving(true);
    setError(null);
    try {
      const { course } = await coursesApi.rename(courseId, next);
      onRenamed(courseId, course.title);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiClientError || err instanceof Error
        ? err.message
        : (zh ? '保存失败，请稍后重试。' : 'Save failed. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <h3 className={`truncate ${titleClassName}`}>{title}</h3>
        {canRename && (
          <button
            type="button"
            onClick={(e) => { stop(e); setEditing(true); }}
            onKeyDown={stop}
            title={zh ? '修改课程名称' : 'Rename course'}
            aria-label={zh ? '修改课程名称' : 'Rename course'}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors duration-150 hover:bg-stone-100 hover:text-stone-700 motion-reduce:transition-none dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div onClick={stop} onKeyDown={stop} role="presentation">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape') cancel();
          }}
          aria-label={zh ? '课程名称' : 'Course name'}
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-stone-900 outline-none transition-colors focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/10 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
        />
        <button
          type="button"
          onClick={(e) => { stop(e); void commit(); }}
          disabled={saving}
          className="inline-flex min-h-[36px] flex-shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-stone-50 transition-colors hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {zh ? '保存' : 'Save'}
        </button>
        <button
          type="button"
          onClick={(e) => { stop(e); cancel(); }}
          aria-label={zh ? '取消' : 'Cancel'}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-stone-300 text-stone-500 transition-colors hover:bg-stone-50 dark:border-stone-600 dark:hover:bg-stone-800"
        >
          <X size={14} />
        </button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};

export default CourseTitleEditor;
