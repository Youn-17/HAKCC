import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../services/apiClient';
import { courseSettingsError } from './errorText';

describe('course settings error display', () => {
  it('hides technical details while retaining the operation-specific fallback', () => {
    for (const error of [new Error('Failed to fetch'), new ApiClientError(500, 'database relation secret_table missing'), new ApiClientError(400, 'unknown validation payload')]) {
      expect(courseSettingsError(error, true, '上传失败，请重试。')).toBe('上传失败，请重试。');
      expect(courseSettingsError(error, false, 'Upload failed. Please try again.')).toBe('Upload failed. Please try again.');
    }
  });
  it('distinguishes expired sessions, denied access, missing records and oversized files in both languages', () => {
    for (const [status, zh, en] of [
      [401, '登录已失效，请重新登录。', 'Your session has expired. Please sign in again.'],
      [403, '暂无执行此操作的权限。', 'You do not have permission to perform this action.'],
      [404, '记录已不存在，请刷新页面。', 'This record no longer exists. Please refresh the page.'],
      [413, '文件过大，请选择较小的文件。', 'The file is too large. Please choose a smaller file.'],
    ] as const) {
      expect(courseSettingsError(new ApiClientError(status, 'raw'), true, 'fallback')).toBe(zh);
      expect(courseSettingsError(new ApiClientError(status, 'raw'), false, 'fallback')).toBe(en);
    }
  });
});
