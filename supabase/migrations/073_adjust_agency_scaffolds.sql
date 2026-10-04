-- Revise wording, grouping, and ordering of the AI interaction prompts.
-- Referenced prompts are protected from deletion; inconsistent changes abort the transaction.
-- Match on category/title rather than deployment-specific identifiers.

do $migrate$
declare
  drops jsonb := $drop$
[
{"category":"生成式 AI 交互/GAI 先想再问","title":"同一个问题换一种问法，GenAI的回答不同在于"},
{"category":"生成式 AI 交互/GAI 判断与取舍","title":"GenAI的回答里，我决定不用的部分和理由是"},
{"category":"生成式 AI 交互/GAI 多方求证","title":"我请同学核对了GenAI的这个说法，同学的意见是"},
{"category":"生成式 AI 交互/GAI 回顾与校准","title":"这次GenAI让我的判断更强或更弱的地方是"},
{"category":"生成式 AI 交互/GAI 回顾与校准","title":"下次和GenAI协作，我会改变的一处做法是，因为"},
{"category":"生成式 AI 交互/GAI 怎样对待这段回答","title":"GenAI的这个说法，我还没有核对"},
{"category":"生成式 AI 交互/GAI 怎样对待这段回答","title":"GenAI提供的备选，我暂时没有采用"}
]
$drop$;
  adj jsonb := $adjust$
[
{"old_category":"生成式 AI 交互/GAI 先想再问","old_title":"这次用GenAI，我想达到的学习目的是","category":"生成式 AI 交互/思考后询问 GAI","title":"我使用GenAI想达到的学习目的是","title_en":"The learning goal I want to reach by using GenAI is","l2_zh":"思考后询问 GAI","l2_en":"Think first, then ask GAI","sort_order":184,"gai":false},
{"old_category":"生成式 AI 交互/GAI 先想再问","old_title":"问GenAI之前，我自己的想法是","category":"生成式 AI 交互/思考后询问 GAI","title":"在询问GenAI之前，我自己的idea是","title_en":"Before asking GenAI, my own idea is","l2_zh":"思考后询问 GAI","l2_en":"Think first, then ask GAI","sort_order":185,"gai":false},
{"old_category":"生成式 AI 交互/GAI 先想再问","old_title":"我判断GenAI答得好不好的标准是","category":"生成式 AI 交互/思考后询问 GAI","title":"我判断GenAI的回答好坏的标准是","title_en":"My criteria for judging whether GenAI's answer is good are","l2_zh":"思考后询问 GAI","l2_en":"Think first, then ask GAI","sort_order":186,"gai":false},
{"old_category":"生成式 AI 交互/GAI 先想再问","old_title":"这件事上，我交给GenAI做的和我自己做的分别是","category":"生成式 AI 交互/思考后询问 GAI","title":"当前这个任务，我让GenAI思考的和我自己思考的分别是","title_en":"On the current task, what I let GenAI think about and what I think about myself are","l2_zh":"思考后询问 GAI","l2_en":"Think first, then ask GAI","sort_order":187,"gai":false},
{"old_category":"生成式 AI 交互/GAI 先想再问","old_title":"我告诉GenAI的背景和限定条件是","category":"生成式 AI 交互/思考后询问 GAI","title":"我告诉GenAI的背景和限定条件是","title_en":"The background and constraints I gave GenAI are","l2_zh":"思考后询问 GAI","l2_en":"Think first, then ask GAI","sort_order":188,"gai":false},
{"old_category":"生成式 AI 交互/GAI 先想再问","old_title":"GenAI的第一次回答不合我的需要，所以我把提问改成了","category":"生成式 AI 交互/思考后询问 GAI","title":"GenAI的第一次回答不符合我的需求，所以我进一步提问","title_en":"GenAI's first answer did not meet my needs, so I asked further","l2_zh":"思考后询问 GAI","l2_en":"Think first, then ask GAI","sort_order":189,"gai":false},
{"old_category":"生成式 AI 交互/GAI 判断与取舍","old_title":"GenAI这个结论要成立，需要满足的前提是","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"GenAI的结论若要成立，需要满足的前提是","title_en":"For GenAI's conclusion to hold, what must be true is","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":190,"gai":false},
{"old_category":"生成式 AI 交互/GAI 判断与取舍","old_title":"如果GenAI这里说错了，最可能错在","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"GenAI的回答有问题，主要在于","title_en":"GenAI's answer has a problem, mainly in","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":191,"gai":false},
{"old_category":"生成式 AI 交互/GAI 判断与取舍","old_title":"GenAI的回答可能带有的偏向，或没有考虑到的立场是","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"GenAI的回答可能带有的偏向，或没有考虑到的是","title_en":"Possible bias in GenAI's answer, or what it did not consider, is","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":192,"gai":false},
{"old_category":"生成式 AI 交互/GAI 判断与取舍","old_title":"我要求GenAI说明依据，它给出的是，我的判断是","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"我要求GenAI说明依据，它给出的是……，我对此的判断是","title_en":"I asked GenAI for its basis; it gave ..., and my judgement of this is","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":193,"gai":false},
{"old_category":"生成式 AI 交互/GAI 判断与取舍","old_title":"GenAI的回答里，我决定采用的部分和理由是","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"GenAI的回答中，我决定采用的部分和理由是","title_en":"The part of GenAI's answer I decided to use, and why","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":194,"gai":false},
{"old_category":"生成式 AI 交互/GAI 判断与取舍","old_title":"我用自己学过的知识修改了GenAI的一处说法，改动和依据是","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"我用已有知识经验纠正了GenAI的说法，依据是","title_en":"I corrected GenAI's statement using my prior knowledge and experience; my basis is","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":195,"gai":false},
{"old_category":"生成式 AI 交互/GAI 判断与取舍","old_title":"把GenAI的方案放到我们的具体情境里，需要调整的是","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"把GenAI的方案放到我们讨论的具体情境中，需要调整的是","title_en":"Fitting GenAI's proposal to the specific situation we are discussing, what needs adjusting is","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":196,"gai":false},
{"old_category":"生成式 AI 交互/GAI 判断与取舍","old_title":"用自己的话说，GenAI这段回答的意思是","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"我对GenAI的这段回答进行了转述","title_en":"I paraphrased this answer from GenAI","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":197,"gai":false},
{"old_category":"生成式 AI 交互/GAI 怎样对待这段回答","old_title":"GenAI的这个说法，我已用别的来源核对过","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"GenAI的这个说法，我已用别的来源进行了核对","title_en":"GenAI's claim below, which I have checked against another source","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":198,"gai":true},
{"old_category":"生成式 AI 交互/GAI 怎样对待这段回答","old_title":"GenAI给的初稿，我会在它的基础上改写","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"我对GenAI的回答进行了改写","title_en":"I rewrote GenAI's answer","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":199,"gai":true},
{"old_category":"生成式 AI 交互/GAI 怎样对待这段回答","old_title":"GenAI的这个说法，我打算当作反例来检验","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"GenAI的这个回答，我打算当作反例来检验","title_en":"GenAI's answer below, which I will test as a counter-example","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":200,"gai":true},
{"old_category":"生成式 AI 交互/GAI 怎样对待这段回答","old_title":"GenAI和我看法不同的地方","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"GenAI和我看法不同的地方在于","title_en":"Where GenAI's view differs from mine is","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":201,"gai":true},
{"old_category":"生成式 AI 交互/GAI 怎样对待这段回答","old_title":"我追问GenAI之后，它补充的依据","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"我追问GenAI之后，它补充的证据是","title_en":"The evidence GenAI added when I pressed it is","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":202,"gai":true},
{"old_category":"生成式 AI 交互/GAI 怎样对待这段回答","old_title":"GenAI帮我整理了我自己的想法，观点是我的","category":"生成式 AI 交互/GAI 回答的判断与取舍","title":"GenAI帮我整理了我自己的想法","title_en":"GenAI organised my own ideas","l2_zh":"GAI 回答的判断与取舍","l2_en":"Judge and choose from GAI answers","sort_order":203,"gai":true},
{"old_category":"生成式 AI 交互/GAI 多方求证","old_title":"我把GenAI的这个说法和课本、文献对照，发现","category":"生成式 AI 交互/GAI 多方求证","title":"我将GenAI的回答与教材和相关文献资料对照，发现","title_en":"Comparing GenAI's answer with the textbook and related literature, I found","l2_zh":"GAI 多方求证","l2_en":"Check GAI with others","sort_order":204,"gai":false},
{"old_category":"生成式 AI 交互/GAI 多方求证","old_title":"GenAI和别的来源说法不一致，我更相信哪一个，理由是","category":"生成式 AI 交互/GAI 多方求证","title":"GenAI和其他来源说法不一致，我更相信……，理由是","title_en":"GenAI and another source disagree; I trust ... more, because","l2_zh":"GAI 多方求证","l2_en":"Check GAI with others","sort_order":205,"gai":false},
{"old_category":"生成式 AI 交互/GAI 多方求证","old_title":"我把借助GenAI完成的这部分给同学或老师看了，他们的建议是","category":"生成式 AI 交互/GAI 多方求证","title":"我把借助GenAI完成的内容给同学或老师查看，他们的建议是","title_en":"I showed what I did with GenAI to a classmate or teacher; their suggestion is","l2_zh":"GAI 多方求证","l2_en":"Check GAI with others","sort_order":206,"gai":false},
{"old_category":"生成式 AI 交互/GAI 多方求证","old_title":"我想请大家帮我核对GenAI的这个说法，我的疑问是","category":"生成式 AI 交互/GAI 多方求证","title":"我想请大家帮我核对GenAI的这个回答，我的疑问是","title_en":"I would like help checking this GenAI answer; my doubt is","l2_zh":"GAI 多方求证","l2_en":"Check GAI with others","sort_order":207,"gai":false},
{"old_category":"生成式 AI 交互/GAI 多方求证","old_title":"GenAI帮不上的地方是，所以我去找了","category":"生成式 AI 交互/GAI 多方求证","title":"GenAI在这个问题上不能提供有效帮助，所以我找了其他资料","title_en":"GenAI could not give effective help on this question, so I looked for other materials","l2_zh":"GAI 多方求证","l2_en":"Check GAI with others","sort_order":208,"gai":false},
{"old_category":"生成式 AI 交互/GAI 多方求证","old_title":"我和同学问GenAI同一个问题，回答不一样的地方是","category":"生成式 AI 交互/GAI 多方求证","title":"我和同学向GenAI问了同一个问题，发现回答不一样的地方是","title_en":"A classmate and I asked GenAI the same question, and found our answers differ in","l2_zh":"GAI 多方求证","l2_en":"Check GAI with others","sort_order":209,"gai":false},
{"old_category":"生成式 AI 交互/GAI 多方求证","old_title":"我们核对之后，对GenAI这个说法的共同判断是","category":"生成式 AI 交互/GAI 多方求证","title":"我和同学/老师核对之后，对GenAI这个说法的共同判断是","title_en":"After checking with a classmate or teacher, our shared judgement on this GenAI claim is","l2_zh":"GAI 多方求证","l2_en":"Check GAI with others","sort_order":210,"gai":false},
{"old_category":"生成式 AI 交互/GAI 多方求证","old_title":"我为这个结论负责，我做过的核对有","category":"生成式 AI 交互/GAI 多方求证","title":"我为这个结论负责，我做过的核对有","title_en":"I stand behind this conclusion; the checks I have made are","l2_zh":"GAI 多方求证","l2_en":"Check GAI with others","sort_order":211,"gai":false},
{"old_category":"生成式 AI 交互/GAI 回顾与校准","old_title":"这次用GenAI，对我的学习目的有帮助和有妨碍的分别是","category":"生成式 AI 交互/GAI 使用回顾与校准","title":"使用GenAI，对我的学习目的有帮助和有妨碍的分别是","title_en":"Using GenAI, what helped and what got in the way of my learning goal are","l2_zh":"GAI 使用回顾与校准","l2_en":"Review and recalibrate GAI use","sort_order":212,"gai":false},
{"old_category":"生成式 AI 交互/GAI 回顾与校准","old_title":"合上GenAI，我现在能自己讲清楚的是，还讲不清的是","category":"生成式 AI 交互/GAI 使用回顾与校准","title":"不使用GenAI，我现在能自己独立表达的知识/概念是，还不清楚的知识/概念是","title_en":"Without GenAI, the knowledge or concepts I can now express on my own are; the ones I am still unclear about are","l2_zh":"GAI 使用回顾与校准","l2_en":"Review and recalibrate GAI use","sort_order":213,"gai":false},
{"old_category":"生成式 AI 交互/GAI 回顾与校准","old_title":"和问GenAI之前相比，我的想法变化在于","category":"生成式 AI 交互/GAI 使用回顾与校准","title":"与GenAI互动之前相比，我的想法变化在于","title_en":"Compared with before I interacted with GenAI, my thinking has changed in","l2_zh":"GAI 使用回顾与校准","l2_en":"Review and recalibrate GAI use","sort_order":214,"gai":false},
{"old_category":"生成式 AI 交互/GAI 回顾与校准","old_title":"我现在卡住的地方是，GenAI能帮上和帮不上的分别是","category":"生成式 AI 交互/GAI 使用回顾与校准","title":"我现在遇到的问题是……，GenAI能提供的帮助和不能提供的帮助分别是","title_en":"The problem I am facing now is ..., and the help GenAI can and cannot provide is","l2_zh":"GAI 使用回顾与校准","l2_en":"Review and recalibrate GAI use","sort_order":215,"gai":false},
{"old_category":"生成式 AI 交互/GAI 回顾与校准","old_title":"这次GenAI出错的地方是，我是这样发现的","category":"生成式 AI 交互/GAI 使用回顾与校准","title":"GenAI出错的地方是……，我通过……发现的","title_en":"Where GenAI went wrong is ..., and I found this out by ...","l2_zh":"GAI 使用回顾与校准","l2_en":"Review and recalibrate GAI use","sort_order":216,"gai":false},
{"old_category":"生成式 AI 交互/GAI 回顾与校准","old_title":"回顾前面借助GenAI完成的任务，我的做法有了这样的变化","category":"生成式 AI 交互/GAI 使用回顾与校准","title":"回顾前面借助GenAI完成的任务，我的做法有……的变化","title_en":"Looking back at earlier tasks I did with GenAI, my way of working has changed in terms of","l2_zh":"GAI 使用回顾与校准","l2_en":"Review and recalibrate GAI use","sort_order":217,"gai":false}
]
$adjust$;
  n_del int;
  n_upd int;
  n_left int;
begin
  delete from public.scaffolds s
  using jsonb_to_recordset(drops) as d(category text, title text)
  where s.course_id is null
    and s.category = d.category
    and s.title = d.title
    and s.metadata->>'source' = 'agency_design_2026'
    and not exists (select 1 from public.note_ai_insertions x where x.scaffold_id = s.id)
    and not exists (select 1 from public.note_conversation_messages x where x.scaffold_id = s.id)
    and not exists (select 1 from public.notes x where x.ai_adoption_scaffold_id = s.id)
    and not exists (select 1 from public.notes x where position(s.id::text in x.content) > 0);
  get diagnostics n_del = row_count;

  update public.scaffolds s
  set title = r.title,
      title_en = r.title_en,
      description = r.title_en,
      category = r.category,
      sort_order = r.sort_order,
      steps = jsonb_build_array(jsonb_build_object(
        'id', 's1', 'type', 'textarea', 'prompt', r.title, 'required', true, 'placeholder', r.title_en)),
      metadata = s.metadata || jsonb_build_object('l2_zh', r.l2_zh, 'l2_en', r.l2_en, 'gai', r.gai)
  from jsonb_to_recordset(adj) as r(old_category text, old_title text, category text, title text, title_en text,
                                    l2_zh text, l2_en text, sort_order int, gai boolean)
  where s.course_id is null
    and s.category = r.old_category
    and s.title = r.old_title;
  get diagnostics n_upd = row_count;

  select count(*) into n_left from public.scaffolds
   where course_id is null and metadata->>'source' = 'agency_design_2026';

  -- 第一次：删 7 改 34；已经执行过：删 0 改 0。别的组合都说明库和 072 对不上，整份回滚
  if not ((n_del = 7 and n_upd = 34) or (n_del = 0 and n_upd = 0)) or n_left <> 34 then
    raise exception '073 对不上：删了 % 条（应为 7）、改了 % 条（应为 34）、剩 % 条（应为 34）', n_del, n_upd, n_left;
  end if;
end
$migrate$;

notify pgrst, 'reload schema';
