import { ApiClientError } from '../../services/apiClient';

/** Translate known failures; never display raw server or network messages. */
export function courseSettingsError(error: unknown, zh: boolean, fallback: string): string {
  if (!(error instanceof ApiClientError)) return fallback;
  switch (error.status) {
    case 401: return zh ? '登录已失效，请重新登录。' : 'Your session has expired. Please sign in again.';
    case 403: return zh ? '暂无执行此操作的权限。' : 'You do not have permission to perform this action.';
    case 404: return zh ? '记录已不存在，请刷新页面。' : 'This record no longer exists. Please refresh the page.';
    case 409: return zh ? '数据状态已变更，请刷新后重试。' : 'The data has changed. Please refresh and try again.';
    case 413: return zh ? '文件过大，请选择较小的文件。' : 'The file is too large. Please choose a smaller file.';
    case 429: return zh ? '操作过于频繁，请稍后重试。' : 'Too many requests. Please try again later.';
    case 400:
      if (error.message === '目标标题最多 200 字') {
        return zh ? '目标标题不能超过 200 字。' : 'Goal titles must be 200 characters or fewer.';
      }
  }
  return fallback;
}
