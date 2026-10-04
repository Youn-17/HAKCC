/**
 * Coding Trainer (Vibe Coding 道场) — AI pair-programming practice.
 *
 * Python executes client-side in a Pyodide web worker; the server generates
 * tasks, powers the AI copilot, and settles scores. Vibe coding skills being
 * trained: describing intent clearly (prompting), reading generated code,
 * spotting/fixing AI mistakes (debugging), and small-step iteration.
 *
 * Modes:
 *  - challenge: natural-language-driven task solving against visible tests;
 *               fewer AI iterations → higher score
 *  - bughunt:   fix AI-written buggy code by hand; AI help costs points
 *  - sandbox:   free build with the copilot, no tests, no pressure
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { resolveProvider, callJson } from './thinkingTrainer';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../middleware/rateLimitKey';

const router = Router();

const startLimit = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: 'Too many new sessions' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: rateLimitKey,
});
const aiLimit = rateLimit({
  windowMs: 60 * 1000, max: 20,
  message: { error: 'Too many AI requests, slow down' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

type CodingMode = 'challenge' | 'bughunt' | 'sandbox';
const CODING_SKILLS = ['prompting', 'reading', 'debugging', 'iteration'] as const;

// ── Built-in task banks (fallback when no course AI) ───────────

const BUILTIN_CHALLENGES = [
  {
    title: '倒计时火箭',
    description: '编写程序，从 5 倒数到 1，每行输出一个数字，最后输出「发射!」。',
    difficulty: 1,
    starterHint: '试着告诉 AI：写一个倒计时程序，从几数到几，最后打印什么。',
    testCode: `_expected = "5\\n4\\n3\\n2\\n1\\n发射!"\nimport io, sys\n_buf = io.StringIO()\n_old = sys.stdout\nsys.stdout = _buf\ntry:\n    main()\nfinally:\n    sys.stdout = _old\nassert _buf.getvalue().strip() == _expected, f"输出不对：{_buf.getvalue().strip()!r}"\nprint("__ALL_TESTS_PASSED__")`,
    requires: '定义一个 main() 函数完成任务',
  },
  {
    title: '元音统计器',
    description: '定义函数 count_vowels(text)，统计英文句子里元音字母（aeiou，不分大小写）的个数并返回。',
    difficulty: 1,
    starterHint: '描述清楚：函数名、参数、要统计什么、返回什么。',
    testCode: `assert count_vowels("Hello World") == 3, "Hello World 应该有 3 个元音"\nassert count_vowels("AEIOU aeiou") == 10\nassert count_vowels("xyz") == 0\nprint("__ALL_TESTS_PASSED__")`,
    requires: '定义函数 count_vowels(text) -> int',
  },
  {
    title: '成绩等级转换',
    description: '定义函数 grade(score)：90 及以上返回 "A"，80-89 返回 "B"，70-79 返回 "C"，60-69 返回 "D"，60 以下返回 "F"。',
    difficulty: 1,
    starterHint: '边界值（如正好 90 分）最容易出错，跟 AI 说清楚。',
    testCode: `assert grade(95) == "A"\nassert grade(90) == "A"\nassert grade(89) == "B"\nassert grade(70) == "C"\nassert grade(60) == "D"\nassert grade(59) == "F"\nprint("__ALL_TESTS_PASSED__")`,
    requires: '定义函数 grade(score) -> str',
  },
  {
    title: '词频排行榜',
    description: '定义函数 top_words(text, n)，统计文本中每个单词出现的次数（按空格分词、转小写），返回出现最多的前 n 个单词组成的列表（按次数降序，次数相同按字母序）。',
    difficulty: 2,
    starterHint: '排序规则有两层（次数降序、字母升序），这是 AI 常错的点。',
    testCode: `assert top_words("apple banana apple cherry banana apple", 2) == ["apple", "banana"]\nassert top_words("b a b a c", 3) == ["a", "b", "c"]\nassert top_words("Hello hello HELLO", 1) == ["hello"]\nprint("__ALL_TESTS_PASSED__")`,
    requires: '定义函数 top_words(text, n) -> list',
  },
  {
    title: '回文侦测',
    description: '定义函数 is_palindrome(s)，判断字符串是否是回文——忽略大小写和空格。',
    difficulty: 2,
    starterHint: '「忽略大小写和空格」这个细节必须说给 AI 听。',
    testCode: `assert is_palindrome("Never odd or even") == True\nassert is_palindrome("上海自来水来自海上") == True\nassert is_palindrome("hello") == False\nassert is_palindrome("A") == True\nprint("__ALL_TESTS_PASSED__")`,
    requires: '定义函数 is_palindrome(s) -> bool',
  },
  {
    title: '购物找零机',
    description: '定义函数 make_change(amount)，把金额（整数，单位：元）拆成最少张数的纸币（面额 100/50/20/10/5/1），返回字典 {面额: 张数}，张数为 0 的面额不出现。',
    difficulty: 3,
    starterHint: '贪心策略 + 「为 0 不出现」的过滤条件，试着一次说清。',
    testCode: `assert make_change(186) == {100: 1, 50: 1, 20: 1, 10: 1, 5: 1, 1: 1}\nassert make_change(200) == {100: 2}\nassert make_change(3) == {1: 3}\nprint("__ALL_TESTS_PASSED__")`,
    requires: '定义函数 make_change(amount) -> dict',
  },
];

const BUILTIN_BUGHUNTS = [
  {
    title: '平均分算错了',
    description: '这个函数应该返回列表的平均值，但结果总是偏小。找出 bug 并修复。',
    difficulty: 1,
    buggyCode: `def average(nums):\n    total = 0\n    for n in nums:\n        total += n\n    return total // len(nums)\n`,
    bugHint: '注意除法运算符',
    testCode: `assert average([1, 2, 3, 4]) == 2.5, f"期望 2.5，得到 {average([1,2,3,4])}"\nassert average([10]) == 10\nprint("__ALL_TESTS_PASSED__")`,
  },
  {
    title: '越界的循环',
    description: '这个函数应该返回列表中相邻两数之和的列表，但一运行就报错。',
    difficulty: 1,
    buggyCode: `def pair_sums(nums):\n    result = []\n    for i in range(len(nums)):\n        result.append(nums[i] + nums[i + 1])\n    return result\n`,
    bugHint: '最后一次循环时 i+1 指向哪里？',
    testCode: `assert pair_sums([1, 2, 3]) == [3, 5]\nassert pair_sums([5]) == []\nprint("__ALL_TESTS_PASSED__")`,
  },
  {
    title: '默认参数陷阱',
    description: '这个函数往购物车加商品，但多次调用后购物车会互相污染——第二次新建的购物车里居然有第一次的商品！',
    difficulty: 2,
    buggyCode: `def add_item(item, cart=[]):\n    cart.append(item)\n    return cart\n`,
    bugHint: 'Python 的可变默认参数只创建一次',
    testCode: `c1 = add_item("apple")\nc2 = add_item("banana")\nassert c2 == ["banana"], f"新购物车应该只有 banana，却是 {c2}"\nprint("__ALL_TESTS_PASSED__")`,
  },
  {
    title: '循环里的删除',
    description: '这个函数应该删掉列表里所有偶数，但总有漏网之鱼。',
    difficulty: 2,
    buggyCode: `def remove_evens(nums):\n    for n in nums:\n        if n % 2 == 0:\n            nums.remove(n)\n    return nums\n`,
    bugHint: '边遍历边删除会跳过元素',
    testCode: `assert remove_evens([1, 2, 4, 5]) == [1, 5]\nassert remove_evens([2, 4, 6, 8]) == [], f"应该全删掉，剩下 {remove_evens([2,4,6,8])}"\nprint("__ALL_TESTS_PASSED__")`,
  },
  {
    title: '字符串不会变',
    description: '这个函数应该把句子里每个单词首字母大写，但输出和输入一模一样。',
    difficulty: 1,
    buggyCode: `def title_case(sentence):\n    words = sentence.split()\n    for w in words:\n        w.capitalize()\n    return " ".join(words)\n`,
    bugHint: '字符串方法不会原地修改',
    testCode: `assert title_case("hello world") == "Hello World"\nassert title_case("python") == "Python"\nprint("__ALL_TESTS_PASSED__")`,
  },
  {
    title: '比较还是赋值？',
    description: '这个函数统计及格人数，但不管传什么都返回列表长度。',
    difficulty: 1,
    buggyCode: `def count_pass(scores):\n    count = 0\n    for s in scores:\n        if s >= 60:\n            count += 1\n        else:\n            count += 1\n    return count\n`,
    bugHint: '仔细看两个分支',
    testCode: `assert count_pass([50, 60, 70]) == 2\nassert count_pass([10, 20]) == 0\nprint("__ALL_TESTS_PASSED__")`,
  },
];

// ── Helpers ────────────────────────────────────────────────────

async function loadSession(id: string, userId: string) {
  const { data, error } = await supabase
    .from('coding_sessions').select('*')
    .eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Session not found');
  return data;
}

async function saveSession(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from('coding_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new ApiError(500, error.message);
}

function extractPythonCode(text: string): string {
  const fenced = text.match(/```(?:python|py)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

// ── POST /coding-trainer/sessions — start ──────────────────────

router.post('/coding-trainer/sessions', verifyJWT, startLimit, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { mode, difficulty = 1 } = req.body as { mode: CodingMode; difficulty?: number };
  if (!['challenge', 'bughunt', 'sandbox'].includes(mode)) throw new ApiError(400, 'Invalid mode');
  const diff = Math.min(Math.max(Number(difficulty) || 1, 1), 3);

  const cfg = await resolveProvider(userId);
  let task: Record<string, unknown> = {};

  if (mode === 'challenge') {
    let generated: any = null;
    if (cfg) {
      const gen = await callJson(cfg,
        '你是 Python 编程练习的出题人。只输出 JSON，不要输出其他内容。',
        `生成 1 道适合初学者的 Python vibe coding 练习题，难度 ${diff}/3。
要求：
- description: 任务描述（中文，60字内，明确函数名/参数/返回值或输出格式）
- requires: 一句话说明需要定义什么（如"定义函数 xxx(a, b) -> int"）
- starterHint: 给学生的提示语，告诉他们向 AI 描述需求时要注意什么细节（30字内）
- testCode: Python 测试代码——用 assert 验证 2-4 个用例（含边界情况），全部通过后必须执行 print("__ALL_TESTS_PASSED__")。测试代码假设学生代码已在同一作用域执行。assert 失败时带中文提示信息。
- title: 有趣的标题（8字内）
输出：{"title":"...","description":"...","requires":"...","starterHint":"...","testCode":"..."}`,
        1600);
      if (gen?.title && gen?.description && typeof gen?.testCode === 'string' && (gen.testCode as string).includes('__ALL_TESTS_PASSED__')) {
        generated = gen;
      }
    }
    const pick = generated ?? BUILTIN_CHALLENGES.filter(c => c.difficulty <= diff).sort(() => Math.random() - 0.5)[0] ?? BUILTIN_CHALLENGES[0];
    task = {
      title: pick.title, description: pick.description, requires: pick.requires,
      starterHint: pick.starterHint, testCode: pick.testCode, starterCode: '',
    };
  }

  if (mode === 'bughunt') {
    let generated: any = null;
    if (cfg) {
      const gen = await callJson(cfg,
        '你是 Python 调试练习的出题人。只输出 JSON。',
        `生成 1 道"找 bug"练习，难度 ${diff}/3。
要求：
- buggyCode: 一段 5-12 行、含恰好 1 个典型 bug 的 Python 函数（初学者常犯：整除/越界/可变默认参数/边遍历边删/字符串不可变/条件写错等）
- description: 描述这段代码"应该"做什么、现在的异常表现（中文50字内）
- bugHint: 一句不剧透的提示（15字内）
- testCode: assert 测试，修复后全过并 print("__ALL_TESTS_PASSED__")，失败带中文提示
- title: 标题（8字内）
输出：{"title":"...","description":"...","buggyCode":"...","bugHint":"...","testCode":"..."}`,
        1600);
      if (gen?.buggyCode && typeof gen?.testCode === 'string' && (gen.testCode as string).includes('__ALL_TESTS_PASSED__')) {
        generated = gen;
      }
    }
    const pick = generated ?? BUILTIN_BUGHUNTS.filter(c => c.difficulty <= diff).sort(() => Math.random() - 0.5)[0] ?? BUILTIN_BUGHUNTS[0];
    task = {
      title: pick.title, description: pick.description, starterCode: pick.buggyCode,
      bugHint: pick.bugHint, testCode: pick.testCode,
    };
  }

  if (mode === 'sandbox') {
    task = {
      title: '自由创作',
      description: '想做什么就做什么——让 AI 副驾帮你把想法变成能跑的代码。',
      starterCode: '# 在这里写代码，或让 AI 副驾帮你生成\nprint("Hello, Vibe Coding!")\n',
      testCode: '',
    };
  }

  const { data: session, error } = await supabase
    .from('coding_sessions')
    .insert({ user_id: userId, mode, difficulty: diff, task, state: { hintUsed: false }, status: 'active' })
    .select('id')
    .single();
  if (error) throw new ApiError(500, error.message);

  res.json({ sessionId: session.id, mode, difficulty: diff, aiPowered: !!cfg, task });
});

// ── POST /coding-trainer/sessions/:id/ai — the copilot ─────────

router.post('/coding-trainer/sessions/:id/ai', verifyJWT, aiLimit, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const session = await loadSession(String(req.params.id), userId);
  if (session.status !== 'active') throw new ApiError(400, 'Session finished');

  const { action, prompt, currentCode, lastOutput } = req.body as {
    action: 'generate' | 'explain' | 'fix' | 'review';
    prompt?: string;
    currentCode?: string;
    lastOutput?: string;
  };
  if (!['generate', 'explain', 'fix', 'review'].includes(action)) throw new ApiError(400, 'Invalid action');
  if ((currentCode ?? '').length > 8000 || (prompt ?? '').length > 1000) throw new ApiError(400, 'Input too long');

  const cfg = await resolveProvider(userId);
  if (!cfg) {
    return res.json({
      reply: '这门课程还没有配置 AI 服务，副驾暂时下线。你仍然可以自己写代码、运行和提交——或请老师在课程设置中配置 AI。',
      code: null,
      aiPowered: false,
    });
  }

  const task = session.task as any;
  const isBugHunt = session.mode === 'bughunt';
  const taskContext = `任务：${task.title} — ${task.description}${task.requires ? `\n要求：${task.requires}` : ''}`;

  const systemPrompts: Record<string, string> = {
    generate: `你是学生的 vibe coding 结对程序员。根据学生的自然语言需求写 Python 代码。
规则：代码要简洁、带简短中文注释；如果学生的需求描述有歧义或缺少关键细节，在 reply 里指出来（这是在训练他们把需求说清楚）；不要直接展示测试答案。只输出 JSON。`,
    explain: `你是耐心的代码讲解员。用初学者能懂的语言逐段解释代码在做什么，指出关键概念。只输出 JSON。`,
    fix: isBugHunt
      ? `你是调试教练。学生在做"找 bug"练习——不要直接给出修复后的代码！只能给渐进式提示：先指出 bug 的类别和大致位置，引导学生自己发现。只输出 JSON。`
      : `你是调试教练。根据代码和报错输出，解释错误原因并给出修复后的完整代码。只输出 JSON。`,
    review: `你是代码评审员。从可读性、正确性、边界处理三个角度点评学生代码，给出 1-2 条具体改进建议。只输出 JSON。`,
  };

  const userMessage = `${taskContext}

当前编辑器中的代码：
\`\`\`python
${(currentCode ?? '').slice(0, 6000) || '(空)'}
\`\`\`
${lastOutput ? `\n最近一次运行输出：\n${String(lastOutput).slice(0, 1000)}` : ''}
${prompt ? `\n学生说：「${prompt.trim()}」` : ''}

输出 JSON：{"reply":"给学生的话（中文，简洁）","code":"完整的新代码（仅当需要给代码时，否则 null）"}`;

  const result = await callJson(cfg, systemPrompts[action], userMessage, 2500);

  const state = session.state as any;
  if (isBugHunt && action === 'fix') state.hintUsed = true;
  await saveSession(session.id, { ai_calls: (session.ai_calls ?? 0) + 1, state });

  if (!result) {
    return res.json({ reply: 'AI 副驾开小差了，稍后再试试。', code: null, aiPowered: true });
  }
  const code = typeof result.code === 'string' && result.code.trim() && result.code !== 'null'
    ? extractPythonCode(String(result.code))
    : null;
  res.json({ reply: String(result.reply ?? ''), code, aiPowered: true });
});

// ── POST /coding-trainer/sessions/:id/run — count a run ────────

router.post('/coding-trainer/sessions/:id/run', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const session = await loadSession(String(req.params.id), userId);
  if (session.status === 'active') {
    await saveSession(session.id, { runs: (session.runs ?? 0) + 1 });
  }
  res.json({ ok: true });
});

// ── POST /coding-trainer/sessions/:id/submit — settle ──────────

router.post('/coding-trainer/sessions/:id/submit', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const session = await loadSession(String(req.params.id), userId);
  const { passed, finalCode } = req.body as { passed: boolean; finalCode?: string };

  const state = session.state as any;
  let score = 0;
  const skillDeltas: Record<string, number> = {};

  if (session.mode === 'challenge' && passed) {
    const iterations = Math.max(session.ai_calls, 1);
    score = Math.max(100 - (iterations - 1) * 12, 40) + session.difficulty * 20;
    skillDeltas.prompting = Math.max(6 - iterations, 1) * 2;
    skillDeltas.iteration = Math.min(session.runs, 5);
    skillDeltas.reading = 2;
  } else if (session.mode === 'bughunt' && passed) {
    score = Math.max(100 - (state.hintUsed ? 30 : 0) - Math.max(session.runs - 2, 0) * 5, 30) + session.difficulty * 20;
    skillDeltas.debugging = state.hintUsed ? 3 : 6;
    skillDeltas.reading = 4;
  } else if (session.mode === 'sandbox') {
    score = Math.min(session.runs * 2 + session.ai_calls * 3, 40);
    skillDeltas.prompting = Math.min(session.ai_calls, 4);
    skillDeltas.iteration = Math.min(session.runs, 4);
  }

  await saveSession(session.id, {
    score,
    status: passed || session.mode === 'sandbox' ? 'completed' : 'abandoned',
    completed_at: new Date().toISOString(),
    state: { ...state, finalCode: (finalCode ?? '').slice(0, 8000) },
  });

  // Settle profile
  const { data: existing } = await supabase
    .from('coding_profiles').select('*').eq('user_id', userId).maybeSingle();

  const xpGain = Math.round(score / 8);
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const lastKey = existing?.last_played_at ? String(existing.last_played_at).slice(0, 10) : null;
  const yesterdayKey = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const streak = lastKey === todayKey ? (existing?.streak_days ?? 1)
    : lastKey === yesterdayKey ? (existing?.streak_days ?? 0) + 1 : 1;

  const skills: Record<string, number> = { ...(existing?.skills ?? {}) };
  for (const [k, v] of Object.entries(skillDeltas)) {
    if ((CODING_SKILLS as readonly string[]).includes(k)) skills[k] = (skills[k] ?? 0) + v;
  }
  const bestScores: Record<string, number> = { ...(existing?.best_scores ?? {}) };
  bestScores[session.mode] = Math.max(bestScores[session.mode] ?? 0, score);

  const totalXp = (existing?.total_xp ?? 0) + xpGain;
  const level = Math.floor(Math.sqrt(totalXp / 40)) + 1;

  const { error } = await supabase.from('coding_profiles').upsert({
    user_id: userId,
    total_xp: totalXp,
    level,
    skills,
    challenges_completed: (existing?.challenges_completed ?? 0) + (session.mode === 'challenge' && passed ? 1 : 0),
    bugs_fixed: (existing?.bugs_fixed ?? 0) + (session.mode === 'bughunt' && passed ? 1 : 0),
    games_played: (existing?.games_played ?? 0) + 1,
    streak_days: streak,
    last_played_at: now.toISOString(),
    best_scores: bestScores,
    updated_at: now.toISOString(),
  });
  if (error) throw new ApiError(500, error.message);

  res.json({
    score,
    xpGain,
    totalXp,
    level,
    leveledUp: level > (existing?.level ?? 1),
    streak,
    skills,
    isNewBest: score >= (bestScores[session.mode] ?? 0) && score > 0,
  });
});

// ── GET /coding-trainer/profile ────────────────────────────────

router.get('/coding-trainer/profile', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [profileRes, recentRes] = await Promise.all([
    supabase.from('coding_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('coding_sessions')
      .select('id, mode, task, score, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);
  const p = profileRes.data;
  res.json({
    profile: {
      totalXp: p?.total_xp ?? 0,
      level: p?.level ?? 1,
      nextLevelXp: Math.pow(p?.level ?? 1, 2) * 40,
      skills: p?.skills ?? {},
      challengesCompleted: p?.challenges_completed ?? 0,
      bugsFixed: p?.bugs_fixed ?? 0,
      gamesPlayed: p?.games_played ?? 0,
      streakDays: p?.streak_days ?? 0,
      bestScores: p?.best_scores ?? {},
    },
    recentSessions: (recentRes.data ?? []).map((s: any) => ({
      id: s.id, mode: s.mode, title: s.task?.title ?? '', score: s.score, status: s.status, created_at: s.created_at,
    })),
  });
});

export default router;
