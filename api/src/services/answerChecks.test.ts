import { describe, expect, it } from 'vitest';
import {
  acceptRevision,
  buildRevisionPrompt,
  checkAgency,
  checkSpeech,
  classifyAgencyIntent,
  countGhostwriteRequests,
  unwrapRevision,
} from './answerChecks';

/**
 * 回答给学生看之前的两道检查（2026-10-11）。宁可放过，也别把正常的提问当成代写、把正常的回答改坏：
 * 短问题、做网页、「帮我想想」、最后一句是在问学生、代码里的注释，都不能动。
 */

describe('这一问要 AI 做什么', () => {
  it('替自己写：观点、作答、给同学的回复、能直接交的文字', () => {
    for (const q of [
      '帮我写一段关于检索练习的观点',
      '替我回复一下陈思远的笔记',
      '直接告诉我答案',
      '帮我想一个观点',
      '帮我做作业',
      '写一段我可以直接交的反思',
      '给我一个现成的总结',
      'Can you write my reflection for me?',
      'just give me the answer',
    ]) expect(classifyAgencyIntent(q), q).toBe('ghostwrite');
  });

  it('做东西不算代写：网页、对比表、自测题', () => {
    for (const q of ['帮我做一个对比表网页', '把这些观点做成概念图', '出 3 道自测题', '帮我写一个网页，比较两种看法', 'make a comparison page of these ideas']) {
      expect(classifyAgencyIntent(q), q).toBe('make');
    }
  });

  it('改自己写的：可以帮，但观点还是学生的', () => {
    expect(classifyAgencyIntent('帮我改一下我写的这段')).toBe('polish');
    expect(classifyAgencyIntent('可以帮我润色一下这段话吗')).toBe('polish');
    expect(classifyAgencyIntent('please proofread my paragraph')).toBe('polish');
  });

  it('普通提问：短问题、帮我想想、总结大家的观点，都不算代写（以前十五个字以内一律当成偷懒）', () => {
    for (const q of ['哪些观点有分歧？', '谁在 Build-on 谁？', '帮我想想这两个观点有什么联系', '帮我总结一下大家的观点', '好的', '']) {
      expect(classifyAgencyIntent(q), q).toBe('ask');
    }
  });

  it('数一数之前几句里有几次是让 AI 代写', () => {
    expect(countGhostwriteRequests(['帮我写一段观点', '哪些观点有分歧？', '直接告诉我答案'])).toBe(2);
  });
});

describe('说话自然', () => {
  it('开场白、收尾套话、表情符号原样删掉，正文一个字不动', () => {
    const out = checkSpeech('当然！这几条笔记里有两种看法 😊\n\n一种认为重读更有效，另一种认为回想更有效。\n\n希望对你有帮助！');
    expect(out.text).toBe('这几条笔记里有两种看法\n\n一种认为重读更有效，另一种认为回想更有效。');
    expect(out.fixed.sort()).toEqual(['closer', 'emoji', 'opener']);
    expect(out.remaining).toEqual([]);
  });

  it('最后一行末尾那一句是套话：只删那一句', () => {
    const out = checkSpeech('分歧在第二栏。希望以上内容对你有所帮助！');
    expect(out.text).toBe('分歧在第二栏。');
  });

  it('最后一句是在问学生：不删', () => {
    const text = '两种看法各有依据。\n\n欢迎继续讨论：你觉得哪种更有说服力？';
    expect(checkSpeech(text).text).toBe(text);
  });

  it('「好的观点……」「当然有分歧」不是开场白', () => {
    expect(checkSpeech('好的观点要有证据支撑。').text).toBe('好的观点要有证据支撑。');
    expect(checkSpeech('当然有分歧：一边看重复习次数。').text).toBe('当然有分歧：一边看重复习次数。');
  });

  it('删完什么都不剩就保留原文', () => {
    expect(checkSpeech('好的。').text).toBe('好的。');
  });

  it('短回答里的小标题和成串加粗去掉记号；长回答不动；代码里的注释不动', () => {
    const short = checkSpeech('### 结论\n**重读**和**回想**都有人支持，**分歧**在于时间。');
    expect(short.text).toBe('结论\n重读和回想都有人支持，分歧在于时间。');
    expect(short.fixed).toContain('over_formatted');

    const code = checkSpeech('**看**这段：**算**平均数，**注意**空值。\n```python\n# 计算平均值\nx = 1\n```');
    expect(code.text).toContain('# 计算平均值');
    expect(code.text).toContain('看这段：算平均数');

    const long = `## 第一部分\n**要点**${'内容'.repeat(300)}`;
    expect(checkSpeech(long).text).toBe(long);
  });

  it('短回答最后一段的「总之，」去掉', () => {
    expect(checkSpeech('两边都有道理。\n\n总之，关键在证据。').text).toBe('两边都有道理。\n\n关键在证据。');
  });

  it('「作为 AI……」「首先……其次……最后」删了会断句：留给模型改', () => {
    expect(checkSpeech('作为一个AI助手，我没法替你判断。').remaining).toContain('self_ai');
    expect(checkSpeech('首先看证据，其次看推理，最后看结论。').remaining).toContain('template_chain');
  });
});

describe('主体性：有没有替学生写成段的现成文字', () => {
  const ready = `你可以这样写：\n\n“我认为检索练习比重读更有效，因为每次回想都在加强记忆的提取路径。${'课堂上的经验也支持这一点，'.repeat(10)}所以我主张多做自测。”`;

  it('学生要代写、AI 递上一段能直接用的文字：算', () => {
    expect(checkAgency(ready, { intent: 'ghostwrite' }).issues).toContain('ready_text');
  });

  it('学生要代写、AI 用第一人称写了成段的观点：算', () => {
    const para = `我认为检索练习比重读更有效。${'因为每次回想都在加强记忆的提取路径，课堂经验也支持这一点。'.repeat(5)}`;
    expect(checkAgency(para, { intent: 'ghostwrite' }).issues).toContain('ghostwritten');
  });

  it('普通提问的正常回答、短的示例句子：不算', () => {
    expect(checkAgency('两种看法的分歧在于复习的时间点。你更认同哪一边？', { intent: 'ask' }).issues).toEqual([]);
    expect(checkAgency('你可以这样写：“我更认同……，因为……”', { intent: 'ask' }).issues).toEqual([]);
  });

  it('留了空的句子开头（「所以我认为……」、列出来的开头）是支架：不算替学生表态（10-11 评测 w31）', () => {
    const scaffold = '具体措辞得你自己来写。你可以先想：三条线里你最想放进去的是哪一条？这条线里哪个结论是你自己认同或想补的？你打算用哪条笔记来支撑它？开头可以试「这个月我们不是在讨论 AI 会不会取代学习，而是在……」；转折处可以试「但三条线索合起来，还有一个被跳过的前提：……」；收尾可以试「所以我认为空间还没回答的是……」。';
    expect(checkAgency(scaffold, { intent: 'ghostwrite' }).issues).toEqual([]);
    const list = '你可以这样写：\n- 开头：我认为……\n- 依据：Bjork 的研究说明……\n- 转折：但是 ___ 的情况不一样\n- 收尾：所以我主张……';
    expect(checkAgency(list, { intent: 'ghostwrite' }).issues).toEqual([]);
  });

  it('叫学生「其余照抄」：算现成文字；「不是让你照抄」「照搬了别人的说法」不算（10-11 评测 w35）', () => {
    expect(checkAgency('模板如下：个性化听起来中立，但〔填〕。你把这处补完，其余照抄就可以用。', { intent: 'ghostwrite' }).issues).toContain('ready_text');
    expect(checkAgency('我写不了。其余照抄就行。', { intent: 'ghostwrite' }).issues).toContain('ready_text');
    expect(checkAgency('不是让你照抄，而是给你骨架：你最认同哪条？', { intent: 'ghostwrite' }).issues).toEqual([]);
    expect(checkAgency('你这句话照搬了 Oliver 的说法，换成你自己的例子？', { intent: 'ghostwrite' }).issues).toEqual([]);
    // 不是代写请求时不看这个（改自己的句子时「可以照抄这一版」是正常的）
    expect(checkAgency('可以照抄这一版。', { intent: 'polish' }).issues).toEqual([]);
  });

  it('引号里一大段写好的观点，中间带个省略号：照样算', () => {
    const quoted = `“我认为检索练习比重读更有效……${'因为每次回想都在加强记忆的提取路径，课堂经验也支持这一点。'.repeat(5)}”`;
    expect(checkAgency(quoted, { intent: 'ghostwrite' }).issues).toContain('ghostwritten');
  });

  it('学生没要，AI 自己递上一大段能直接交的文字：也算；改自己写的不算', () => {
    expect(checkAgency(ready, { intent: 'ask' }).issues).toContain('ready_text');
    expect(checkAgency(ready, { intent: 'polish' }).issues).toEqual([]);
  });
});

describe('交给模型改一遍', () => {
  it('提示词只列要改的那几样，并要求原样保留事实、标题、链接和引用编号', () => {
    const prompt = buildRevisionPrompt({ text: '原文', speech: ['self_ai'], agency: ['ready_text'] });
    expect(prompt.user).toContain('sentence starters');
    expect(prompt.user).toContain('Remove any mention of being an AI');
    expect(prompt.user).not.toContain('首先/其次');
    expect(prompt.system).toContain('citation marker like [2]');
    expect(prompt.user).toContain('<<<\n原文\n>>>');
  });

  it('改写结果凭空多出引用编号、链接、书名号标题：不用', () => {
    const original = '检索练习更有效[1]，见《学习之道》。';
    expect(acceptRevision(original, '检索练习更有效[1][2]，见《学习之道》。').reason).toBe('new_citation');
    expect(acceptRevision(original, '检索练习更有效[1]，见 https://x.test 。').reason).toBe('new_link');
    expect(acceptRevision(original, '检索练习更有效[1]，见《认知心理学》。').reason).toBe('new_title');
    expect(acceptRevision(original, '检索练习更有效[1]，见《学习之道》这本书。').ok).toBe(true);
  });

  it('长度和语言：只改说法的不能短到一半；主体性改写可以短很多；中文不能改成英文', () => {
    const original = '我认为检索练习比重读更有效，因为每次回想都在加强记忆的提取路径，课堂经验也支持这一点，所以我主张多做自测。';
    expect(acceptRevision(original, '重读不如回想。').reason).toBe('length');
    expect(acceptRevision(original, '你先想想：哪一次复习让你记得最牢？', { agency: true }).ok).toBe(true);
    expect(acceptRevision(original, 'Retrieval practice works better than rereading because every act of recall strengthens memory.').reason).toBe('language');
  });

  it('模型把 <<< >>> 或代码围栏抄回来：去掉', () => {
    expect(unwrapRevision('<<<\n正文\n>>>')).toBe('正文');
    expect(unwrapRevision('```\n正文\n```')).toBe('正文');
  });
});
