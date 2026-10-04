import { describe, expect, it } from 'vitest';
import { toolTimeoutMs } from './agentLoop';

describe('工具执行超时', () => {
  // 15 秒是给「读数据库」那类工具定的。生成型工具跑不完：
  // 实测 DMX qwen-image-plus 6–7s、MiniMax image-01 35s。
  // 通用上限下 MiniMax 100% 超时，学生看到的是「图片生成工具连续两次超时」。
  it('生图拿到远高于通用上限的时间', () => {
    expect(toolTimeoutMs('generate_image')).toBeGreaterThan(60_000);
  });

  it('文档导出这类也算慢工具', () => {
    expect(toolTimeoutMs('generate_summary_doc')).toBeGreaterThan(15_000);
    expect(toolTimeoutMs('export_notes')).toBeGreaterThan(15_000);
  });

  it('普通读取类工具仍然是 15 秒，别让慢工具的例外泄漏成全局放宽', () => {
    expect(toolTimeoutMs('read_note')).toBe(15_000);
    expect(toolTimeoutMs('search_notes')).toBe(15_000);
    expect(toolTimeoutMs('unknown_tool')).toBe(15_000);
  });
});
