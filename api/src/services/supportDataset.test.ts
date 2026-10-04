import { describe, expect, it } from 'vitest';
import { DATASET_KEYS, DATASET_COLUMNS, DATASET_LABELS } from './researchExport';

describe('学生求助进研究导出', () => {
  it('求助是第九张表，导出清单里有它', () => {
    expect(DATASET_KEYS).toContain('support_questions');
  });

  it('每个数据集都配齐了列定义和中英文说明 —— 少一个，导出面板就会空着一格', () => {
    for (const key of DATASET_KEYS) {
      expect(DATASET_COLUMNS[key]?.length ?? 0).toBeGreaterThan(0);
      expect(DATASET_LABELS[key]?.zh).toBeTruthy();
      expect(DATASET_LABELS[key]?.en).toBeTruthy();
    }
  });

  it('姓名列标了敏感，匿名导出时才会被摘掉', () => {
    const nameCol = DATASET_COLUMNS.support_questions.find(c => c.key === 'participant_name');
    expect(nameCol?.sensitive).toBe(true);
  });

  it('处境列在，语料才对下一届有用', () => {
    const keys = DATASET_COLUMNS.support_questions.map(c => c.key);
    for (const k of ['ctx_path', 'ctx_panel', 'ctx_device', 'ctx_recent_errors', 'context_json']) {
      expect(keys).toContain(k);
    }
  });

  it('保留完整 context JSON —— 摊平的那几列迟早跟不上平台演进', () => {
    expect(DATASET_COLUMNS.support_questions.map(c => c.key)).toContain('context_json');
  });
});
