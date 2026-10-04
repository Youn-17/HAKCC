// 关系类型配色。色值只在 morandiPalette 的 RELATION_PALETTE 里存一份 ——
// 此前这里和 viewPalette 各抄了一份同样的六个 hex，改一处另一处不会跟着动。
import { RELATION_PALETTE } from './morandiPalette';

export const RELATION_COLORS: Record<string, string> = { ...RELATION_PALETTE };

// Tailwind 只认字面量类名，hex 只能写死在这里；relationColors.test.ts 核对它和 RELATION_PALETTE 一致。
export const RELATION_STYLE: Record<string, { bg: string; border: string; ring: string }> = {
  extend:     { bg: 'bg-[#2E7334]/10', border: 'border-[#2E7334]',  ring: 'ring-[#2E7334]'  },
  clarify:    { bg: 'bg-[#2A6DB8]/10', border: 'border-[#2A6DB8]',  ring: 'ring-[#2A6DB8]'  },
  question:   { bg: 'bg-[#CC7F2E]/10', border: 'border-[#CC7F2E]',  ring: 'ring-[#CC7F2E]'  },
  challenge:  { bg: 'bg-[#C8434A]/10', border: 'border-[#C8434A]',  ring: 'ring-[#C8434A]'  },
  evidence:   { bg: 'bg-[#16979C]/10', border: 'border-[#16979C]',  ring: 'ring-[#16979C]'  },
  synthesize: { bg: 'bg-[#8C557F]/10', border: 'border-[#8C557F]',  ring: 'ring-[#8C557F]'  },
};

/**
 * Single source of truth for relation-type labels. Previously copied into five
 * components, which had already drifted (challenge read 质疑 in research and
 * 挑战 everywhere else).
 */
export const RELATION_LABELS: Record<'zh' | 'en', Record<string, string>> = {
  zh: { extend: '延伸', clarify: '澄清', question: '提问', challenge: '质疑', evidence: '证据', synthesize: '综合' },
  en: { extend: 'Extend', clarify: 'Clarify', question: 'Question', challenge: 'Challenge', evidence: 'Evidence', synthesize: 'Synthesize' },
};

/**
 * Build-on 的六种方式，画布的 Build-on 窗口和笔记页右下角的 Build-on 菜单共用。
 * 顺序就是显示顺序。
 */
export const BUILD_ON_MOVES = [
  { type: 'extend' as const,     label: 'Extend',     labelZh: '延伸', desc: '在此基础上进一步发展', descEn: 'Take the idea further' },
  { type: 'clarify' as const,    label: 'Clarify',    labelZh: '澄清', desc: '解释或阐明这个观点', descEn: 'Explain or clarify the idea' },
  { type: 'question' as const,   label: 'Question',   labelZh: '提问', desc: '提出疑问或探究', descEn: 'Raise a question about it' },
  { type: 'challenge' as const,  label: 'Challenge',  labelZh: '质疑', desc: '提出反驳，指出不成立之处', descEn: 'Push back and show where it does not hold' },
  { type: 'evidence' as const,   label: 'Evidence',   labelZh: '证据', desc: '提供支持性证据', descEn: 'Add supporting evidence' },
  { type: 'synthesize' as const, label: 'Synthesize', labelZh: '综合', desc: '综合整合多个观点', descEn: 'Pull several ideas together' },
];
