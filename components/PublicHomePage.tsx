import React, { useState, useEffect, useRef } from 'react';
import { Link, Outlet, useOutletContext } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';
import { LangSwitcher3 } from './LangSwitcher';
import CardSwap, { Card } from './CardSwap';
import GooeyNav from './GooeyNav';
import TextType from './TextType';
import SpotlightCard from './SpotlightCard';
import RemixIcon from './RemixIcon';
import { readPublicLanguage, saveLanguagePreference } from '../utils/languagePreference';
import {
  ArrowRight, Menu, X, ArrowUp,
  ChevronRight
} from 'lucide-react';
import { gsap, prepareForMotion, shouldReduceMotion, useGSAP } from '../utils/gsapMotion';

type Lang = 'zh-CN' | 'en' | 'zh-TW';

export type PublicContextType = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: typeof TRANSLATIONS['zh-CN'];
  isZh: boolean;
};

const Silk = React.lazy(() => import('./Silk'));

// Knowledge Building 12 Principles
const KB_PRINCIPLES = [
  {
    id: 'real-ideas',
    en: {
      title: 'Real Ideas, Authentic Problems',
      description: 'Knowledge problems arise from efforts to understand the world. Ideas produced or appropriated are as real as things touched and felt.'
    },
    'zh-CN': {
      title: '真实观念与真实问题',
      description: '知识问题源于理解世界的努力。产生 or 采纳的观念与触摸和感受到的事物一样真实。'
    },
    'zh-TW': {
      title: '真實觀念與真實問題',
      description: '知識問題源於理解世界的努力。產生 or 採納的觀念與觸摸和感受到的事物一樣真實。'
    }
  },
  {
    id: 'improvable-ideas',
    en: {
      title: 'Improvable Ideas',
      description: 'Participants work continuously to improve the quality, coherence, and utility of ideas. The culture must be one where people feel safe in taking risks.'
    },
    'zh-CN': {
      title: '可改进的观念',
      description: '参与者持续努力提高观念的质量、一致性和实用性。文化必须是一个人们敢于冒险的安全环境。'
    },
    'zh-TW': {
      title: '可改進的觀念',
      description: '參與者持續努力提高觀念的品質、一致性和實用性。文化必須是一個人們敢於冒險的安全環境。'
    }
  },
  {
    id: 'idea-diversity',
    en: {
      title: 'Idea Diversity',
      description: 'To understand an idea is to understand the ideas that surround it, including those that stand in contrast to it – creating a rich environment for ideas to evolve.'
    },
    'zh-CN': {
      title: '观念多元化',
      description: '理解一个观念意味着理解围绕它的观念，包括与之形成对比的观念——为观念进化创造丰富的环境。'
    },
    'zh-TW': {
      title: '觀念多元化',
      description: '理解一個觀念意味著理解圍繞它的觀念，包括與之形成對比的觀念——為觀念進化創造豐富的環境。'
    }
  },
  {
    id: 'epistemic-agency',
    en: {
      title: 'Epistemic Agency',
      description: 'Participants set forth their ideas and negotiate a fit between personal ideas and ideas of others, using contrasts to spark and sustain knowledge advancement.'
    },
    'zh-CN': {
      title: '认知自主能动性',
      description: '参与者主动提出观念，并在个人观点与他人观点之间协商形成契合，利用差异激发并维持知识推进。'
    },
    'zh-TW': {
      title: '認知自主能動性',
      description: '參與者主動提出觀念，並在個人觀點與他人觀念之間協商形成契合，利用差異激發並維持知識推進。'
    }
  },
  {
    id: 'community-knowledge',
    en: {
      title: 'Community Knowledge, Collective Responsibility',
      description: 'Contributions to shared, top-level goals of the organization are prized and rewarded as much as individual achievements. All share responsibility for overall advancement.'
    },
    'zh-CN': {
      title: '社区知识与集体责任',
      description: '对组织共同高层次目标所作的贡献，应与个人成就同样受到重视与奖励。所有成员共同分担整体进步的责任。'
    },
    'zh-TW': {
      title: '社區知識與集體責任',
      description: '對組織共同高層次目標所作的貢獻，應與個人成就同樣受到重視與獎勵。所有成員共同分擔整體進步的責任。'
    }
  },
  {
    id: 'democratizing-knowledge',
    en: {
      title: 'Democratizing Knowledge',
      description: 'All participants are legitimate contributors to the shared goals of the community. Diversity does not lead to separations along knowledge have/have-not or innovator/non-innovator lines.'
    },
    'zh-CN': {
      title: '知识民主化',
      description: '所有参与者都是社区共同目标的合法贡献者。多样性不会导致知识拥有者/缺乏者或创新者/非创新者之间的分离。'
    },
    'zh-TW': {
      title: '知識民主化',
      description: '所有參與者都是社區共同目標的合法貢獻者。多樣性不會導致知識擁有者/缺乏者或創新者/非創新者之間的分離。'
    }
  },
  {
    id: 'symmetric-knowledge',
    en: {
      title: 'Symmetric Knowledge Advance',
      description: 'Expertise is distributed within and between communities. Symmetry in knowledge advancement results from knowledge exchange – to give knowledge is to get knowledge.'
    },
    'zh-CN': {
      title: '对称的知识进步',
      description: '专业知识在社区内部和社区之间分布。知识进步的对称性源于知识交换——给予知识就是获得知识。'
    },
    'zh-TW': {
      title: '對稱的知識進步',
      description: '專業知識在社區內部和社區之間分布。知識進步的對稱性源於知識交換——給予知識就是獲得知識。'
    }
  },
  {
    id: 'pervasive-knowledge-building',
    en: {
      title: 'Pervasive Knowledge Building',
      description: 'Knowledge building is not confined to particular occasions or subjects but pervades mental life – in and out of school.'
    },
    'zh-CN': {
      title: '无处不在的知识建构',
      description: '知识建构并不局限于某些特定时刻或学科，而是渗透于心智生活之中——无论在校内还是校外。'
    },
    'zh-TW': {
      title: '無處不在的知識建構',
      description: '知識建構並不局限於某些特定時刻或學科，而是滲透於心智生活之中——無論在校內還是校外。'
    }
  },
  {
    id: 'authoritative-sources',
    en: {
      title: 'Constructive Uses of Authoritative Sources',
      description: 'To be in touch with the present state and growing edge of knowledge in the field. This requires respect and understanding of authoritative sources, combined with a critical stance.'
    },
    'zh-CN': {
      title: '权威资料的建设性使用',
      description: '与领域知识的当前状态和前沿保持接触。这需要对权威资料的尊重和理解，同时结合批判性立场。'
    },
    'zh-TW': {
      title: '權威資料的建設性使用',
      description: '與領域知識的當前狀態和前沿保持接觸。這需要對權威資料的尊重和理解，同時結合批判性立場。'
    }
  },
  {
    id: 'kb-discourse',
    en: {
      title: 'Knowledge Building Discourse',
      description: 'The discourse of knowledge building communities results in more than the sharing of knowledge; the knowledge itself is refined and transformed through the discursive practices of the community.'
    },
    'zh-CN': {
      title: '知识建构话语',
      description: '知识建构共同体中的话语活动所带来的，不仅是知识的分享；知识本身会在共同体的话语实践中被精炼并转化。'
    },
    'zh-TW': {
      title: '知識建構話語',
      description: '知識建構共同體中的話語活動所帶來的，不僅是知識的分享；知識本身會在共同體的話語實踐中被精煉並轉化。'
    }
  },
  {
    id: 'embedded-assessment',
    en: {
      title: 'Embedded, Concurrent, Transformative Assessment',
      description: 'Assessment is part of the effort to advance knowledge – it is used to identify problems as the work proceeds and is embedded in the day-to-day workings of the organization.'
    },
    'zh-CN': {
      title: '嵌入式、并发性、转变性评估',
      description: '评估是知识推进工作的一部分——用于在工作进行中识别问题，并嵌入在组织的日常运作中。'
    },
    'zh-TW': {
      title: '嵌入式、並發性、轉變性評估',
      description: '評估是知識推進工作的一部分——用於工作進行中識別問題，並嵌入在組織的日常運作中。'
    }
  },
  {
    id: 'rise-above',
    en: {
      title: 'Rise Above',
      description: 'Creative knowledge building entails higher-level formulations of problems, working with diversity, complexity and messiness to achieve new syntheses and transcend trivialities and oversimplifications.'
    },
    'zh-CN': {
      title: '升华超越',
      description: '创造性知识建构需要更高层次的问题表述，处理多样性、复杂性和混乱，以实现新的综合，超越琐碎和过度简化。'
    },
    'zh-TW': {
      title: '升華超越',
      description: '創造性知識建構需要更高層次的問題表述，處理多樣性、複雜性和混亂，以實現新的綜合，超越瑣碎和過度簡化。'
    }
  }
];

const PRINCIPLE_CASES = {
  'real-ideas': {
    'zh-CN': '五年级科学探究中，学生围绕“水质污染与鱼类生存”提出真实的生态疑问，而非简单死记硬背水质指标，让这些 idea 成为社区共同改进的对象。',
    en: 'In Grade 5 Science, students raise authentic ecological questions about "water pollution and fish survival" instead of memorizing indexes, making their ideas community-improvable objects.'
  },
  'improvable-ideas': {
    'zh-CN': '学生在论坛上发布自己对于“光合作用”的初步直觉解释，在随后的同伴追问和补充实验数据支持下，该解释被不断补充、修正和完善。',
    en: 'A student posts an initial intuitive explanation of photosynthesis, which is continuously built-on, revised, and refined through peer critique and new lab data.'
  },
  'idea-diversity': {
    'zh-CN': '在研究“全球气候变化”时，班级论坛同时汇集了气象学家数据、经济学视角以及市民生活观察等多元观点，在冲突与对比中激发深度思考。',
    en: 'When examining global climate change, the forum aggregates meteorological data, economic viewpoints, and civic observations, sparking deep inquiry via cognitive contrast.'
  },
  'epistemic-agency': {
    'zh-CN': '学生自己设定探究目标，自主检索文献并寻找支撑证据，在论坛中协商个人观点与社区共识的契合度，掌握知识获取的主动权。',
    en: 'Students set their own goals, retrieve authoritative literature, and negotiate a fit between personal beliefs and community consensus, fully owning their learning paths.'
  },
  'community-knowledge': {
    'zh-CN': '全班以“设计低碳智能小区”为最高目标，个人产出的太阳能转换效率笔记成为社区共享的公共资产，所有人都为社区知识的整体推进负责。',
    en: 'With the shared goal of designing a low-carbon community, individual notes on solar efficiency serve as public resources, advancing collective community competence.'
  },
  'democratizing-knowledge': {
    'zh-CN': '在 HAKCC 中，学业基础薄弱的学生发布的简单疑惑同样被视为有价值的起点，同伴在此基础上搭建脚手架，实现社区全员知识民主化。',
    en: 'In HAKCC, simple questions from academic beginners are valued as key entry points, where peers build scaffolds to democratize knowledge access for everyone.'
  },
  'symmetric-knowledge': {
    'zh-CN': '“力学组”与“电学组”在设计电动车模型时，跨组交换关于能量损耗的数据与观点，通过知识的互惠流动实现两个小组的对称进步。',
    en: 'The mechanics and electronics teams exchange findings on energy loss when building an EV model, achieving symmetric growth through mutual knowledge transfer.'
  },
  'pervasive-knowledge-building': {
    'zh-CN': '课上关于“杠杆平衡”的未解争论延伸到了课外，学生在日常生活中观察起重机并拍照上传至论坛，让知识建构融入日常心智生活。',
    en: 'The ongoing debate on lever balance extends beyond the classroom; students photograph cranes in daily life and post them online to embed learning in pervasive life.'
  },
  'authoritative-sources': {
    'zh-CN': '学生探究“病毒变异”时，主动阅读世界卫生组织的官方报告，将其作为推导结论的辅助材料，同时保持严谨的批判性审视态度。',
    en: 'While investigating viral mutations, students consult official WHO reports as supportive resources, combining respect for authorities with a critical stance.'
  },
  'kb-discourse': {
    'zh-CN': '学生在讨论中极少只发表“赞同”等无效话语，而是通过“我想要补充(Build-on)”或“我的反驳证据是”进行深度思辨，推进观点转化。',
    en: 'Discourse transcends simple agreement; students continuously refine concepts using constructive prompts like "Build-on" or "My counter-evidence is".'
  },
  'embedded-assessment': {
    'zh-CN': 'AI 实时分析学生的话语语义网，生成群组观点进化热力图。学生根据热力图自评当前的认知缺口，动态调整下一步的探究方向。',
    en: 'AI runs background semantic network analyses, rendering a dynamic conceptual heat map that learners use to self-assess gaps and direct next steps.'
  },
  'rise-above': {
    'zh-CN': '面对关于“生命起源”的数十条零散论点，小组在 AI 辅助下剔除冗余，总结整理出一份整合了遗传、变异与自然选择的系统解释框架。',
    en: 'Facing dozens of chaotic arguments about evolution, students utilize AI synthesis tools to weed out trivialities and publish a unified, high-level theory.'
  }
};

const PRINCIPLE_ACTION_ICONS = ['question-answer-line', 'node-tree', 'line-chart-line'];

const PRINCIPLE_ACTIONS = {
  'real-ideas': {
    'zh-CN': {
      prompt: '把一个真实困惑转成公共 Note，让社区共同解释它，而不是先追求标准答案。',
      moves: ['写下真实问题和当前解释', '邀请同伴 Build-on 或追问', '把问题连接到共同知识问题'],
      signal: '学生能说明这个 Note 正在解释哪个真实现象。'
    },
    en: {
      prompt: 'Turn an authentic puzzle into a public Note so the community can explain it before rushing to final answers.',
      moves: ['Post the real problem and current explanation', 'Invite peer build-ons or questions', 'Connect it to the shared knowledge problem'],
      signal: 'Learners can name the real phenomenon this Note helps explain.'
    }
  },
  'improvable-ideas': {
    'zh-CN': {
      prompt: '把初步想法标记为可改进对象，让修订、证据和同伴反馈成为学习的一部分。',
      moves: ['指出当前解释最薄弱的一点', '根据反馈修订 Note', '保留改进前后的理由'],
      signal: '学生能看见 idea 如何从初稿变得更清楚、更有证据。'
    },
    en: {
      prompt: 'Treat the first idea as improvable, so revision, evidence, and peer feedback become part of the work.',
      moves: ['Name the weakest part of the explanation', 'Revise the Note using feedback', 'Keep reasons for each improvement visible'],
      signal: 'Learners can see how an idea becomes clearer and better evidenced.'
    }
  },
  'idea-diversity': {
    'zh-CN': {
      prompt: '把不同观点并置出来，让差异成为推进理解的资源，而不是需要被压平的分歧。',
      moves: ['找出两个互相张力的解释', '说明它们各自能解释什么', '发布一个需要综合的新问题'],
      signal: '社区能看见分歧如何打开更深入的探究。'
    },
    en: {
      prompt: 'Place different perspectives side by side so contrast becomes a resource for deeper understanding.',
      moves: ['Find two explanations in tension', 'Explain what each accounts for', 'Post a new question that needs synthesis'],
      signal: 'The community can see how disagreement opens deeper inquiry.'
    }
  },
  'epistemic-agency': {
    'zh-CN': {
      prompt: '让学生自己决定下一步如何推进知识，而不只是完成教师给出的步骤。',
      moves: ['选择一个值得推进的问题', '说明为什么由自己继续追踪', '记录下一步证据或访谈计划'],
      signal: '学生能为自己的探究路径给出清楚理由。'
    },
    en: {
      prompt: 'Let learners decide how to move knowledge forward instead of only following assigned steps.',
      moves: ['Choose a question worth advancing', 'Explain why they will pursue it', 'Record the next evidence or interview plan'],
      signal: 'Learners can justify their own inquiry path.'
    }
  },
  'community-knowledge': {
    'zh-CN': {
      prompt: '把个人贡献放回社区目标中，看它如何帮助全班共同理解一个问题。',
      moves: ['标注 Note 对共同问题的贡献', '邀请不同小组补充证据', '整理社区当前已经知道什么'],
      signal: 'Note 不只属于个人，也能推进社区知识状态。'
    },
    en: {
      prompt: 'Place individual contributions back into the shared goal and show how they advance community understanding.',
      moves: ['Mark the Note contribution to the shared problem', 'Invite evidence from other groups', 'Summarize what the community now knows'],
      signal: 'A Note advances the community state, not only individual output.'
    }
  },
  'democratizing-knowledge': {
    'zh-CN': {
      prompt: '把不同起点的学生都纳入知识生产，让简单疑问也能成为社区进步入口。',
      moves: ['把不确定表达为可讨论问题', '请同伴补充解释或例子', '把低门槛问题连接到高层目标'],
      signal: '更多学生能用自己的语言进入共同探究。'
    },
    en: {
      prompt: 'Include learners from different starting points so simple questions can become entry points for community progress.',
      moves: ['Turn uncertainty into a discussable question', 'Ask peers for explanations or examples', 'Link accessible questions to higher goals'],
      signal: 'More learners can enter the shared inquiry in their own words.'
    }
  },
  'symmetric-knowledge': {
    'zh-CN': {
      prompt: '促进小组之间互相给予和获得知识，让专业分工变成互惠的知识流动。',
      moves: ['向另一个小组请求关键数据', '分享本组可被复用的发现', '记录交换后双方理解的变化'],
      signal: '跨组 Build-on 让双方的解释都变得更强。'
    },
    en: {
      prompt: 'Create reciprocal knowledge flow between groups so giving knowledge also produces new understanding.',
      moves: ['Request key data from another group', 'Share findings others can reuse', 'Record how both sides changed understanding'],
      signal: 'Cross-group build-ons strengthen both explanations.'
    }
  },
  'pervasive-knowledge-building': {
    'zh-CN': {
      prompt: '把课堂外观察带回 HAKCC，让知识建构延伸到日常经验和真实场景。',
      moves: ['上传生活中的观察或照片', '解释它与课堂问题的关系', '邀请社区判断它能否作为证据'],
      signal: '学生能把校外经验转成可讨论、可改进的知识资源。'
    },
    en: {
      prompt: 'Bring observations from life back into HAKCC so knowledge building extends beyond class time.',
      moves: ['Upload an observation or photo from daily life', 'Explain its link to the class problem', 'Ask whether it can serve as evidence'],
      signal: 'Learners turn outside experience into discussable, improvable resources.'
    }
  },
  'authoritative-sources': {
    'zh-CN': {
      prompt: '把权威资料作为推进解释的资源，同时保留批判性判断和与问题的关联。',
      moves: ['摘出资料中真正相关的主张', '说明它支持或质疑哪个 Note', '写下还需要验证的限制'],
      signal: '引用不是装饰，而是帮助社区改进解释。'
    },
    en: {
      prompt: 'Use authoritative sources as resources for explanation while keeping critical judgment and relevance visible.',
      moves: ['Extract the claim that truly matters', 'Link it to the Note it supports or challenges', 'State limits that still need checking'],
      signal: 'Sources improve community explanation instead of serving as decoration.'
    }
  },
  'kb-discourse': {
    'zh-CN': {
      prompt: '把发言变成能推进知识的话语动作：澄清、质疑、补证据、综合，而不只是表态。',
      moves: ['选择一种关系类型再回应', '说明你的回应推进了什么', '追踪回应后 Note 的变化'],
      signal: '讨论能改变 idea 的质量，而不只是增加发言数量。'
    },
    en: {
      prompt: 'Turn talk into knowledge-building moves: clarify, challenge, add evidence, and synthesize instead of only reacting.',
      moves: ['Choose a relation type before replying', 'State what your response advances', 'Track how the Note changes afterward'],
      signal: 'Discourse changes idea quality, not only participation counts.'
    }
  },
  'embedded-assessment': {
    'zh-CN': {
      prompt: '把评估嵌入正在发生的知识工作，用缺口和进展信号决定下一步行动。',
      moves: ['查看当前知识缺口', '选择一个可立刻改进的 Note', '发布修订或教师反馈后的下一步'],
      signal: '评估结果能回到社区行动，而不是停留在仪表盘。'
    },
    en: {
      prompt: 'Embed assessment in ongoing knowledge work and use gap signals to decide the next move.',
      moves: ['Inspect current knowledge gaps', 'Choose one Note that can improve now', 'Post a revision or next step after feedback'],
      signal: 'Assessment returns to community action instead of staying in a dashboard.'
    }
  },
  'rise-above': {
    'zh-CN': {
      prompt: '把零散 Note 汇聚成更高层次的解释，命名模式、矛盾和新的综合问题。',
      moves: ['选出 3 个相关 Note', '概括它们共同解释的模式', '发布一个 Rise-above 综合 Note'],
      signal: '社区从片段观点上升到更有解释力的框架。'
    },
    en: {
      prompt: 'Bring scattered Notes into a higher-level explanation by naming patterns, tensions, and new synthesis questions.',
      moves: ['Select three related Notes', 'Summarize the pattern they explain together', 'Publish a Rise-above synthesis Note'],
      signal: 'The community rises from fragments toward a stronger explanatory frame.'
    }
  }
};

const TRANSLATIONS = {
  'zh-CN': {
    hero: {
      badge: '基于 Scardamalia & Bereiter 知识建构理论',
      title: '人智知识协作空间',
      subtitle: 'HAKCC 把 AI 引入知识建构的协作过程：观点在这里被记录、关联、质疑与改进，由社区共同推进知识的边界。',
      cta: { primary: '开始探索', secondary: '了解更多' },
      skipNav: '跳转到主要内容'
    },
    features: {
      title: '核心功能',
      subtitle: '赋能深度协作学习，支持知识持续改进',
      items: {
        knowledgeBuilding: { title: '知识建构', description: '基于知识论坛理念，支持观点记录、关联、改进和升华，让知识在协作中不断进化。' },
        aiAssistance: { title: 'AI 智能辅助', description: '集成 Gemini 等 AI 模型，提供智能提示、观点分析和知识图谱生成，增强学习体验。' },
        collaborativeTools: { title: '协作工具集', description: '计算思维画布、绘图工具、文件共享等多样化工具，支持多模态知识表达。' },
        progressTracking: { title: '学习追踪', description: '可视化学习进度，个人与社区知识成长轨迹一目了然。' },
        roleManagement: { title: '多角色支持', description: '学生、教师、管理员不同权限设计，满足教育场景多样化需求。' },
        securePlatform: { title: '安全可靠', description: '完善的身份认证与数据保护，保障学习社区安全稳定运行。' }
      }
    },
    principles: {
      title: '知识建构十二原则',
      subtitle: '基于 Marlene Scardamalia & Carl Bereiter 的开创性研究',
      reference: '参考: Scardamalia, M. (2002). Collective cognitive responsibility for the advancement of knowledge.',
      expandTip: '点击展开完整描述'
    },
    quotes: {
      title: '知识建构名言',
      quote1: {
        text: '知识建构作为一种教育路径，关注的是共同体知识的推进，而个体学习是其副产品。',
        author: 'Carl Bereiter & Marlene Scardamalia',
        source: 'Knowledge Building and Knowledge Creation, 2014'
      }
    },
    links: {
      title: '相关链接',
      kbWiki: { title: '知识建构 - Wikipedia', url: 'https://en.wikipedia.org/wiki/Knowledge_building' },
      kfWiki: { title: 'Knowledge Forum - Wikipedia', url: 'https://en.wikipedia.org/wiki/Knowledge_Forum' },
      ikit: { title: 'IKIT - 知识建构研究所', url: 'https://ikit.org/' }
    },
    auth: {
      loginTitle: '欢迎回来',
      loginSub: '登录以继续您的知识建构之旅',
      registerTitle: '加入社区',
      registerSub: '创建账户，开始协作学习',
      tabs: { login: '登录', register: '注册' },
      fields: { email: '邮箱', password: '密码', firstName: '名字', lastName: '姓氏', role: '身份', student: '学生', teacher: '教师' },
      placeholders: { email: 'your@email.com', password: '至少 6 位字符' },
      teacherWarn: '教师账户需管理员审批后方可登录',
      loginBtn: '登录',
      registerBtn: '创建账户'
    },
    nav: { features: '功能特色', principles: '十二原则', login: '登录', register: '注册' },
    footer: { description: '人智知识协作空间 · 基于 Scardamalia & Bereiter 的知识建构理论，让观点在协作中持续改进', copyright: '© 2026 HAKCC. 基于 Knowledge Forum 理念构建。' }
  },
  en: {
    hero: {
      badge: 'Based on Scardamalia & Bereiter\'s Knowledge Building Theory',
      title: 'Human-AI Knowledge Collaboration Commons',
      subtitle: 'HAKCC is an innovative collaborative learning platform that integrates Knowledge Building theory with AI technology, enabling learners to advance knowledge boundaries together.',
      cta: { primary: 'Start Exploring', secondary: 'Learn More' },
      skipNav: 'Skip to main content'
    },
    features: {
      title: 'Core Features',
      subtitle: 'Empowering deep collaborative learning and continuous knowledge improvement',
      items: {
        knowledgeBuilding: { title: 'Knowledge Building', description: 'Based on Knowledge Forum principles, support idea recording, linking, improvement, and rise-above.' },
        aiAssistance: { title: 'AI Assistance', description: 'Integrated with Gemini and other AI models, providing intelligent prompts and knowledge graph generation.' },
        collaborativeTools: { title: 'Collaborative Tools', description: 'Computational thinking canvas, drawing tools, file sharing to support multimodal knowledge expression.' },
        progressTracking: { title: 'Progress Tracking', description: 'Visualize learning progress, making personal and community knowledge growth trajectories clear.' },
        roleManagement: { title: 'Multi-Role Support', description: 'Different permission designs for students, teachers, and administrators.' },
        securePlatform: { title: 'Secure & Reliable', description: 'Comprehensive authentication and data protection ensure safe operation.' }
      }
    },
    principles: {
      title: '12 Knowledge Building Principles',
      subtitle: 'Based on groundbreaking research by Marlene Scardamalia & Carl Bereiter',
      reference: 'Reference: Scardamalia, M. (2002). Collective cognitive responsibility for the advancement of knowledge.',
      expandTip: 'Click to expand description'
    },
    quotes: {
      title: 'Knowledge Building Quotes',
      quote1: {
        text: 'Knowledge building, as an educational approach, focuses on the advancement of community knowledge, with individual learning as a by-product.',
        author: 'Carl Bereiter & Marlene Scardamalia',
        source: 'Knowledge Building and Knowledge Creation, 2014'
      }
    },
    links: {
      title: 'Related Links',
      kbWiki: { title: 'Knowledge Building - Wikipedia', url: 'https://en.wikipedia.org/wiki/Knowledge_building' },
      kfWiki: { title: 'Knowledge Forum - Wikipedia', url: 'https://en.wikipedia.org/wiki/Knowledge_Forum' },
      ikit: { title: 'IKIT - Institute for Knowledge Innovation', url: 'https://ikit.org/' }
    },
    auth: {
      loginTitle: 'Welcome back',
      loginSub: 'Sign in to continue your knowledge-building journey',
      registerTitle: 'Join the community',
      registerSub: 'Create an account to start collaborative learning',
      tabs: { login: 'Sign In', register: 'Register' },
      fields: { email: 'Email', password: 'Password', firstName: 'First name', lastName: 'Last name', role: 'Role', student: 'Student', teacher: 'Teacher' },
      placeholders: { email: 'your@email.com', password: 'At least 6 characters' },
      teacherWarn: 'Teacher accounts require administrator approval',
      loginBtn: 'Sign In',
      registerBtn: 'Create Account'
    },
    nav: { features: 'Features', principles: '12 Principles', login: 'Login', register: 'Register' },
    footer: { description: 'Human-AI Knowledge Collaboration Commons. Advancing knowledge through collaboration.', copyright: '© 2026 HAKCC. Built on Knowledge Forum principles.' }
  },
  'zh-TW': {
    hero: {
      badge: '基於 Scardamalia & Bereiter 知識建構理論',
      title: '人智知識協作空間',
      subtitle: 'HAKCC 把 AI 引入知識建構的協作過程：觀點在這裡被記錄、關聯、質疑與改進，由社群共同推進知識的邊界。',
      cta: { primary: '開始探索', secondary: '了解更多' },
      skipNav: '跳轉到主要內容'
    },
    features: {
      title: '核心功能',
      subtitle: '賦能深度協作學習，支援知識持續改進',
      items: {
        knowledgeBuilding: { title: '知識建構', description: '基於知識論壇理念，支援觀點記錄、關聯、改進和昇華，讓知識在協作中不斷進化。' },
        aiAssistance: { title: 'AI 智慧輔助', description: '整合 Gemini 等 AI 模型，提供智慧提示、觀點分析和知識圖譜生成，增強學習體驗。' },
        collaborativeTools: { title: '協作工具集', description: '計算思維畫布、繪圖工具、檔案共享等多樣化工具，支援多模態知識表達。' },
        progressTracking: { title: '學習追蹤', description: '視覺化學習進度，個人與社群知識成長軌跡一目瞭然。' },
        roleManagement: { title: '多角色支援', description: '學生、教師、管理員不同權限設計，滿足教育場景多樣化需求。' },
        securePlatform: { title: '安全可靠', description: '完善的身分認證與資料保護，保障學習社群安全穩定運作。' }
      }
    },
    principles: {
      title: '知識建構十二原則',
      subtitle: '基於 Marlene Scardamalia & Carl Bereiter 的開創性研究',
      reference: '參考: Scardamalia, M. (2002). Collective cognitive responsibility for the advancement of knowledge.',
      expandTip: '點擊展開完整描述'
    },
    quotes: {
      title: '知識建構名言',
      quote1: {
        text: '知識建構作為一種教育路徑，關注的是共同體知識的推進，而個體學習是其副產品。',
        author: 'Carl Bereiter & Marlene Scardamalia',
        source: 'Knowledge Building and Knowledge Creation, 2014'
      }
    },
    links: {
      title: '相關連結',
      kbWiki: { title: '知識建構 - Wikipedia', url: 'https://en.wikipedia.org/wiki/Knowledge_building' },
      kfWiki: { title: 'Knowledge Forum - Wikipedia', url: 'https://en.wikipedia.org/wiki/Knowledge_Forum' },
      ikit: { title: 'IKIT - 知識建構研究所', url: 'https://ikit.org/' }
    },
    auth: {
      loginTitle: '歡迎回來',
      loginSub: '登入以繼續您的知識建構之旅',
      registerTitle: '加入社區',
      registerSub: '創建帳號，開始協作學習',
      tabs: { login: '登入', register: '註冊' },
      fields: { email: '電子郵件', password: '密碼', firstName: '名字', lastName: '姓氏', role: '身份', student: '學生', teacher: '教師' },
      placeholders: { email: 'your@email.com', password: '至少 6 位字元' },
      teacherWarn: '教師帳號需管理員審核後方可登入',
      loginBtn: '登入',
      registerBtn: '創建帳號'
    },
    nav: { features: '功能特色', principles: '十二原則', login: '登入', register: '註冊' },
    footer: { description: '人智知識協作空間 · 基於 Scardamalia & Bereiter 的知識建構理論，讓觀點在協作中持續改進', copyright: '© 2026 HAKCC. 基於 Knowledge Forum 理念構建。' }
  }
};

const PRINCIPLE_COLORS = [
  '#3457D5', // Royal primary
  '#000080', // Navy anchor
  '#5B78E8', // Active blue
  '#8EA4FF', // Glow blue
  '#B42318', // Critical red
  '#B7791F', // Evidence gold
  '#5B78E8',
  '#3457D5',
  '#000080',
  '#6D5BD0', // AI / rise-above accent
  '#B42318',
  '#B7791F'
];


// Hook for scroll progress
const useScrollProgress = () => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const updateProgress = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent = (scrollTop / docHeight) * 100;
      setProgress(Math.min(scrollPercent, 100));
    };

    window.addEventListener('scroll', updateProgress);
    updateProgress();

    return () => window.removeEventListener('scroll', updateProgress);
  }, []);

  return progress;
};

// Animated Section Wrapper
const AnimatedSection: React.FC<{
  children: React.ReactNode;
  className?: string;
  delay?: number;
}> = ({ children, className = '', delay = 0 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [animate, setAnimate] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shouldReduceMotion()) return;

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setRevealed(true);
      return;
    }

    setAnimate(true);
    const reveal = () => setRevealed(true);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          reveal();
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(el);

    const fallback = window.setTimeout(reveal, 1600);
    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  const hidden = animate && !revealed;

  return (
    <div
      ref={ref}
      className={`${animate ? 'transition-[opacity,transform] duration-700 ease-out' : ''} ${
        hidden ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
      } ${className}`}
      style={hidden ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

// Principle row
const PrincipleCard: React.FC<{
  principle: typeof KB_PRINCIPLES[0];
  index: number;
  lang: Lang;
  isZh: boolean;
  isActive: boolean;
  onSelect: () => void;
}> = ({ principle, index, lang, isZh, isActive, onSelect }) => {
  const p = principle[lang];

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`p-5 rounded-2xl border transition-all duration-300 ${isActive ? 'bg-white dark:bg-slate-800 border-[#3457D5] shadow-xl' : 'bg-transparent border-slate-200/50 dark:border-white/5 hover:border-[#3457D5]/25 dark:hover:border-white/10'}`}
    >
      <div className="flex items-center gap-4 mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${isActive ? 'bg-[#3457D5] text-white' : 'bg-white/5 text-gray-400'}`}>
          {index + 1}
        </div>
        <h3 className="text-lg font-bold">{p.title}</h3>
      </div>
      <p className={`text-sm transition-opacity ${isActive ? 'opacity-100' : 'opacity-60'}`}>{p.description}</p>
    </div>
  );
};

// Knowledge Building Principles Card Grid
const KBPrincipleCards: React.FC<{ isZh: boolean }> = ({ isZh }) => {
  const principles = [
    {
      icon: 'lightbulb-line',
      title: isZh ? '真实想法' : 'Real Ideas',
      desc: isZh
        ? '学习者从真实问题出发，提出有解释力的本质问题，而非记忆死板概念'
        : 'Learners propose explanation-seeking questions grounded in authentic real-world problems',
      tag: isZh ? '探究起点' : 'Starting Point',
      color: { bg: 'bg-red-500/8 dark:bg-red-500/15', text: 'text-red-600 dark:text-red-400', tagBg: 'bg-red-50 dark:bg-red-500/10', tagText: 'text-red-600 dark:text-red-400', border: 'border-red-500/15 dark:border-red-500/20' },
    },
    {
      icon: 'loop-left-line',
      title: isZh ? '可改进的想法' : 'Improvable Ideas',
      desc: isZh
        ? '所有想法都可被持续改进，通过批判与求证推进深度和逻辑一致性'
        : 'All ideas are improvable — community members continuously critique and refine them',
      tag: isZh ? '迭代过程' : 'Iteration',
      color: { bg: 'bg-[#3457D5]/8 dark:bg-[#3457D5]/15', text: 'text-[#3457D5] dark:text-[#8EA4FF]', tagBg: 'bg-[#EEF2FF] dark:bg-[#3457D5]/10', tagText: 'text-[#3457D5] dark:text-[#8EA4FF]', border: 'border-[#3457D5]/15 dark:border-[#3457D5]/20' },
    },
    {
      icon: 'team-line',
      title: isZh ? '社区知识' : 'Community Knowledge',
      desc: isZh
        ? '知识是社区共同体的公共产品，大家分担推进集体理解的责任'
        : 'Knowledge is a community product — collective responsibility drives shared understanding',
      tag: isZh ? '协作基础' : 'Collaboration',
      color: { bg: 'bg-emerald-500/8 dark:bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', tagBg: 'bg-emerald-50 dark:bg-emerald-500/10', tagText: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/15 dark:border-emerald-500/20' },
    },
    {
      icon: 'rocket-line',
      title: isZh ? '升华超越' : 'Rise Above',
      desc: isZh
        ? '将零散的低阶想法归纳整合，上升为更具普适性和系统性的高阶观点'
        : 'Synthesize disparate ideas into unified, advanced, and systematic higher-order concepts',
      tag: isZh ? '认知跃升' : 'Cognitive Leap',
      color: { bg: 'bg-purple-500/8 dark:bg-purple-500/15', text: 'text-purple-600 dark:text-purple-400', tagBg: 'bg-purple-50 dark:bg-purple-500/10', tagText: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/15 dark:border-purple-500/20' },
    },
    {
      icon: 'book-marked-line',
      title: isZh ? '权威来源' : 'Authoritative Sources',
      desc: isZh
        ? '将文献与专家意见融入探究，通过对照激发更深入的批判性思考'
        : 'Integrate literature and expert knowledge into active inquiries to deepen critical thinking',
      tag: isZh ? '质量保障' : 'Quality',
      color: { bg: 'bg-amber-500/8 dark:bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', tagBg: 'bg-amber-50 dark:bg-amber-500/10', tagText: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/15 dark:border-amber-500/20' },
    },
    {
      icon: 'puzzle-line',
      title: isZh ? '建设性使用' : 'Constructive Use',
      desc: isZh
        ? '将知识带入新的复杂情境，验证其普适性并解决更广泛的现实挑战'
        : 'Apply synthesized knowledge to new scenarios, validating its generalizability',
      tag: isZh ? '价值转化' : 'Application',
      color: { bg: 'bg-cyan-500/8 dark:bg-cyan-500/15', text: 'text-cyan-600 dark:text-cyan-400', tagBg: 'bg-cyan-50 dark:bg-cyan-500/10', tagText: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-500/15 dark:border-cyan-500/20' },
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
      {principles.map((p, i) => (
        <div
          key={i}
          className={`group relative bg-white dark:bg-white/[0.04] rounded-2xl p-5 border ${p.color.border} hover:border-[#3457D5]/30 dark:hover:border-[#8EA4FF]/25 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-[#3457D5]/6`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${p.color.bg} ${p.color.text} mb-3`}>
            <RemixIcon name={p.icon} size={20} />
          </div>
          <h4 className="font-bold text-sm text-gray-900 dark:text-white mb-1.5">{p.title}</h4>
          <p className="text-xs text-gray-500 dark:text-white/55 leading-relaxed mb-3">{p.desc}</p>
          <span className={`inline-block text-[0.6875rem] font-semibold px-2 py-0.5 rounded-md ${p.color.tagBg} ${p.color.tagText}`}>
            {p.tag}
          </span>
        </div>
      ))}
    </div>
  );
};

const DemoSection: React.FC<{ lang: Lang; isZh: boolean }> = ({ isZh }) => {
  return (
    <section className="py-16 sm:py-20 px-4 bg-gradient-to-b from-white to-[#F7F9FF] dark:from-[#05064D] dark:to-[#070A3F]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8 sm:mb-9">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 text-balance">
            {isZh ? 'HAKCC 系统架构介绍' : 'Architecting Epistemic Networks: The HAKCC System'}
          </h2>
          <p className="text-gray-600 dark:text-white/72 text-sm sm:text-base max-w-2xl mx-auto text-pretty">
            {isZh
              ? '深入了解 HAKCC 如何通过人智协同推动知识建构'
              : 'Explore how HAKCC advances knowledge building through human-AI collaboration'}
          </p>
        </div>

        <div className="relative">
          <div className="aspect-video rounded-2xl overflow-hidden shadow-2xl border border-gray-200 dark:border-white/10 bg-black">
            <iframe
              className="w-full h-full"
              src="https://www.youtube.com/embed/_VQkDzA4rZA"
              title="HAKCC - Architecting Epistemic Networks"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </section>
  );
};

// About Knowledge Building Section Component
const AboutKBSection: React.FC<{ lang: Lang; isZh: boolean }> = ({ lang, isZh }) => {
  return (
    <section className="py-16 sm:py-24 px-4 bg-white dark:bg-[#05064D] tech-dot-grid relative overflow-hidden">
      {/* Decorative Radial Background Light */}
      <div className="absolute top-1/4 right-1/4 w-[300px] h-[300px] bg-[#3457D5]/[0.07] dark:bg-[#8EA4FF]/[0.05] blur-[100px] rounded-full pointer-events-none z-0" />
      
      <div className="relative z-10 max-w-[94%] mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3 text-balance tracking-tight">
            {isZh ? '什么是知识建构？' : 'What is Knowledge Building?'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-white/60">
            Based on research by Marlene Scardamalia & Carl Bereiter, University of Toronto
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1.8fr] gap-8 items-stretch">
          {/* LEFT: Theoretical Background (SpotlightCard) */}
          <div className="w-full">
            <SpotlightCard className="w-full h-full flex flex-col justify-between p-6 sm:p-8" spotlightColor="rgba(52, 87, 213, 0.04)" borderColor="rgba(52, 87, 213, 0.18)">
              <div className="flex flex-col gap-6">
                <div className="w-11 h-11 rounded-xl bg-[#EEF2FF] dark:bg-[#3457D5]/15 text-[#3457D5] dark:text-[#8EA4FF] flex items-center justify-center border border-[#D8E1FF] dark:border-[#3457D5]/30">
                  <RemixIcon name="graduation-cap-line" size={20} />
                </div>
                <div className="space-y-4">
                  <p className="text-base sm:text-lg text-gray-800 dark:text-white/90 leading-relaxed font-medium">
                    {isZh
                      ? '知识建构（KB）是由多伦多大学 Marlene Scardamalia 和 Carl Bereiter（2006）开发的教学方法，旨在支持年轻人知识建构能力的发展。'
                      : 'The Knowledge Building (KB) pedagogical approach developed by Marlene Scardamalia and Carl Bereiter (2006) at the University of Toronto aims to support the development of young people\'s knowledge-building capability.'
                    }
                  </p>
                  <p className="text-sm sm:text-base text-gray-600 dark:text-white/70 leading-relaxed">
                    {isZh
                      ? '该方法由 12 个教学原则支撑，并由基于网络的协作知识广场 Knowledge Forum 支持。在探究中，学生被鼓励去产生解释性问题，通过渐进式的研究过程来发展有前景的观点，从而形成可信的解决方案。'
                      : 'It is underpinned by 12 pedagogical principles and supported by a web-based networking software called Knowledge Forum. Students are encouraged to generate explanation-seeking questions, developing promising ideas to produce credible solutions.'
                    }
                  </p>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-gray-150 dark:border-white/5">
                <p className="text-xs text-gray-400 dark:text-white/40 mb-1">
                  Source: Macpherson, M. (2019). What is Knowledge Building?
                </p>
                <p className="text-[0.6875rem] text-gray-400/80 dark:text-white/30">
                  {isZh ? '本文内容基于 Margaret Macpherson 的研究成果' : 'Content based on research article by Margaret Macpherson'}
                </p>
              </div>
            </SpotlightCard>
          </div>

          {/* RIGHT: Three Core Characteristics (SpotlightCard list) */}
          <div className="flex flex-col gap-6 h-full justify-between">
            {[
              {
                icon: 'team-line',
                tint: 'text-[#3457D5] dark:text-[#8EA4FF] bg-[#EEF2FF] dark:bg-[#3457D5]/15 border-[#D8E1FF] dark:border-[#3457D5]/30',
                spotColor: 'rgba(52, 87, 213, 0.04)',
                bdrColor: 'rgba(52, 87, 213, 0.18)',
                badge: isZh ? '共同责任' : 'Collective Responsibility',
                title: isZh ? '社会协作与观点改进的共同责任' : 'Shared Responsibility for Idea Improvement',
                desc: isZh
                  ? '当学生一起工作、分担建构、批评和改进观点的责任，通过渐进式探究产生对社区有益的更好观点时，他们就是在进行知识建构。'
                  : 'When students work together and share responsibility for building, critiquing and improving ideas in a process of progressive inquiry to create better ideas for the community.'
              },
              {
                icon: 'mind-map',
                tint: 'text-[#5B78E8] dark:text-[#DDE6FF] bg-[#EEF2FF] dark:bg-[#5B78E8]/15 border-[#D8E1FF] dark:border-[#5B78E8]/30',
                spotColor: 'rgba(91, 120, 232, 0.04)',
                bdrColor: 'rgba(91, 120, 232, 0.18)',
                badge: isZh ? '高阶认知' : 'Cognitive Advancement',
                title: isZh ? '协作与高阶智力能力的全面培养' : 'Collaborative & Intellectual Capabilities',
                desc: isZh
                  ? '学生在知识建构中培养的协作和智力能力，可以更好地为他们准备解决他们和社区可能面临的复杂问题。'
                  : 'The collaborative and intellectual capabilities students develop as they engage in Knowledge Building can better prepare them to work on solutions to complex problems.'
              },
              {
                icon: 'open-arm-line',
                tint: 'text-[#000080] dark:text-[#DDE6FF] bg-[#EEF2FF] dark:bg-[#000080]/25 border-[#D8E1FF] dark:border-[#8EA4FF]/25',
                spotColor: 'rgba(0, 0, 128, 0.04)',
                bdrColor: 'rgba(0, 0, 128, 0.16)',
                badge: isZh ? '真实情境' : 'Authentic Context',
                title: isZh ? '为观点的共同进化提供真实情境' : 'Authentic Context for Collective Evolution',
                desc: isZh
                  ? '知识建构是学生发展所需能力的真实情境，使他们能够在专注于改进对社区有益的观点的社区中发挥积极作用。'
                  : 'Knowledge Building is an authentic context for students to develop competencies to take an active role in a community focused on improving ideas of benefit to the community.'
              }
            ].map((char, cidx) => (
              <SpotlightCard key={cidx} className="flex-1 flex flex-col justify-center p-6" spotlightColor={char.spotColor} borderColor={char.bdrColor}>
                <div className="flex gap-4 sm:gap-5 items-start">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border ${char.tint}`}>
                    <RemixIcon name={char.icon} size={18} />
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-block text-[0.6875rem] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/50">
                        {char.badge}
                      </span>
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white leading-snug">
                      {char.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-white/60 leading-relaxed text-pretty">
                      {char.desc}
                    </p>
                  </div>
                </div>
              </SpotlightCard>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};


// --------------------- SUB-PAGES COMPONENTS ---------------------

type HeroMotifVariant = 'real' | 'improve' | 'collective';

const heroCardChrome = 'bg-[linear-gradient(145deg,rgba(0,0,128,0.90)_0%,rgba(17,18,122,0.88)_54%,rgba(52,87,213,0.58)_100%)] !border-[#3457D5]/24 shadow-[inset_0_1px_0_rgba(142,164,255,0.10),0_28px_80px_-38px_rgba(0,0,80,0.94)] backdrop-blur-xl';
const heroCardHeader = 'flex h-10 items-center gap-2 border-b border-[#3457D5]/20 bg-[#0B1475]/34 px-4 text-sm font-semibold text-[#EEF2FF]';
const heroCardIcon = 'inline-flex h-5 w-5 items-center justify-center rounded-md border border-[#6F86F2]/24 bg-[#3457D5]/14 text-[#DDE6FF]';
const heroCardBody = 'relative h-[340px] overflow-hidden bg-[radial-gradient(circle_at_52%_30%,rgba(91,120,232,0.34),transparent_44%),linear-gradient(145deg,#000080_0%,#11127A_52%,#06105E_100%)]';

const HeroKnowledgeMotif: React.FC<{ variant: HeroMotifVariant }> = ({ variant }) => {
  return (
    <div className="absolute left-1/2 top-[38%] h-[168px] w-[224px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#3457D5]/18 bg-[#071069]/70 shadow-[inset_0_1px_0_rgba(142,164,255,0.08),0_18px_50px_-30px_rgba(0,0,80,0.95)] backdrop-blur-md">
      <svg className="h-full w-full" viewBox="0 0 224 168" role="img" aria-hidden="true">
        <defs>
          <linearGradient id={`hero-motif-line-${variant}`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#EEF2FF" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#8EA4FF" stopOpacity="0.58" />
          </linearGradient>
          <filter id={`hero-motif-soft-${variant}`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#8EA4FF" floodOpacity="0.18" />
          </filter>
        </defs>

        <rect x="14" y="14" width="196" height="140" rx="18" fill="#0B1475" opacity="0.58" />
        <path d="M34 45H190M34 84H190M34 123H190M70 28V140M112 28V140M154 28V140" stroke="#8EA4FF" strokeWidth="1" strokeDasharray="4 7" opacity="0.24" />

        {variant === 'real' && (
          <g filter={`url(#hero-motif-soft-${variant})`}>
            <path d="M68 52C82 36 111 35 126 53C137 66 137 87 126 101C112 119 83 119 68 102C54 86 54 68 68 52Z" fill="#121B82" stroke="#8EA4FF" strokeWidth="1.5" />
            <path d="M80 69C84 58 101 55 109 64C117 73 109 82 100 86V94" fill="none" stroke="#EEF2FF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="100" cy="107" r="3.8" fill="#EEF2FF" />
            <path d="M126 78C148 72 162 79 174 94" fill="none" stroke={`url(#hero-motif-line-${variant})`} strokeWidth="3" strokeLinecap="round" strokeDasharray="6 5" />
            <rect x="145" y="94" width="42" height="28" rx="8" fill="#17279A" stroke="#8EA4FF" strokeWidth="1.4" />
            <path d="M154 104H178M154 112H170" stroke="#DDE6FF" strokeWidth="2" strokeLinecap="round" opacity="0.78" />
            <circle cx="52" cy="116" r="8" fill="#F3C969" opacity="0.9" />
            <circle cx="188" cy="54" r="6" fill="#8EA4FF" opacity="0.85" />
          </g>
        )}

        {variant === 'improve' && (
          <g filter={`url(#hero-motif-soft-${variant})`}>
            <rect x="55" y="44" width="82" height="58" rx="12" fill="#0F1A83" stroke="#8EA4FF" strokeWidth="1.5" />
            <rect x="70" y="58" width="82" height="58" rx="12" fill="#142592" stroke="#8EA4FF" strokeWidth="1.5" />
            <rect x="85" y="72" width="82" height="58" rx="12" fill="#172DA8" stroke="#DDE6FF" strokeWidth="1.8" />
            <path d="M99 91H150M99 104H138" stroke="#EEF2FF" strokeWidth="3" strokeLinecap="round" opacity="0.76" />
            <path d="M151 45C179 52 190 75 178 100" fill="none" stroke="#B7791F" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 5" />
            <path d="M174 101L181 99L178 93" fill="none" stroke="#B7791F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="49" cy="66" r="7" fill="#8EA4FF" />
            <circle cx="176" cy="127" r="8" fill="#F3C969" />
          </g>
        )}

        {variant === 'collective' && (
          <g filter={`url(#hero-motif-soft-${variant})`}>
            <path d="M112 82L62 54M112 82L164 56M112 82L58 118M112 82L166 119M62 54L58 118M164 56L166 119" stroke={`url(#hero-motif-line-${variant})`} strokeWidth="2.4" strokeLinecap="round" opacity="0.82" />
            <circle cx="112" cy="82" r="20" fill="#121B82" stroke="#DDE6FF" strokeWidth="2" />
            <path d="M102 80H122M102 89H116M102 71H118" stroke="#EEF2FF" strokeWidth="2.4" strokeLinecap="round" />
            <circle cx="62" cy="54" r="13" fill="#142592" stroke="#8EA4FF" strokeWidth="1.5" />
            <circle cx="164" cy="56" r="13" fill="#142592" stroke="#8EA4FF" strokeWidth="1.5" />
            <circle cx="58" cy="118" r="13" fill="#142592" stroke="#8EA4FF" strokeWidth="1.5" />
            <circle cx="166" cy="119" r="13" fill="#242070" stroke="#F3C969" strokeWidth="1.5" />
            <circle cx="62" cy="54" r="3" fill="#DDE6FF" />
            <circle cx="164" cy="56" r="3" fill="#DDE6FF" />
            <circle cx="58" cy="118" r="3" fill="#DDE6FF" />
            <circle cx="166" cy="119" r="3" fill="#B7791F" />
          </g>
        )}
      </svg>
    </div>
  );
};

const GenerativeLearningSurface: React.FC<{ isZh: boolean }> = ({ isZh }) => {
  const surfaces = isZh
    ? [
        { label: 'Note 语义信号', value: '证据缺口', icon: 'radar-line' },
        { label: 'AI 选择界面', value: '反馈卡 + 文献线索', icon: 'layout-grid-line' },
        { label: '下一步行动', value: 'Build-on 或 Rise-above', icon: 'route-line' },
      ]
    : [
        { label: 'Note signal', value: 'Evidence gap', icon: 'radar-line' },
        { label: 'AI-chosen surface', value: 'Feedback card + source trail', icon: 'layout-grid-line' },
        { label: 'Next move', value: 'Build-on or Rise-above', icon: 'route-line' },
      ];

  const toolCards = isZh
    ? [
        { title: 'Feedback Card', meta: '学生当前 Note', body: 'AI 将泛泛建议压缩成可执行的改进问题。', tone: 'blue' },
        { title: 'Evidence Trail', meta: '权威资料连接', body: '把缺失概念、可引用证据和下一步检索路径放在同一张卡里。', tone: 'amber' },
        { title: 'Rise-above Draft', meta: '社区综合', body: '从多条 Note 中生成更高层次的解释框架，教师可审核后发布。', tone: 'violet' },
      ]
    : [
        { title: 'Feedback Card', meta: 'Current student Note', body: 'The AI turns broad advice into actionable improvement questions.', tone: 'blue' },
        { title: 'Evidence Trail', meta: 'Authoritative source path', body: 'Missing concepts, citeable evidence, and search next-steps stay in one surface.', tone: 'amber' },
        { title: 'Rise-above Draft', meta: 'Community synthesis', body: 'Multiple Notes become a higher-level explanation that teachers can review.', tone: 'violet' },
      ];

  const toneClass: Record<string, string> = {
    blue: 'border-[#8EA4FF]/30 bg-[#3457D5]/12 text-[#DDE6FF]',
    amber: 'border-[#F3C969]/35 bg-[#B7791F]/14 text-[#FFF1C2]',
    violet: 'border-[#BDB4FE]/35 bg-[#6D5BD0]/16 text-[#EEE9FF]',
  };

  return (
    <section className="relative overflow-hidden bg-[#F7F9FF] px-4 py-14 dark:bg-[#05064D] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <AnimatedSection>
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#3457D5]/18 bg-white/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#3457D5] shadow-sm dark:border-white/10 dark:bg-white/8 dark:text-[#DDE6FF]">
                <RemixIcon name="sparkling-line" size={13} />
                {isZh ? 'Generative learning UI' : 'Generative learning UI'}
              </div>
              <h2 className="font-react-bits text-3xl font-normal leading-tight tracking-normal text-slate-950 dark:text-white sm:text-4xl lg:text-5xl">
                {isZh ? 'AI 不只是回复文字，而是生成学习行动界面。' : 'AI should not only reply. It should shape the next learning surface.'}
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-slate-600 dark:text-white/68">
              {isZh
                ? '参考 Generative UI 的思路：系统保留教学控制权，AI 根据 Note、证据缺口和社区状态选择最合适的反馈 surface。'
                : 'Following the generative UI pattern: HAKCC keeps pedagogical control while AI selects the most useful surface from Notes, gaps, and community context.'}
            </p>
          </div>
        </AnimatedSection>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <AnimatedSection delay={80} className="h-full">
            <SpotlightCard
              className="h-full min-h-[430px] border-[#3457D5]/20 shadow-[0_28px_90px_-52px_rgba(0,0,128,0.55)]"
              innerClassName="p-0"
              spotlightColor="rgba(52, 87, 213, 0.10)"
            >
              <div className="relative flex h-full flex-col overflow-hidden bg-white dark:bg-[#080A3A]">
                <div className="border-b border-slate-200/70 bg-slate-50/80 px-5 py-4 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-white/45">
                        {isZh ? 'Runtime context' : 'Runtime context'}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {isZh ? '从学习信号到界面选择' : 'From learning signal to UI choice'}
                      </div>
                    </div>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
                      {isZh ? 'Live' : 'Live'}
                    </span>
                  </div>
                </div>

                <div className="flex-1 space-y-3 p-5">
                  {surfaces.map((item, index) => (
                    <div key={item.label} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[#3457D5]/30 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.04]">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[#3457D5]/18 bg-[#EEF2FF] text-[#3457D5] dark:border-[#8EA4FF]/18 dark:bg-[#3457D5]/14 dark:text-[#DDE6FF]">
                          <RemixIcon name={item.icon} size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            {String(index + 1).padStart(2, '0')} / {item.label}
                          </div>
                          <div className="mt-1 text-base font-semibold text-slate-900 dark:text-white">{item.value}</div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="rounded-2xl border border-dashed border-[#3457D5]/30 bg-[#EEF2FF]/55 p-4 dark:border-[#8EA4FF]/22 dark:bg-[#3457D5]/10">
                    <TextType
                      as="div"
                      text={isZh
                        ? ['Surface update: 需要证据脚手架', 'Data model update: 关联 6 条 Note', 'Begin rendering: 可审核反馈卡']
                        : ['Surface update: evidence scaffold needed', 'Data model update: six Notes linked', 'Begin rendering: reviewable feedback card']}
                      typingSpeed={34}
                      deletingSpeed={18}
                      pauseDuration={1200}
                      cursorCharacter="_"
                      className="min-h-[2rem] font-mono text-sm font-semibold text-[#000080] dark:text-[#DDE6FF]"
                      cursorClassName="text-[#B7791F]"
                    />
                  </div>
                </div>
              </div>
            </SpotlightCard>
          </AnimatedSection>

          <AnimatedSection delay={160} className="h-full">
            <div className="relative h-full min-h-[430px] overflow-hidden rounded-3xl border border-[#10217C]/18 bg-[#05064D] p-5 shadow-[0_34px_100px_-48px_rgba(0,0,80,0.9)]">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(52,87,213,0.34),transparent_34%),linear-gradient(220deg,rgba(183,121,31,0.22),transparent_30%)]" />
              <div className="relative z-10 flex h-full flex-col">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.22em] text-[#8EA4FF]">
                      {isZh ? 'Preview surface' : 'Preview surface'}
                    </div>
                    <h3 className="mt-1 font-react-bits text-3xl font-normal text-white">
                      {isZh ? 'Teacher-reviewable AI output' : 'Teacher-reviewable AI output'}
                    </h3>
                  </div>
                  <div className="hidden rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white/70 sm:block">
                    HAKCC UI runtime
                  </div>
                </div>

                <div className="grid flex-1 gap-3 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  {toolCards.map((card) => (
                    <div key={card.title} className={`flex min-h-[178px] flex-col justify-between rounded-2xl border p-4 backdrop-blur-md ${toneClass[card.tone]}`}>
                      <div>
                        <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] opacity-70">{card.meta}</div>
                        <h4 className="text-lg font-semibold text-white">{card.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-white/70">{card.body}</p>
                      </div>
                      <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-white/72">
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {isZh ? '课堂可用' : 'Classroom-ready'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
};

// Page Component: HomeContent
export function PublicHomeContent() {
  const { lang, t, isZh } = useOutletContext<PublicContextType>();
  const homeRef = useRef<HTMLDivElement>(null);

  const typingTexts = isZh
    ? ['真实问题进入公共空间', '观点持续改进', 'AI 作为协作伙伴', '社区共同推进知识边界']
    : ['Real problems enter shared space', 'Ideas keep improving', 'AI works as a partner', 'Communities advance knowledge'];

  useGSAP(() => {
    if (shouldReduceMotion()) return;

    prepareForMotion('.gsap-hero-kicker, .gsap-hero-title, .gsap-hero-copy, .gsap-hero-action, .gsap-hero-stat, .gsap-hero-cards');
    gsap.timeline({ defaults: { ease: 'power2.out', clearProps: 'transform,opacity,visibility,willChange' } })
      .from('.gsap-hero-kicker', { autoAlpha: 0, y: 10, duration: 0.32 })
      .from('.gsap-hero-title', { autoAlpha: 0, y: 18, scale: 0.985, duration: 0.56 }, '-=0.08')
      .from('.gsap-hero-copy', { autoAlpha: 0, y: 14, duration: 0.38 }, '-=0.22')
      .from('.gsap-hero-action', { autoAlpha: 0, y: 10, duration: 0.34, stagger: 0.045 }, '-=0.18')
      .from('.gsap-hero-stat', { autoAlpha: 0, y: 14, scale: 0.98, duration: 0.34, stagger: 0.055 }, '-=0.12')
      .from('.gsap-hero-cards', { autoAlpha: 0, x: 18, y: 10, scale: 0.98, duration: 0.42 }, '-=0.28');
  }, { scope: homeRef, dependencies: [lang], revertOnUpdate: true });

  return (
    <div ref={homeRef}>
      {/* Hero Section */}
      <section className="relative min-h-[calc(100vh-4rem)] pt-24 sm:pt-28 pb-16 px-4 bg-[#000080] overflow-hidden">
        {/* Dynamic Silk background */}
        <div className="absolute inset-0 pointer-events-none">
          <React.Suspense fallback={<div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(52,87,213,0.28),transparent_32%),radial-gradient(circle_at_80%_30%,rgba(142,164,255,0.24),transparent_34%)]" />}>
            <div className="absolute inset-0 h-full w-full opacity-70 dark:opacity-55" aria-hidden="true">
              <Silk
                speed={4}
                scale={1.1}
                color="#3457D5"
                noiseIntensity={1.4}
                rotation={0}
              />
            </div>
          </React.Suspense>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_42%_22%,rgba(255,255,255,0.14),transparent_32%),linear-gradient(90deg,rgba(0,0,80,0.88)_0%,rgba(16,18,122,0.58)_45%,rgba(52,87,213,0.14)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-white dark:to-[#05064D]" />
        </div>

        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-7 lg:grid-cols-[minmax(0,1fr)_560px] lg:gap-10">
          <div className="text-center lg:text-left">
            <div className="gsap-hero-kicker inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/20 bg-white/12 text-white/86 shadow-sm backdrop-blur-md text-xs font-medium mb-5 sm:mb-6">
              <RemixIcon name="node-tree" size={12} />
              <span>{t.hero.badge}</span>
            </div>
            <h1 className="gsap-hero-title font-react-bits text-4xl sm:text-5xl lg:text-6xl font-normal leading-[1.02] tracking-normal mb-4">
              <span className="text-white bg-clip-text bg-gradient-to-r from-white via-white to-gray-400">{t.hero.title}</span>
            </h1>
            <p className="gsap-hero-copy text-base sm:text-lg lg:text-xl text-white/78 max-w-3xl mx-auto lg:mx-0 mb-7 leading-relaxed">
              {t.hero.subtitle}
            </p>
            <TextType
              as="div"
              text={typingTexts}
              typingSpeed={56}
              deletingSpeed={28}
              pauseDuration={1500}
              variableSpeed={{ min: 34, max: 78 }}
              cursorCharacter="|"
              className="gsap-hero-copy mb-7 min-h-[2rem] text-lg font-semibold text-[#EEF2FF] sm:text-xl"
              cursorClassName="text-[#8EA4FF]"
            />
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Link
                to="/login"
                className="gsap-hero-action w-full sm:w-auto px-7 py-3 bg-white text-[#000080] hover:bg-white/92 font-semibold rounded-lg transition-[transform,box-shadow,background-color] duration-200 flex items-center justify-center gap-2 shadow-sm hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-950/20"
              >
                {t.hero.cta.primary} <ArrowRight size={16} />
              </Link>
              <Link
                to="/principles"
                className="gsap-hero-action w-full sm:w-auto px-7 py-3 bg-white/10 hover:bg-white/16 text-white font-semibold rounded-lg border-2 border-white/22 transition-[transform,box-shadow,background-color,border-color] duration-200 flex items-center justify-center gap-2 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-950/20 backdrop-blur-md"
              >
                {t.hero.cta.secondary} <ChevronRight size={14} />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 mt-9 max-w-xl mx-auto lg:mx-0">
              {[
                { icon: 'book-open-line', tint: 'text-[#EEF2FF] bg-[#3457D5]/30 ring-[#8EA4FF]/30', label: isZh ? '12 项知识建构原则' : '12 KB principles' },
                { icon: 'question-answer-line', tint: 'text-[#DDE6FF] bg-[#5B78E8]/22 ring-[#8EA4FF]/25', label: isZh ? 'AI 作为协作伙伴' : 'AI as a partner' },
                { icon: 'node-tree', tint: 'text-[#F3C969] bg-[#B7791F]/20 ring-[#F3C969]/25', label: isZh ? '观念持续升华' : 'Ideas keep rising' },
              ].map(({ icon, tint, label }) => (
                <div key={label} className="gsap-hero-stat group flex items-center gap-2.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-md transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.14]">
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1 ${tint}`}>
                    <RemixIcon name={icon} size={15} />
                  </span>
                  <span className="text-left text-[0.7812rem] font-medium leading-tight text-white/90">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="gsap-hero-cards relative mx-auto h-[480px] w-full max-w-[500px] lg:mx-0">
            <CardSwap width={460} height={380} cardDistance={50} verticalDistance={60} delay={5000} pauseOnHover={true} skewAmount={5} easing="elastic">
              <Card customClass={heroCardChrome}>
                <div className={heroCardHeader}>
                  <span className={heroCardIcon}><RemixIcon name="question-answer-line" size={12} /></span>
                  <span>{isZh ? '真实问题' : 'Real Ideas'}</span>
                </div>
                <div className={heroCardBody}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_48%_34%,rgba(142,164,255,0.20),transparent_42%),radial-gradient(circle_at_88%_16%,rgba(255,255,255,0.07),transparent_34%)]" />
                  <HeroKnowledgeMotif variant="real" />
                  <div className="absolute bottom-8 left-8 right-8">
                    <h3 className="font-react-bits text-3xl text-white">{isZh ? '真实观念' : 'Real Ideas'}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-[#DDE6FF]/72">{isZh ? '从学生真正想理解的问题出发，让 idea 成为社区可以共同改进的对象。' : 'Start from questions learners genuinely need to understand, then make ideas public and improvable.'}</p>
                  </div>
                </div>
              </Card>
              <Card customClass={heroCardChrome}>
                <div className={heroCardHeader}>
                  <span className={heroCardIcon}><RemixIcon name="file-list-3-line" size={12} /></span>
                  <span>{isZh ? '可改进观念' : 'Improvable Ideas'}</span>
                </div>
                <div className={heroCardBody}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_46%_34%,rgba(142,164,255,0.22),transparent_42%),radial-gradient(circle_at_82%_18%,rgba(243,201,105,0.13),transparent_32%)]" />
                  <HeroKnowledgeMotif variant="improve" />
                  <div className="absolute bottom-8 left-8 right-8">
                    <h3 className="font-react-bits text-3xl text-white">{isZh ? '持续改进' : 'Improve'}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-[#DDE6FF]/72">{isZh ? '每一条 Note 都不是终稿，而是可以被证据、追问和 Build-on 推进的临时解释。' : 'Every Note is a provisional explanation that can be advanced by evidence, questions, and build-ons.'}</p>
                  </div>
                </div>
              </Card>
              <Card customClass={heroCardChrome}>
                <div className={heroCardHeader}>
                  <span className={heroCardIcon}><RemixIcon name="team-line" size={12} /></span>
                  <span>{isZh ? '集体认知责任' : 'Collective Responsibility'}</span>
                </div>
                <div className={heroCardBody}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_48%_34%,rgba(142,164,255,0.20),transparent_42%),radial-gradient(circle_at_84%_18%,rgba(243,201,105,0.16),transparent_34%)]" />
                  <HeroKnowledgeMotif variant="collective" />
                  <div className="absolute bottom-8 left-8 right-8">
                    <h3 className="font-react-bits text-3xl text-white">{isZh ? '共同推进' : 'Collective'}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-[#DDE6FF]/72">{isZh ? 'AI 与学习者共同发现缺口、连接观点，把个人想法推进为社区知识。' : 'AI and learners surface gaps, connect ideas, and turn individual thoughts into community knowledge.'}</p>
                  </div>
                </div>
              </Card>
            </CardSwap>
          </div>
        </div>
      </section>

      <GenerativeLearningSurface isZh={isZh} />
    </div>
  );
}

// Page Component: PublicFeatures
export function PublicFeatures() {
  const { lang, t, isZh } = useOutletContext<PublicContextType>();

  const SCENARIOS = [
    {
      badge: isZh ? '小学科学' : 'Primary Science',
      badgeColor: 'bg-slate-500/10 text-slate-400 dark:text-slate-300 border-slate-500/20',
      title: isZh ? '探究“光的折射与反射”' : 'Inquiry on "Refraction"',
      subtitle: isZh ? '五年级科学探究案例' : 'Grade 5 Inquiry Case',
      problem: isZh ? '为什么筷子在水杯中看起来折断了？' : 'Why does a chopstick look broken in water?',
      steps: isZh 
        ? ['学生发布关于折射现象的初版解释笔记', 'AI 发现“介质折射率”认知缺口并提供脚手架提示', '社区多人建构(Build-on)并合成了折射定律模型']
        : ['Students post initial explanations about refraction', 'AI spots "refractive index" gap and offers scaffolds', 'Community co-builds and synthesizes refraction laws'],
      impact: isZh 
        ? '从朴素观念上升至科学解释，实现社区知识整体推进。' 
        : 'Transcend naive views to scientific laws, advancing community knowledge.'
    },
    {
      badge: isZh ? '计算思维' : 'Computational Thinking',
      badgeColor: 'bg-[#3457D5]/10 text-[#3457D5] dark:text-[#8EA4FF] border-[#3457D5]/20',
      title: isZh ? '设计“智能水循环控制系统”' : 'Smart Water Cycle System',
      subtitle: isZh ? '初中 STEM 跨学科协作案例' : 'Middle School STEM Project',
      problem: isZh ? '如何根据实时湿度实现全自动节水灌溉？' : 'How to design automatic saving-water irrigation?',
      steps: isZh
        ? ['利用计算思维画布分解输入、处理与输出环节', '学生跨学科分享传感器编程Note并合并思路', 'AI 对称推进：协同优化控制算法，形成社区产出']
        : ['Decompose logic using CT canvas blocks', 'Students share sensor programming notes and ideas', 'AI co-advances: optimizes control algorithms together'],
      impact: isZh
        ? '在实践中锻炼算法设计和对称知识协作能力。'
        : 'Fosters algorithmic design and symmetric knowledge collaboration.'
    },
    {
      badge: isZh ? '社会性议题' : 'Socioscientific Issues',
      badgeColor: 'bg-slate-500/10 text-slate-500 dark:text-slate-300 border-slate-500/20',
      title: isZh ? '“社区微气候与温室效应”' : 'Micro-climate & Greenhouse Effect',
      subtitle: isZh ? '高中地理与社会性主题案例' : 'High School Geography PBL',
      problem: isZh ? '我们学校及周边小区的温度变化与城市热岛有何关系？' : 'How does UHI relate to microclimate?',
      steps: isZh
        ? ['学生跨学段搜集实地温度数据并上传论坛', '引用权威文献探究下垫面介质对热传导的影响', '产生观点冲突，最终通过升华(Rise Above)发布白皮书']
        : ['Collect empirical temperature readings and post on forum', 'Consult authoritative sources on surface heat conductivity', 'Resolve conflicts and publish micro-climate whitepaper via Rise Above'],
      impact: isZh
        ? '承担集体认知责任，提出具备建设性的现实解决方案。'
        : 'Take collective responsibility, delivering constructive real-world solutions.'
    }
  ];

  return (
    <section id="features" className="py-12 sm:py-16 px-3 sm:px-5 lg:px-8 bg-gradient-to-b from-[#F7F9FF] to-white dark:from-[#05064D] dark:to-[#070A3F] tech-dot-grid relative overflow-hidden">
      {/* Decorative Radial Background Light */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-[#3457D5]/[0.08] dark:bg-[#3457D5]/[0.08] blur-[120px] rounded-full pointer-events-none z-0" />
      
      <div className="relative z-10 max-w-[1320px] mx-auto">
        <AnimatedSection>
          <div className="text-center mb-7">
            <h2 className="text-3xl font-bold mb-3 sm:mb-4 text-balance">{t.features.title}</h2>
            <p className="text-gray-600 dark:text-white/72 text-base max-w-2xl mx-auto text-pretty">{t.features.subtitle}</p>
          </div>
        </AnimatedSection>

        {/* Knowledge Building Principles */}
        <AnimatedSection delay={100}>
          <div className="mb-8 sm:mb-10">
            <KBPrincipleCards isZh={isZh} />
            <p className="text-center text-sm text-gray-500 dark:text-white/60 mt-3">
              {isZh ? '六大知识建构原则驱动深度协作学习' : 'Six Knowledge Building principles driving deep collaborative learning'}
            </p>
          </div>
        </AnimatedSection>

        {/* Bento Grid Features Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 max-w-[1240px] mx-auto items-stretch [grid-auto-rows:1fr]">
          {/* Bento Card 1: Knowledge Building */}
          <AnimatedSection delay={50} className="h-full xl:col-span-2">
            <SpotlightCard className="h-full min-h-[260px] hover:-translate-y-1 hover:shadow-xl hover:shadow-[#3457D5]/8" innerClassName="p-5 sm:p-6">
              <div className="flex flex-col gap-4 w-full h-full">
                <div className="z-10">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#3457D5]/10 dark:bg-[#3457D5]/20 text-[#3457D5] dark:text-[#8EA4FF] mb-3.5 border border-[#3457D5]/20 dark:border-[#3457D5]/35">
                      <RemixIcon name="book-open-line" size={22} />
                    </div>
                    <h3 className="font-bold text-xl text-gray-900 dark:text-white mb-2.5">
                      {t.features.items.knowledgeBuilding.title}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-white/60 leading-relaxed">
                      {t.features.items.knowledgeBuilding.description}
                    </p>
                </div>

                {/* Micro Visualization: Progressive Inquiry Chain */}
                <div className="mt-auto flex items-center justify-center min-h-[96px] bg-[#EEF2FF]/55 dark:bg-black/20 rounded-xl p-3.5 border border-[#D8E1FF]/70 dark:border-white/[0.05] relative z-10 transition-transform duration-300 group-hover:-translate-y-0.5">
                  <div className="flex items-center gap-2 w-full justify-around max-w-sm">
                    {[
                      { label: isZh ? '真实问题' : 'Problem', color: 'border-slate-300 dark:border-slate-500/30 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/65' },
                      { label: isZh ? '观点改进' : 'Improve', color: 'border-[#3457D5]/30 dark:border-[#3457D5]/40 text-[#3457D5] dark:text-[#8EA4FF] bg-[#3457D5]/5 dark:bg-[#3457D5]/15' },
                      { label: isZh ? '升华超越' : 'Rise Above', color: 'border-[#B7791F]/35 dark:border-[#B7791F]/45 text-[#8A5A13] dark:text-[#F3C969] bg-[#B7791F]/[0.08] dark:bg-[#B7791F]/20' },
                    ].map((node, i) => (
                      <React.Fragment key={i}>
                        <div className={`px-3 py-2 rounded-xl border bg-white dark:bg-[#080A3A] text-xs font-semibold text-center shadow-md ${node.color} flex-shrink-0 transition-transform duration-300 hover:scale-105`}>
                          {node.label}
                        </div>
                        {i < 2 && (
                          <svg className="w-6 h-4 text-gray-400 dark:text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                          </svg>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            </SpotlightCard>
          </AnimatedSection>

          {/* Bento Card 2: AI Assistance (1 column) */}
          <AnimatedSection delay={100} className="h-full xl:col-span-2">
            <SpotlightCard className="h-full min-h-[260px] hover:-translate-y-1 hover:shadow-xl hover:shadow-[#6D5BD0]/8" innerClassName="p-5 sm:p-6" spotlightColor="rgba(109, 91, 208, 0.08)" borderColor="rgba(109, 91, 208, 0.22)">
              <div className="flex flex-col justify-between h-full w-full">
                <div className="z-10">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-[#6D5BD0]/10 text-[#6D5BD0] dark:text-[#D8D2FF] mb-4 border border-[#6D5BD0]/20 dark:border-[#6D5BD0]/30">
                    <RemixIcon name="question-answer-line" size={22} />
                  </div>
                  <h3 className="font-bold text-xl text-gray-900 dark:text-white mb-2.5">
                    {t.features.items.aiAssistance.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-white/72 leading-relaxed text-pretty">
                    {t.features.items.aiAssistance.description}
                  </p>
                </div>

                {/* Micro Visualization: AI Tags Extractor */}
                <div className="mt-auto bg-slate-50/60 dark:bg-black/20 rounded-xl p-3.5 border border-slate-200/60 dark:border-white/[0.05] relative z-10 flex flex-col gap-2 transition-transform duration-300 group-hover:-translate-y-0.5">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#6D5BD0] animate-ping" />
                    <span className="text-[0.6875rem] text-slate-500 dark:text-white/45 uppercase tracking-widest font-semibold">{isZh ? 'AI 语义识别中' : 'AI Extracting'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: isZh ? '# 协作探究' : '# Inquiry' },
                      { label: isZh ? '# 脚手架' : '# Scaffold' },
                      { label: isZh ? '# 观点改进' : '# Improvement' },
                    ].map((tag, idx) => (
                      <span
                        key={idx}
                        className="text-[0.6875rem] px-2 py-1 rounded-lg bg-white/80 text-slate-600 border border-slate-200/70 font-medium transition-all duration-300 hover:bg-[#EFEDFF] hover:text-[#4B36A8] hover:border-[#D8D2FF] dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/50 dark:hover:bg-[#6D5BD0]/12 dark:hover:border-[#6D5BD0]/30"
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </SpotlightCard>
          </AnimatedSection>

          {/* Bento Card 3: Collaborative Tools (1 column) */}
          <AnimatedSection delay={150} className="h-full">
            <SpotlightCard className="h-full min-h-[260px] hover:-translate-y-1 hover:shadow-xl hover:shadow-[#3457D5]/8" innerClassName="p-5 sm:p-6">
              <div className="flex flex-col justify-between h-full w-full">
                <div className="z-10">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#3457D5]/10 text-[#3457D5] dark:text-[#8EA4FF] mb-3.5 border border-[#3457D5]/20">
                    <RemixIcon name="node-tree" size={22} />
                  </div>
                  <h3 className="font-bold text-xl text-gray-900 dark:text-white mb-2.5">
                    {t.features.items.collaborativeTools.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-white/72 leading-relaxed text-pretty">
                    {t.features.items.collaborativeTools.description}
                  </p>
                </div>

                {/* Micro Visualization: Mini Mindmap */}
                <div className="mt-auto bg-slate-50/60 dark:bg-black/20 rounded-xl p-3.5 border border-slate-200/60 dark:border-white/[0.05] relative z-10 flex items-center justify-center min-h-[88px] transition-transform duration-300 group-hover:-translate-y-0.5">
                  <svg className="w-full h-16 pointer-events-none" viewBox="0 0 200 80">
                    <line x1="100" y1="40" x2="40" y2="25" stroke="rgba(52,87,213,0.38)" strokeWidth="2" strokeDasharray="3 3" />
                    <line x1="100" y1="40" x2="160" y2="25" stroke="rgba(52,87,213,0.38)" strokeWidth="2" strokeDasharray="3 3" />
                    <line x1="100" y1="40" x2="100" y2="65" stroke="rgba(91,120,232,0.36)" strokeWidth="2" strokeDasharray="3 3" />
                    
                    <circle cx="100" cy="40" r="10" fill="#3457D5" className="animate-pulse" />
                    <circle cx="40" cy="25" r="7" fill="rgba(52,87,213,0.62)" />
                    <circle cx="160" cy="25" r="7" fill="rgba(91,120,232,0.62)" />
                    <circle cx="100" cy="65" r="7" fill="rgba(183,121,31,0.62)" />
                  </svg>
                </div>
              </div>
            </SpotlightCard>
          </AnimatedSection>

          {/* Bento Card 4: Progress Tracking */}
          <AnimatedSection delay={200} className="h-full">
            <SpotlightCard className="h-full min-h-[260px] hover:-translate-y-1 hover:shadow-xl hover:shadow-[#3457D5]/8" innerClassName="p-5 sm:p-6">
              <div className="flex flex-col justify-between h-full w-full">
              <div className="z-10">
                <div>
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#3457D5]/10 text-[#3457D5] dark:text-[#8EA4FF] mb-3.5 border border-[#3457D5]/20">
                    <RemixIcon name="line-chart-line" size={22} />
                  </div>
                  <h3 className="font-bold text-xl text-gray-900 dark:text-white mb-2.5 group-hover:text-[#3457D5] dark:group-hover:text-[#8EA4FF] transition-colors">
                    {t.features.items.progressTracking.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-white/72 leading-relaxed text-pretty">
                    {t.features.items.progressTracking.description}
                  </p>
                </div>
              </div>

              {/* Micro Visualization: Dynamic Line Chart Dashboard */}
              <div className="mt-auto flex flex-col justify-between bg-[#EEF2FF]/55 dark:bg-black/20 rounded-xl p-3.5 border border-[#D8E1FF]/70 dark:border-white/[0.05] relative z-10 min-h-[108px] transition-transform duration-300 group-hover:-translate-y-0.5">
                <div className="flex items-center justify-between text-[0.6875rem] text-slate-500 dark:text-white/50 border-b border-slate-200/60 dark:border-white/5 pb-2 mb-2 font-medium">
                  <span>{isZh ? '社区知识演进指数' : 'Community Growth Index'}</span>
                  <span className="text-[#3457D5] dark:text-[#8EA4FF] font-bold">+184%</span>
                </div>
                <div className="flex-1 relative flex items-end">
                  <svg className="w-full h-16 overflow-visible" viewBox="0 0 200 60" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3457D5" stopOpacity="0.32" />
                        <stop offset="100%" stopColor="#3457D5" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0,55 Q35,45 65,35 T135,15 T200,5"
                      fill="none"
                      stroke="#3457D5"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <path
                      d="M0,55 Q35,45 65,35 T135,15 T200,5 L200,60 L0,60 Z"
                      fill="url(#chartGlow)"
                    />
                    <circle cx="200" cy="5" r="4.5" fill="#8EA4FF" className="animate-ping" />
                    <circle cx="200" cy="5" r="3" fill="#8EA4FF" />
                  </svg>
                </div>
              </div>
              </div>
            </SpotlightCard>
          </AnimatedSection>

          {/* Bento Card 5: Multi-Role Support (1 column) */}
          <AnimatedSection delay={250} className="h-full">
            <SpotlightCard className="h-full min-h-[260px] hover:-translate-y-1 hover:shadow-xl hover:shadow-[#000080]/8" innerClassName="p-5 sm:p-6">
              <div className="flex flex-col justify-between h-full w-full">
                <div className="z-10">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#000080]/10 text-[#000080] dark:text-[#DDE6FF] mb-3.5 border border-[#000080]/20">
                    <RemixIcon name="team-line" size={22} />
                  </div>
                  <h3 className="font-bold text-xl text-gray-900 dark:text-white mb-2.5">
                    {t.features.items.roleManagement.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-white/72 leading-relaxed text-pretty">
                    {t.features.items.roleManagement.description}
                  </p>
                </div>

                {/* Micro Visualization: Role Cards Stacking */}
                <div className="mt-auto bg-slate-50/60 dark:bg-black/20 rounded-xl p-3.5 border border-slate-200/60 dark:border-white/[0.05] relative z-10 flex items-center justify-center h-[88px] overflow-hidden transition-transform duration-300 group-hover:-translate-y-0.5">
                  <div className="relative w-full h-full flex justify-center items-center">
                    <div className="absolute w-20 h-10 rounded-xl bg-slate-50 dark:bg-slate-900 border border-gray-200 dark:border-white/5 text-slate-700 dark:text-slate-300 flex items-center justify-center text-[0.6875rem] font-bold shadow-sm transition-all duration-600 transform group-hover:-translate-x-10 group-hover:-rotate-12 group-hover:border-[#3457D5]/30 translate-x-0 -rotate-6">
                      {isZh ? '学生 Student' : 'Student'}
                    </div>
                    <div className="absolute w-20 h-10 rounded-xl bg-white dark:bg-slate-950 border border-[#3457D5]/30 dark:border-[#3457D5]/35 text-[#000080] dark:text-white flex items-center justify-center text-[0.6875rem] font-bold shadow-sm z-10 translate-y-1">
                      {isZh ? '管理员 Admin' : 'Admin'}
                    </div>
                    <div className="absolute w-20 h-10 rounded-xl bg-slate-50 dark:bg-slate-900 border border-gray-200 dark:border-white/5 text-slate-700 dark:text-slate-300 flex items-center justify-center text-[0.6875rem] font-bold shadow-sm transition-all duration-600 transform group-hover:translate-x-10 group-hover:rotate-12 group-hover:border-[#3457D5]/30 translate-x-0 rotate-6">
                      {isZh ? '教师 Teacher' : 'Teacher'}
                    </div>
                  </div>
                </div>
              </div>
            </SpotlightCard>
          </AnimatedSection>

          {/* Bento Card 6: Secure & Reliable (1 column) */}
          <AnimatedSection delay={300} className="h-full">
            <SpotlightCard className="h-full min-h-[260px] hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-500/8" innerClassName="p-5 sm:p-6" spotlightColor="rgba(100, 116, 139, 0.08)" borderColor="rgba(100, 116, 139, 0.22)">
              <div className="flex flex-col justify-between h-full w-full">
                <div className="z-10">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-slate-500/10 text-slate-300 border border-slate-500/20">
                    <RemixIcon name="shield-check-line" size={22} />
                  </div>
                  <h3 className="font-bold text-xl text-gray-900 dark:text-white mb-2.5">
                    {t.features.items.securePlatform.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-white/72 leading-relaxed text-pretty">
                    {t.features.items.securePlatform.description}
                  </p>
                </div>

                {/* Micro Visualization: 3D Shield Lock */}
                <div className="mt-auto bg-slate-50/60 dark:bg-black/20 rounded-xl p-3.5 border border-slate-200/60 dark:border-white/[0.05] relative z-10 flex items-center justify-center h-[88px] transition-transform duration-500 [transform-style:preserve-3d] group-hover:[transform:translateY(-2px)_rotateY(10deg)_rotateX(3deg)]">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-12 h-12 rounded-full bg-[#3457D5]/[0.05] blur-md" />
                    <div className="absolute w-14 h-14 rounded-full border border-dashed border-white/10 animate-[spin_10s_linear_infinite]" />
                    <div className="relative w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-900 border border-gray-200 dark:border-white/10 flex items-center justify-center text-slate-700 dark:text-slate-300 shadow-md [transform:translateZ(10px)]">
                      <RemixIcon name="shield-check-line" size={16} />
                    </div>
                  </div>
                </div>
              </div>
            </SpotlightCard>
          </AnimatedSection>
        </div>

        {/* Real World Scenarios Section */}
        <div className="mt-14 border-t border-gray-200/50 dark:border-white/10 pt-10 max-w-[1240px] mx-auto relative z-10">
          <AnimatedSection>
            <div className="text-center mb-9">
              <h3 className="text-2xl sm:text-3xl font-bold mb-3 text-balance">
                {isZh ? '典型真实应用场景' : 'Typical Scenarios in Action'}
              </h3>
              <p className="text-gray-600 dark:text-white/72 text-sm sm:text-base max-w-2xl mx-auto text-pretty">
                {isZh 
                  ? '深入教育教学一线，见证人智协同知识建构的真实发生' 
                  : 'Deep dive into classrooms to see how human-AI knowledge collaboration works in reality'}
              </p>
            </div>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 items-stretch [grid-auto-rows:1fr]">
            {SCENARIOS.map((sc, i) => (
              <AnimatedSection key={i} delay={i * 80} className="h-full">
                <SpotlightCard className="h-full min-h-[360px] hover:-translate-y-1 hover:shadow-xl hover:shadow-[#3457D5]/8" innerClassName="p-5 sm:p-6">
                  <div className="flex flex-col h-full w-full justify-between">
                    <div>
                      {/* Badge */}
                      <div className="flex items-center justify-between mb-4">
                        <span className={`text-[0.6875rem] uppercase font-bold tracking-wider px-2 py-1 rounded-md border ${sc.badgeColor}`}>
                          {sc.badge}
                        </span>
                        <span className="text-[0.6875rem] text-gray-400 dark:text-white/45 font-medium">{sc.subtitle}</span>
                      </div>

                      {/* Title */}
                      <h4 className="font-bold text-lg text-gray-900 dark:text-white mb-3">
                        {sc.title}
                      </h4>

                      {/* Problem Statement */}
                      <div className="mb-4 bg-slate-50/60 dark:bg-black/20 border border-slate-200/60 dark:border-white/[0.05] rounded-xl p-3">
                        <span className="text-[0.6875rem] text-[#8A5A13] dark:text-[#F3C969] font-bold uppercase tracking-wider block mb-1">
                          {isZh ? '真实探究问题' : 'Inquiry Question'}
                        </span>
                        <p className="text-xs text-gray-700 dark:text-white/80 leading-relaxed font-medium">
                          "{sc.problem}"
                        </p>
                      </div>

                      {/* Path Steps */}
                      <div className="flex flex-col gap-3.5 mb-5 relative pl-4 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-0.5 before:bg-[#3457D5]/22">
                        {sc.steps.map((step, idx) => (
                          <div key={idx} className="relative text-xs text-gray-600 dark:text-white/72 leading-relaxed pl-2.5">
                            <div className="absolute left-[-13.5px] top-1.5 w-2 h-2 rounded-full bg-[#3457D5]/55 ring-2 ring-white dark:ring-[#080A3A] group-hover:bg-[#B7791F] transition-colors" />
                            <span className="font-medium text-gray-500 dark:text-white/45 mr-1">{idx + 1}.</span>
                            {step}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Collaborative Impact */}
                    <div className="border-t border-gray-200/50 dark:border-white/5 pt-3 mt-auto">
                      <span className="text-[0.6875rem] text-[#3457D5] dark:text-[#8EA4FF] font-bold uppercase tracking-wider block mb-0.5">
                        {isZh ? '社区产出与成效' : 'Community Output'}
                      </span>
                      <p className="text-xs text-gray-500 dark:text-white/60 leading-relaxed">
                        {sc.impact}
                      </p>
                    </div>
                  </div>
                </SpotlightCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Page Component: PublicPrinciples
export function PublicPrinciples() {
  const { lang, t, isZh } = useOutletContext<PublicContextType>();
  const [activeIndex, setActiveIndex] = useState(0);
  const detailPanelRef = useRef<HTMLDivElement>(null);

  const activePrinciple = KB_PRINCIPLES[activeIndex];
  const activeP = activePrinciple[lang];
  const activeCase = PRINCIPLE_CASES[activePrinciple.id as keyof typeof PRINCIPLE_CASES]?.[lang]
    || PRINCIPLE_CASES[activePrinciple.id as keyof typeof PRINCIPLE_CASES]?.[isZh ? 'zh-CN' : 'en']
    || '';
  const activeActionSet = PRINCIPLE_ACTIONS[activePrinciple.id as keyof typeof PRINCIPLE_ACTIONS]
    || PRINCIPLE_ACTIONS['real-ideas'];
  const activeAction = activeActionSet[lang as keyof typeof activeActionSet]
    || activeActionSet[isZh ? 'zh-CN' : 'en'];

  useGSAP(() => {
    const el = detailPanelRef.current;
    if (!el || shouldReduceMotion()) return;

    gsap.fromTo(
      el.querySelectorAll('.gsap-detail-item'),
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.4, stagger: 0.04, ease: 'power2.out' }
    );
  }, [activeIndex]);

  return (
    <section id="principles" className="py-16 sm:py-24 px-4 bg-[#F7F9FF] dark:bg-[#05064D] tech-dot-grid relative overflow-hidden">
      {/* Decorative Radial Background Light */}
      <div className="absolute top-1/3 left-1/4 -translate-x-1/2 w-[400px] h-[400px] bg-[#3457D5]/[0.08] dark:bg-[#8EA4FF]/[0.05] blur-[120px] rounded-full pointer-events-none z-0" />

      <div className="relative z-10 max-w-[94%] mx-auto">
        <AnimatedSection>
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#3457D5]/10 dark:bg-[#3457D5]/18 text-[#3457D5] dark:text-[#8EA4FF] text-xs font-medium mb-4 border border-[#3457D5]/20 dark:border-[#8EA4FF]/25">
              <RemixIcon name="book-open-line" size={12} />
              <span>{isZh ? '理论基础与原则' : 'Theoretical Foundation & Principles'}</span>
            </div>
            <h2 className="text-3xl font-bold mb-3 sm:mb-4 text-balance">{t.principles.title}</h2>
            <p className="text-gray-600 dark:text-white/72 text-base text-pretty">{t.principles.subtitle}</p>
            <p className="text-xs text-gray-500 dark:text-white/55 mt-2">{t.principles.reference}</p>
          </div>
        </AnimatedSection>

        {/* Quote Box */}
        <AnimatedSection delay={100}>
          <div className="max-w-4xl mx-auto mb-12 p-6 sm:p-7 rounded-2xl bg-slate-50 border border-slate-200/50 dark:bg-slate-950/20 dark:border-white/[0.04] shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-11 h-11 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center border border-slate-200/50 dark:border-white/10">
                <RemixIcon name="double-quotes-l" size={18} className="text-slate-600 dark:text-white/70" />
              </div>
              <div className="flex-1">
                <blockquote className="text-base text-gray-800 dark:text-white/90 leading-relaxed mb-3 italic font-medium">
                  "{t.quotes.quote1.text}"
                </blockquote>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-white/60">
                  <span className="font-semibold text-gray-900 dark:text-white">{t.quotes.quote1.author}</span>
                  <span>·</span>
                  <span>{t.quotes.quote1.source}</span>
                </div>
              </div>
            </div>
          </div>
        </AnimatedSection>

        {/* 12 Principles & Detail View layout */}
        <AnimatedSection delay={80}>
          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_2.85fr] gap-8 max-w-[94%] mx-auto items-stretch">

            {/* LEFT: Academic Scenario Detail Panel (Stretch & Height Alignment) */}
            <div className="z-20 w-full h-full lg:self-stretch">
              <div
                ref={detailPanelRef}
                className="w-full h-full rounded-2xl border border-slate-200/60 dark:border-white/[0.08] bg-[#fafafc] dark:bg-[#080A3A]/80 backdrop-blur-md p-6 sm:p-8 shadow-xl shadow-slate-200/20 dark:shadow-black/30 overflow-hidden relative flex flex-col justify-between"
              >
                {/* Background decorative subtle lights */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-[#3457D5]/12 rounded-full blur-2xl pointer-events-none" />

                <div className="flex flex-col gap-4">
                  {/* Huge Serif Number */}
                  <div className="gsap-detail-item font-react-bits text-6xl sm:text-7.5xl font-normal leading-none tracking-tight text-[#3457D5]/20 dark:text-[#8EA4FF]/16">
                    {String(activeIndex + 1).padStart(2, '0')}
                  </div>

                  {/* Title & Translation */}
                  <div>
                    <h3 className="gsap-detail-item text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1.5 leading-snug">
                      {activeP.title}
                    </h3>
                    <span className="gsap-detail-item text-xs font-semibold text-[#3457D5] dark:text-[#8EA4FF] tracking-wider uppercase">
                      {activePrinciple.en.title}
                    </span>
                  </div>

                  {/* Theoretical Description */}
                  <div className="border-t border-slate-200/60 dark:border-white/10 pt-4">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-wider mb-2">
                      {isZh ? '理论概念定义' : 'Theoretical Concept'}
                    </h4>
                    <p className="gsap-detail-item text-sm sm:text-base text-gray-700 dark:text-white/78 leading-relaxed text-pretty">
                      {activeP.description}
                    </p>
                  </div>

                  {/* Academic Application Scenario Case */}
                  <div className="mt-2 p-4 rounded-xl border border-[#B7791F]/25 dark:border-[#B7791F]/30 bg-[#F3C969]/10 dark:bg-[#B7791F]/10">
                    <h4 className="text-xs font-semibold text-[#8A5A13] dark:text-[#F3C969] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <RemixIcon name="verified-badge-line" size={12} />
                      {isZh ? 'HAKCC 平台真实应用场景' : 'HAKCC Real-World Scenario'}
                    </h4>
                    <p className="gsap-detail-item text-xs sm:text-sm text-gray-600 dark:text-[#F3C969]/80 leading-relaxed">
                      {activeCase}
                    </p>
                  </div>
                </div>

                <div className="gsap-detail-item mt-8 pt-5 border-t border-slate-200/70 dark:border-white/10">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#3457D5] dark:text-[#8EA4FF]">
                      <RemixIcon name="route-line" size={13} />
                      <span>{isZh ? '下一步社区行动' : 'Next Community Move'}</span>
                    </div>
                    <span className="rounded-full border border-[#3457D5]/15 dark:border-[#8EA4FF]/20 bg-[#3457D5]/8 dark:bg-[#8EA4FF]/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-[#3457D5] dark:text-[#DDE6FF]">
                      HAKCC
                    </span>
                  </div>

                  <p className="text-sm text-gray-700 dark:text-white/76 leading-relaxed text-pretty">
                    {activeAction.prompt}
                  </p>

                  <div className="mt-3 grid gap-2">
                    {activeAction.moves.map((move, moveIndex) => (
                      <div
                        key={move}
                        className="flex items-start gap-2.5 rounded-xl bg-white/70 dark:bg-white/[0.035] border border-slate-200/60 dark:border-white/[0.06] px-3 py-2.5"
                      >
                        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#EEF2FF] dark:bg-[#3457D5]/18 text-[#3457D5] dark:text-[#8EA4FF]">
                          <RemixIcon name={PRINCIPLE_ACTION_ICONS[moveIndex] || 'sparkling-line'} size={13} />
                        </span>
                        <span className="text-xs sm:text-sm leading-relaxed text-gray-700 dark:text-white/72">
                          {move}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#F3C969]/10 dark:bg-[#B7791F]/10 px-3 py-2.5 text-[#8A5A13] dark:text-[#F3C969]/85">
                    <RemixIcon name="radar-line" size={13} className="mt-0.5 shrink-0" />
                    <p className="text-[0.6875rem] sm:text-xs leading-relaxed">
                      <span className="font-semibold">{isZh ? '可观察信号：' : 'Observable signal: '}</span>
                      {activeAction.signal}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Principles List Cards (Double Column Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {KB_PRINCIPLES.map((principle, index) => (
                <PrincipleCard
                  key={principle.id}
                  principle={principle}
                  index={index}
                  lang={lang}
                  isZh={isZh}
                  isActive={activeIndex === index}
                  onSelect={() => setActiveIndex(index)}
                />
              ))}
            </div>

          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}

// Page Component: PublicAbout
export function PublicAbout() {
  const { lang, t, isZh } = useOutletContext<PublicContextType>();
  return (
    <div className="bg-white dark:bg-[#05064D]">
      <AboutKBSection lang={lang} isZh={isZh} />
      <DemoSection lang={lang} isZh={isZh} />

      {/* Related Links Section */}
      <section id="links" className="py-16 sm:py-24 px-4 bg-[#F7F9FF] dark:bg-[#070A3F] border-t border-gray-200 dark:border-white/5">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3 text-balance">{t.links.title}</h2>
            <p className="text-gray-600 dark:text-white/72 text-sm text-pretty">{isZh ? '了解更多关于知识建构的内容' : 'Learn more about Knowledge Building'}</p>
          </div>

          <div className="divide-y divide-gray-200 dark:divide-white/10 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] overflow-hidden shadow-sm">
            {[
              { url: t.links.kbWiki.url, icon: 'global-line', title: t.links.kbWiki.title, sub: 'Wikipedia', tint: 'text-[#3457D5] dark:text-[#8EA4FF] bg-[#EEF2FF] dark:bg-[#3457D5]/15' },
              { url: t.links.kfWiki.url, icon: 'file-list-3-line', title: t.links.kfWiki.title, sub: 'Wikipedia', tint: 'text-[#5B78E8] dark:text-[#DDE6FF] bg-[#EEF2FF] dark:bg-[#5B78E8]/15' },
              { url: t.links.ikit.url, icon: 'graduation-cap-line', title: t.links.ikit.title, sub: 'ikit.org', tint: 'text-[#000080] dark:text-[#DDE6FF] bg-[#EEF2FF] dark:bg-[#000080]/25' },
            ].map(({ url, icon, title, sub, tint }) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 px-6 py-5 transition-all duration-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] focus-ring"
              >
                <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${tint}`}>
                  <RemixIcon name={icon} size={21} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-base text-gray-900 dark:text-white truncate group-hover:text-[#3457D5] dark:group-hover:text-[#8EA4FF] transition-colors">{title}</span>
                  <span className="block text-sm text-gray-500 dark:text-white/55 mt-0.5">{sub}</span>
                </span>
                <span className="hidden sm:inline text-sm font-medium text-gray-400 dark:text-white/50 group-hover:text-gray-600 dark:group-hover:text-white/80 transition-colors">{isZh ? '阅读' : 'Read'}</span>
                <ChevronRight size={18} className="flex-shrink-0 text-gray-400 dark:text-white/55 transition-transform duration-300 group-hover:translate-x-1" />
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

// --------------------- MAIN LAYOUT WRAPPER ---------------------

export default function PublicHomePage() {
  const [lang, setLangState] = useState<Lang>(() => readPublicLanguage('en'));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const scrollProgress = useScrollProgress();
  
  const t = TRANSLATIONS[lang];
  const isZh = lang !== 'en';

  const gooeyNavItems = [
    { label: isZh ? '首页' : 'Home', href: '/' },
    { label: t.nav.features, href: '/features' },
    { label: t.nav.principles, href: '/principles' },
    { label: isZh ? '关于平台' : 'About', href: '/about' },
  ];

  // Show/hide back to top button based on scroll position
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavClick = () => {
    setMobileMenuOpen(false);
  };

  const setLang = (nextLang: Lang) => {
    saveLanguagePreference(nextLang);
    setLangState(nextLang);
  };

  return (
    <>
      <style>{`
        .font-dm { font-family: Arial, 'Noto Sans SC', system-ui, sans-serif; }
        .font-react-bits { font-family: 'Instrument Serif', Georgia, serif; }
        html { scroll-behavior: smooth; }

        /* Tech Grid Pattern */
        .tech-dot-grid {
          background-image: radial-gradient(rgba(52, 87, 213, 0.075) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        .light .tech-dot-grid {
          background-image: radial-gradient(rgba(52, 87, 213, 0.045) 1px, transparent 1px);
          background-size: 24px 24px;
        }

        /* Improved card hover with no layout shift */
        .card-lift {
          transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1),
                      box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .card-lift:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.15);
        }
        .dark .card-lift:hover {
          box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.5);
        }

        /* Focus visible for accessibility */
        .focus-ring:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(52, 87, 213, 0.32);
        }

        /* Reduced motion support */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }

        /* Smooth scroll with reduced motion check */
        @media (prefers-reduced-motion: no-preference) {
          html { scroll-behavior: smooth; }
        }

        /* Custom scrollbar for webkit browsers */
        ::-webkit-scrollbar {
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(156, 163, 175, 0.5);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(156, 163, 175, 0.7);
        }
        .dark ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
        }
        .dark ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>

      <div className="min-h-screen font-dm bg-white dark:bg-[#05064D] text-gray-900 dark:text-white">

        {/* Skip to main content for accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-[100] bg-[#000080] text-white px-4 py-2 rounded-lg focus:ring-4 focus:ring-[#8EA4FF]/40"
        >
          {t.hero.skipNav}
        </a>

        {/* Scroll Progress Bar */}
        <div className="fixed top-0 left-0 right-0 z-[60] h-1 bg-gray-200 dark:bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-[#000080] via-[#3457D5] to-[#B7791F] transition-all duration-150 ease-out"
            style={{ width: `${scrollProgress}%` }}
          />
        </div>

        {/* Navigation */}
        <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-[#000080]/88 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <Link to="/" className="flex items-center gap-2.5 focus-ring rounded-lg">
                <div className="w-9 h-9 rounded-xl bg-[#3457D5] dark:bg-[#3457D5] flex items-center justify-center shadow-md">
                  <RemixIcon name="book-open-line" size={18} className="text-white" />
                </div>
                <div className="hidden sm:block">
                  <span className="font-bold text-base tracking-tight text-white whitespace-nowrap">
                    HAKCC <span className="text-sm font-normal text-white/70 ml-1 hidden lg:inline">{isZh ? '人智知识协作空间' : 'Human-AI Knowledge Collaboration Commons'}</span>
                  </span>
                </div>
              </Link>

              <div className="hidden md:flex items-center">
                <GooeyNav
                  items={gooeyNavItems}
                  particleCount={15}
                  particleDistances={[90, 10]}
                  particleR={100}
                  initialActiveIndex={0}
                  animationTime={600}
                  timeVariance={300}
                  colors={[1, 2, 3, 1, 2, 3, 1, 4]}
                />
              </div>

              <div className="flex items-center gap-2">
                <LangSwitcher3 value={lang} onChange={setLang} />
                <ThemeToggle />
                <div className="hidden md:flex items-center gap-2">
                  <Link
                    to="/login"
                    onClick={handleNavClick}
                    className="px-4 py-2 text-sm font-medium text-white/78 hover:text-white transition-colors focus-ring rounded-lg"
                  >
                    {t.nav.login}
                  </Link>
                  <Link
                    to="/login"
                    onClick={handleNavClick}
                    className="px-5 py-2 text-sm font-semibold bg-white hover:bg-white/92 text-[#000080] rounded-lg transition-colors shadow-sm focus-ring"
                  >
                    {t.nav.register}
                  </Link>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="md:hidden p-2 rounded-lg text-white hover:bg-white/10 focus-ring"
                  aria-label="Toggle menu"
                  aria-expanded={mobileMenuOpen}
                >
                  {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              </div>
            </div>

            {mobileMenuOpen && (
              <div className="md:hidden py-4 border-t border-white/10 space-y-1">
                <Link to="/" onClick={handleNavClick} className="block py-3 px-4 text-sm font-medium text-white/85 hover:bg-white/10 rounded-lg transition-colors">{isZh ? '首页' : 'Home'}</Link>
                <Link to="/features" onClick={handleNavClick} className="block py-3 px-4 text-sm font-medium text-white/85 hover:bg-white/10 rounded-lg transition-colors">{t.nav.features}</Link>
                <Link to="/principles" onClick={handleNavClick} className="block py-3 px-4 text-sm font-medium text-white/85 hover:bg-white/10 rounded-lg transition-colors">{t.nav.principles}</Link>
                <Link to="/about" onClick={handleNavClick} className="block py-3 px-4 text-sm font-medium text-white/85 hover:bg-white/10 rounded-lg transition-colors">{isZh ? '关于平台' : 'About'}</Link>
                <div className="pt-3 space-y-2 border-t border-white/10 mt-2">
                  <Link to="/login" onClick={handleNavClick} className="block py-3 px-4 text-sm font-medium text-center text-white/85 hover:bg-white/10 rounded-lg transition-colors">{t.nav.login}</Link>
                  <Link to="/login" onClick={handleNavClick} className="block py-3 px-4 text-sm font-semibold text-center bg-white text-[#000080] hover:bg-white/92 rounded-lg transition-colors">{t.nav.register}</Link>
                </div>
              </div>
            )}
          </div>
        </nav>

        {/* Main Content Rendered by Nested Routes */}
        <main id="main-content" className="min-h-[calc(100vh-10rem)] pt-16">
          <Outlet context={{ lang, setLang, t, isZh }} />
        </main>

        {/* Footer */}
        <footer className="py-9 sm:py-10 px-4 bg-[#000080] dark:bg-[#05064D] border-t border-white/10">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#3457D5] dark:bg-[#3457D5] flex items-center justify-center shadow-md">
                  <RemixIcon name="book-open-line" size={18} className="text-white" />
                </div>
                <span className="font-semibold text-sm text-white">HAKCC</span>
              </div>
              <p className="text-sm text-gray-300 dark:text-white/72 text-center sm:text-left text-pretty">{t.footer.description}</p>
              <p className="text-xs text-gray-400 dark:text-white/55">{t.footer.copyright}</p>
            </div>
          </div>
        </footer>

        {/* Back to Top Button */}
        <button
          onClick={scrollToTop}
          className={`fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-[#3457D5] hover:bg-[#000080] dark:bg-[#3457D5] dark:hover:bg-[#5B78E8] text-white shadow-md hover:shadow-lg transition-all duration-300 flex items-center justify-center focus-ring ${
            showBackToTop ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
          }`}
          aria-label={isZh ? '回到顶部' : 'Back to top'}
        >
          <ArrowUp size={20} />
        </button>

      </div>
    </>
  );
}
