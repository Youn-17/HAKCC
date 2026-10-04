/**
 * 从模型返回里取出「给人看的那段答案」，以及按提问语言下达回复语言的指令。
 *
 * 起因：学生问「AI 反映速度太慢了怎么办呀」，界面上显示出来的是模型的
 * 英文思维链 ——「The user is asking in Chinese... I need to answer in Chinese...」。
 *
 * 两个原因叠在一起：
 *   1. max_tokens 给得太小，推理模型把额度全花在思考上，content 返回空；
 *   2. 取文本时 content 为空会回退到 reasoning_content，于是思维链被当成答案。
 *
 * 对求助这种场景，没有正式答案就是失败，该转给教师，而不是把草稿纸摊给学生看。
 */

import { stripThinkBlocks } from './modelCatalog';

/** 有汉字就按中文答。中英混写的提问（「AI 反映速度太慢」）也算中文。 */
export function detectQuestionLanguage(text: string): 'zh' | 'en' {
  return /[一-鿿]/.test(text) ? 'zh' : 'en';
}

/**
 * 明确写死用哪种语言，而不是让模型自己判断「用提问的语言回答」——
 * 后者它会先在思维链里推理一番，推理本身又是英文的，一旦漏出来就是英文。
 */
export function languageDirective(lang: 'zh' | 'en'): string {
  return lang === 'zh'
    ? 'Reply in Simplified Chinese (简体中文). The entire reply must be Chinese — do not open with an English sentence, do not restate the question in English, and do not show your reasoning.'
    : 'Reply in English. Do not show your reasoning — give the answer directly.';
}

/**
 * 只取正式答案，绝不回退到 reasoning_content。
 * 拿不到就返回 null —— 调用方据此走「转给教师」，而不是把思维链当答案发出去。
 */
export function extractFinalAnswer(json: unknown): string | null {
  const msg = (json as any)?.choices?.[0]?.message;
  if (!msg) return null;

  const raw = typeof msg.content === 'string' ? msg.content : '';
  return stripThinkBlocks(raw) || null;
}
