-- General-purpose prompts for planning, checking, and reflecting on AI use.
-- Only the AI-excerpt prompts have gai=true; the remaining prompts support student writing.
-- This migration inserts global prompts idempotently and preserves existing records.

insert into public.scaffolds
  (title, title_en, description, category, icon, color, steps,
   is_mandatory, is_recommended, course_id, created_by, metadata, sort_order)
select
  x.title,
  x.title_en,
  x.title_en,
  x.category,
  'Bot',
  'bg-sky-50 text-sky-700',
  jsonb_build_array(jsonb_build_object(
    'id', 's1', 'type', 'textarea', 'prompt', x.title, 'required', true, 'placeholder', x.title_en)),
  false, false, null, null,
  x.metadata,
  x.sort_order
from jsonb_to_recordset($agency$
[
 {
  "title": "这次用GenAI，我想达到的学习目的是",
  "title_en": "What I want to learn by using GenAI this time is",
  "category": "生成式 AI 交互/GAI 先想再问",
  "sort_order": 184,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 先想再问",
   "l2_en": "GAI Think first, then ask",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "adaptive_direction",
   "ae_ai_items": [
    "AD1"
   ]
  }
 },
 {
  "title": "问GenAI之前，我自己的想法是",
  "title_en": "Before asking GenAI, my own idea is",
  "category": "生成式 AI 交互/GAI 先想再问",
  "sort_order": 185,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 先想再问",
   "l2_en": "GAI Think first, then ask",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "adaptive_direction"
  }
 },
 {
  "title": "我判断GenAI答得好不好的标准是",
  "title_en": "My criteria for judging whether GenAI's answer is good are",
  "category": "生成式 AI 交互/GAI 先想再问",
  "sort_order": 186,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 先想再问",
   "l2_en": "GAI Think first, then ask",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "adaptive_direction",
   "ae_ai_items": [
    "AD1",
    "CI1"
   ]
  }
 },
 {
  "title": "这件事上，我交给GenAI做的和我自己做的分别是",
  "title_en": "On this task, what I hand to GenAI and what I do myself are",
  "category": "生成式 AI 交互/GAI 先想再问",
  "sort_order": 187,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 先想再问",
   "l2_en": "GAI Think first, then ask",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "adaptive_direction"
  }
 },
 {
  "title": "我告诉GenAI的背景和限定条件是",
  "title_en": "The background and constraints I gave GenAI are",
  "category": "生成式 AI 交互/GAI 先想再问",
  "sort_order": 188,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 先想再问",
   "l2_en": "GAI Think first, then ask",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Procedural",
   "saye_brush": "Hard",
   "agency_factor": "adaptive_direction",
   "ae_ai_items": [
    "AD1",
    "AD4"
   ]
  }
 },
 {
  "title": "GenAI的第一次回答不合我的需要，所以我把提问改成了",
  "title_en": "GenAI's first answer did not fit my need, so I changed my question to",
  "category": "生成式 AI 交互/GAI 先想再问",
  "sort_order": 189,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 先想再问",
   "l2_en": "GAI Think first, then ask",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "adaptive_direction",
   "ae_ai_items": [
    "AD2",
    "AD3"
   ]
  }
 },
 {
  "title": "同一个问题换一种问法，GenAI的回答不同在于",
  "title_en": "Asking the same question another way, GenAI's answer differed in",
  "category": "生成式 AI 交互/GAI 先想再问",
  "sort_order": 190,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 先想再问",
   "l2_en": "GAI Think first, then ask",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Conceptual",
   "saye_brush": "Hard",
   "agency_factor": "adaptive_direction",
   "ae_ai_items": [
    "AD3"
   ]
  }
 },
 {
  "title": "GenAI这个结论要成立，需要满足的前提是",
  "title_en": "For this GenAI conclusion to hold, what must be true is",
  "category": "生成式 AI 交互/GAI 判断与取舍",
  "sort_order": 191,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 判断与取舍",
   "l2_en": "GAI Judge and choose",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Conceptual",
   "saye_brush": "Hard",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI1"
   ],
   "literacy_items": [
    "CD4"
   ]
  }
 },
 {
  "title": "如果GenAI这里说错了，最可能错在",
  "title_en": "If GenAI is wrong here, the most likely mistake is",
  "category": "生成式 AI 交互/GAI 判断与取舍",
  "sort_order": 192,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 判断与取舍",
   "l2_en": "GAI Judge and choose",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI1"
   ]
  }
 },
 {
  "title": "GenAI的回答可能带有的偏向，或没有考虑到的立场是",
  "title_en": "Possible bias in GenAI's answer, or viewpoints it left out, are",
  "category": "生成式 AI 交互/GAI 判断与取舍",
  "sort_order": 193,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 判断与取舍",
   "l2_en": "GAI Judge and choose",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Conceptual",
   "saye_brush": "Hard",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI1"
   ],
   "literacy_items": [
    "EV3"
   ]
  }
 },
 {
  "title": "我要求GenAI说明依据，它给出的是，我的判断是",
  "title_en": "I asked GenAI for its basis; it gave ..., and my judgement is",
  "category": "生成式 AI 交互/GAI 判断与取舍",
  "sort_order": 194,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 判断与取舍",
   "l2_en": "GAI Judge and choose",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI1"
   ],
   "literacy_items": [
    "CD4"
   ]
  }
 },
 {
  "title": "GenAI的回答里，我决定采用的部分和理由是",
  "title_en": "The part of GenAI's answer I decided to use, and why",
  "category": "生成式 AI 交互/GAI 判断与取舍",
  "sort_order": 195,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 判断与取舍",
   "l2_en": "GAI Judge and choose",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI2"
   ]
  }
 },
 {
  "title": "GenAI的回答里，我决定不用的部分和理由是",
  "title_en": "The part of GenAI's answer I decided not to use, and why",
  "category": "生成式 AI 交互/GAI 判断与取舍",
  "sort_order": 196,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 判断与取舍",
   "l2_en": "GAI Judge and choose",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI2"
   ]
  }
 },
 {
  "title": "我用自己学过的知识修改了GenAI的一处说法，改动和依据是",
  "title_en": "I revised one GenAI statement using what I know; the change and my basis are",
  "category": "生成式 AI 交互/GAI 判断与取舍",
  "sort_order": 197,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 判断与取舍",
   "l2_en": "GAI Judge and choose",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Conceptual",
   "saye_brush": "Hard",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI3"
   ]
  }
 },
 {
  "title": "把GenAI的方案放到我们的具体情境里，需要调整的是",
  "title_en": "Fitting GenAI's proposal to our specific situation, what needs adjusting is",
  "category": "生成式 AI 交互/GAI 判断与取舍",
  "sort_order": 198,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 判断与取舍",
   "l2_en": "GAI Judge and choose",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI4"
   ]
  }
 },
 {
  "title": "用自己的话说，GenAI这段回答的意思是",
  "title_en": "In my own words, what GenAI's answer means is",
  "category": "生成式 AI 交互/GAI 判断与取舍",
  "sort_order": 199,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 判断与取舍",
   "l2_en": "GAI Judge and choose",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Conceptual",
   "saye_brush": "Hard",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI3"
   ]
  }
 },
 {
  "title": "我把GenAI的这个说法和课本、文献对照，发现",
  "title_en": "Comparing this GenAI claim with the textbook or literature, I found",
  "category": "生成式 AI 交互/GAI 多方求证",
  "sort_order": 200,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 多方求证",
   "l2_en": "GAI Check with others",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Procedural",
   "saye_brush": "Hard",
   "agency_factor": "cross_source_inquiry",
   "ae_ai_items": [
    "CS4"
   ]
  }
 },
 {
  "title": "GenAI和别的来源说法不一致，我更相信哪一个，理由是",
  "title_en": "GenAI and another source disagree; which I trust more, and why",
  "category": "生成式 AI 交互/GAI 多方求证",
  "sort_order": 201,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 多方求证",
   "l2_en": "GAI Check with others",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "cross_source_inquiry",
   "ae_ai_items": [
    "CS4"
   ]
  }
 },
 {
  "title": "我请同学核对了GenAI的这个说法，同学的意见是",
  "title_en": "I asked a classmate to check this GenAI claim; their view is",
  "category": "生成式 AI 交互/GAI 多方求证",
  "sort_order": 202,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 多方求证",
   "l2_en": "GAI Check with others",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Procedural",
   "saye_brush": "Hard",
   "agency_factor": "cross_source_inquiry",
   "ae_ai_items": [
    "CS2"
   ]
  }
 },
 {
  "title": "我把借助GenAI完成的这部分给同学或老师看了，他们的建议是",
  "title_en": "I showed the part I did with GenAI to a classmate or teacher; their suggestion is",
  "category": "生成式 AI 交互/GAI 多方求证",
  "sort_order": 203,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 多方求证",
   "l2_en": "GAI Check with others",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "cross_source_inquiry",
   "ae_ai_items": [
    "CS1"
   ]
  }
 },
 {
  "title": "我想请大家帮我核对GenAI的这个说法，我的疑问是",
  "title_en": "I would like help checking this GenAI claim; my doubt is",
  "category": "生成式 AI 交互/GAI 多方求证",
  "sort_order": 204,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 多方求证",
   "l2_en": "GAI Check with others",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Procedural",
   "saye_brush": "Hard",
   "agency_factor": "cross_source_inquiry",
   "ae_ai_items": [
    "CS2"
   ]
  }
 },
 {
  "title": "GenAI帮不上的地方是，所以我去找了",
  "title_en": "Where GenAI could not help, so I went to",
  "category": "生成式 AI 交互/GAI 多方求证",
  "sort_order": 205,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 多方求证",
   "l2_en": "GAI Check with others",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "cross_source_inquiry",
   "ae_ai_items": [
    "CS3"
   ]
  }
 },
 {
  "title": "我和同学问GenAI同一个问题，回答不一样的地方是",
  "title_en": "A classmate and I asked GenAI the same question; where our answers differ is",
  "category": "生成式 AI 交互/GAI 多方求证",
  "sort_order": 206,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 多方求证",
   "l2_en": "GAI Check with others",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Conceptual",
   "saye_brush": "Hard",
   "agency_factor": "cross_source_inquiry",
   "ae_ai_items": [
    "CS1",
    "CS4"
   ]
  }
 },
 {
  "title": "我们核对之后，对GenAI这个说法的共同判断是",
  "title_en": "After checking together, our shared judgement on this GenAI claim is",
  "category": "生成式 AI 交互/GAI 多方求证",
  "sort_order": 207,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 多方求证",
   "l2_en": "GAI Check with others",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Conceptual",
   "saye_brush": "Hard",
   "agency_factor": "cross_source_inquiry",
   "ae_ai_items": [
    "CS1"
   ]
  }
 },
 {
  "title": "我为这个结论负责，我做过的核对有",
  "title_en": "I stand behind this conclusion; the checks I have made are",
  "category": "生成式 AI 交互/GAI 多方求证",
  "sort_order": 208,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 多方求证",
   "l2_en": "GAI Check with others",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "cross_source_inquiry",
   "ae_ai_items": [
    "CS3",
    "CS4"
   ]
  }
 },
 {
  "title": "这次用GenAI，对我的学习目的有帮助和有妨碍的分别是",
  "title_en": "Using GenAI this time, what helped and what got in the way of my learning goal are",
  "category": "生成式 AI 交互/GAI 回顾与校准",
  "sort_order": 209,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 回顾与校准",
   "l2_en": "GAI Reflect and recalibrate",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "reflective_calibration",
   "ae_ai_items": [
    "RC1",
    "RC2"
   ]
  }
 },
 {
  "title": "合上GenAI，我现在能自己讲清楚的是，还讲不清的是",
  "title_en": "With GenAI closed, what I can now explain myself is ..., and what I still cannot is",
  "category": "生成式 AI 交互/GAI 回顾与校准",
  "sort_order": 210,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 回顾与校准",
   "l2_en": "GAI Reflect and recalibrate",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "reflective_calibration",
   "ae_ai_items": [
    "RC4"
   ]
  }
 },
 {
  "title": "和问GenAI之前相比，我的想法变化在于",
  "title_en": "Compared with before I asked GenAI, my thinking has changed in",
  "category": "生成式 AI 交互/GAI 回顾与校准",
  "sort_order": 211,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 回顾与校准",
   "l2_en": "GAI Reflect and recalibrate",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "reflective_calibration",
   "ae_ai_items": [
    "RC3"
   ]
  }
 },
 {
  "title": "我现在卡住的地方是，GenAI能帮上和帮不上的分别是",
  "title_en": "Where I am stuck now, and what GenAI can and cannot help with, are",
  "category": "生成式 AI 交互/GAI 回顾与校准",
  "sort_order": 212,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 回顾与校准",
   "l2_en": "GAI Reflect and recalibrate",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "reflective_calibration",
   "ae_ai_items": [
    "RC4"
   ]
  }
 },
 {
  "title": "这次GenAI出错的地方是，我是这样发现的",
  "title_en": "Where GenAI went wrong this time, and how I noticed, is",
  "category": "生成式 AI 交互/GAI 回顾与校准",
  "sort_order": 213,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 回顾与校准",
   "l2_en": "GAI Reflect and recalibrate",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Conceptual",
   "saye_brush": "Hard",
   "agency_factor": "reflective_calibration",
   "ae_ai_items": [
    "RC2"
   ],
   "literacy_items": [
    "EV2"
   ]
  }
 },
 {
  "title": "这次GenAI让我的判断更强或更弱的地方是",
  "title_en": "Where GenAI made my own judgement stronger or weaker this time is",
  "category": "生成式 AI 交互/GAI 回顾与校准",
  "sort_order": 214,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 回顾与校准",
   "l2_en": "GAI Reflect and recalibrate",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "reflective_calibration",
   "ae_ai_items": [
    "RC2"
   ],
   "literacy_items": [
    "CD3"
   ]
  }
 },
 {
  "title": "下次和GenAI协作，我会改变的一处做法是，因为",
  "title_en": "Next time I work with GenAI, one thing I will change is ..., because",
  "category": "生成式 AI 交互/GAI 回顾与校准",
  "sort_order": 215,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 回顾与校准",
   "l2_en": "GAI Reflect and recalibrate",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard",
   "agency_factor": "reflective_calibration",
   "ae_ai_items": [
    "RC2",
    "RC3"
   ]
  }
 },
 {
  "title": "回顾前面借助GenAI完成的任务，我的做法有了这样的变化",
  "title_en": "Looking back at earlier tasks I did with GenAI, my way of working has changed like this",
  "category": "生成式 AI 交互/GAI 回顾与校准",
  "sort_order": 216,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 回顾与校准",
   "l2_en": "GAI Reflect and recalibrate",
   "gai": false,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard",
   "agency_factor": "reflective_calibration",
   "ae_ai_items": [
    "RC3"
   ]
  }
 },
 {
  "title": "GenAI的这个说法，我还没有核对",
  "title_en": "GenAI's claim below, which I have not yet checked",
  "category": "生成式 AI 交互/GAI 怎样对待这段回答",
  "sort_order": 217,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 怎样对待这段回答",
   "l2_en": "GAI How I treat this answer",
   "gai": true,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard→Soft hybrid",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI1"
   ]
  }
 },
 {
  "title": "GenAI的这个说法，我已用别的来源核对过",
  "title_en": "GenAI's claim below, which I have checked against another source",
  "category": "生成式 AI 交互/GAI 怎样对待这段回答",
  "sort_order": 218,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 怎样对待这段回答",
   "l2_en": "GAI How I treat this answer",
   "gai": true,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Procedural",
   "saye_brush": "Hard→Soft hybrid",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CS4"
   ]
  }
 },
 {
  "title": "GenAI给的初稿，我会在它的基础上改写",
  "title_en": "GenAI's draft below, which I will rewrite",
  "category": "生成式 AI 交互/GAI 怎样对待这段回答",
  "sort_order": 219,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 怎样对待这段回答",
   "l2_en": "GAI How I treat this answer",
   "gai": true,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard→Soft hybrid",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI3",
    "CI4"
   ]
  }
 },
 {
  "title": "GenAI的这个说法，我打算当作反例来检验",
  "title_en": "GenAI's claim below, which I will test as a counter-example",
  "category": "生成式 AI 交互/GAI 怎样对待这段回答",
  "sort_order": 220,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 怎样对待这段回答",
   "l2_en": "GAI How I treat this answer",
   "gai": true,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard→Soft hybrid",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI1"
   ]
  }
 },
 {
  "title": "GenAI和我看法不同的地方",
  "title_en": "Where GenAI's view differs from mine",
  "category": "生成式 AI 交互/GAI 怎样对待这段回答",
  "sort_order": 221,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 怎样对待这段回答",
   "l2_en": "GAI How I treat this answer",
   "gai": true,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Conceptual",
   "saye_brush": "Hard→Soft hybrid",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI1"
   ]
  }
 },
 {
  "title": "我追问GenAI之后，它补充的依据",
  "title_en": "The basis GenAI added when I pressed it",
  "category": "生成式 AI 交互/GAI 怎样对待这段回答",
  "sort_order": 222,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 怎样对待这段回答",
   "l2_en": "GAI How I treat this answer",
   "gai": true,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard→Soft hybrid",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "AD3",
    "CI1"
   ]
  }
 },
 {
  "title": "GenAI帮我整理了我自己的想法，观点是我的",
  "title_en": "GenAI organised my own ideas; the ideas are mine",
  "category": "生成式 AI 交互/GAI 怎样对待这段回答",
  "sort_order": 223,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 怎样对待这段回答",
   "l2_en": "GAI How I treat this answer",
   "gai": true,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Metacognitive",
   "saye_brush": "Hard→Soft hybrid",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI3"
   ]
  }
 },
 {
  "title": "GenAI提供的备选，我暂时没有采用",
  "title_en": "An alternative from GenAI that I have not adopted for now",
  "category": "生成式 AI 交互/GAI 怎样对待这段回答",
  "sort_order": 224,
  "metadata": {
   "l1": "GAI",
   "l1_zh": "生成式 AI 交互",
   "l1_en": "Generative AI",
   "l2_zh": "GAI 怎样对待这段回答",
   "l2_en": "GAI How I treat this answer",
   "gai": true,
   "source": "agency_design_2026",
   "hannafin": "Human-AI Collaborative",
   "hannafin_function": "Strategic",
   "saye_brush": "Hard→Soft hybrid",
   "agency_factor": "critical_integration",
   "ae_ai_items": [
    "CI2"
   ]
  }
 }
]
$agency$::jsonb) as x(title text, title_en text, category text, sort_order int, metadata jsonb)
on conflict (category, title) where course_id is null do nothing;

notify pgrst, 'reload schema';
