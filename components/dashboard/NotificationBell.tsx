import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RemixIcon from '../RemixIcon';
import { useDismissible } from '../../hooks/useDismissible';
import { notifications as notificationsApi, type ApiNotification } from '../../services/apiClient';

interface Props {
  lang: 'zh' | 'en';
  /** sidebar：侧栏底部，向上弹；header：手机顶栏，向下弹 */
  placement: 'sidebar' | 'header';
  /** 教师反馈类通知点进去去哪儿。学生端是「教师反馈」页签，教师端不传 */
  onOpenFeedback?: () => void;
  buttonClassName?: string;
}

const PANEL_WIDTH = 320;

/**
 * 概览页的通知铃。以前侧栏和手机顶栏各有一个铃铛，都没接点击，
 * 手机那个还一直亮着未读小点。数据和工作区顶栏同一个接口。
 *
 * 弹层走 portal：侧栏底部那一行把里面所有按钮都压成 26px 见方，
 * 弹层放在里面，列表按钮会被一起压扁。
 */
const NotificationBell: React.FC<Props> = ({ lang, placement, onOpenFeedback, buttonClassName }) => {
  const zh = lang === 'zh';
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const { notifications } = await notificationsApi.list();
      setItems(notifications);
    } catch { /* 取不到就当没有，不打扰 */ }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 弹层开着时点铃铛：按下那一刻已经被「点到外面」关掉了，随后的 click 不能再把它打开
  const dismissedAt = useRef(0);
  const close = useCallback(() => { dismissedAt.current = Date.now(); setOpen(false); }, []);
  useDismissible({ open, onDismiss: close, ref: panelRef });

  const toggle = () => {
    if (open) { setOpen(false); return; }
    if (Date.now() - dismissedAt.current < 300) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
      const left = Math.max(8, Math.min(
        placement === 'sidebar' ? rect.left : rect.right - width,
        window.innerWidth - width - 8,
      ));
      setPos(placement === 'sidebar'
        ? { left, width, bottom: window.innerHeight - rect.top + 8 }
        : { left, width, top: rect.bottom + 8 });
    }
    setOpen(true);
    void load();
  };

  const unread = items.filter(n => !n.read).length;

  const markRead = (n: ApiNotification) => {
    if (!n.read) {
      setItems(prev => prev.map(x => (x.id === n.id ? { ...x, read: true } : x)));
      notificationsApi.markRead(n.id).catch(() => { /* 下次打开会再取一遍 */ });
    }
    if (n.type === 'teacher' && onOpenFeedback) {
      setOpen(false);
      onOpenFeedback();
    }
  };

  const markAllRead = () => {
    setItems(prev => prev.map(x => ({ ...x, read: true })));
    notificationsApi.markAllRead().catch(() => { /* 同上 */ });
  };

  const when = (iso: string) => new Date(iso).toLocaleString(zh ? 'zh-CN' : 'en-US', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={zh ? '通知' : 'Notifications'}
        title={zh ? '通知' : 'Notifications'}
        aria-expanded={open}
        className={`relative flex items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900 ${buttonClassName ?? ''}`}
      >
        <RemixIcon name="notification-3-line" size={placement === 'header' ? 17 : 16} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={zh ? '通知' : 'Notifications'}
          style={pos}
          className="fixed z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg shadow-stone-900/10 dark:border-gray-800 dark:bg-gray-950"
        >
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{zh ? '通知' : 'Notifications'}</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="rounded-md px-2 py-1 text-xs font-medium text-[#000080] transition-colors hover:bg-[#000080]/[0.06] dark:text-[#93AAFD]"
              >
                {zh ? '全部标为已读' : 'Mark all read'}
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!loaded ? (
              <div className="space-y-2 p-4">
                <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
              </div>
            ) : items.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-400">{zh ? '暂无通知' : 'No notifications'}</p>
            ) : items.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => markRead(n)}
                className={`flex w-full gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-900 ${n.read ? '' : 'bg-[#000080]/[0.02]'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className={`text-xs ${n.read ? 'text-gray-600 dark:text-gray-400' : 'font-semibold text-gray-800 dark:text-gray-100'}`}>{n.title}</span>
                    <span className="shrink-0 font-mono text-[0.6875rem] text-gray-400">{when(n.created_at)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[0.6875rem] leading-relaxed text-gray-500 dark:text-gray-400">{n.message}</span>
                </span>
                {!n.read && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#000080] dark:bg-[#93AAFD]" />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default NotificationBell;
