/**
 * Computational Thinking Tool (计算思维工具) — KB-grounded problem solving.
 *
 * Knowledge Building alignment:
 *  - Real ideas, authentic problems: teachers AND students can propose
 *    problems, not just consume a built-in bank
 *  - Epistemic agency: the five CT steps are freely navigable, students mark
 *    their own progress; solutions autosave so ideas stay improvable
 *  - Community knowledge: a finished solution can be published back into the
 *    course space as a note for peers to build on
 *
 * Endpoints:
 *   GET  /ct/:courseId/problems             — list (built-ins seeded on first call)
 *   POST /ct/:courseId/problems             — propose a problem (teacher or student)
 *   GET  /ct/:courseId/solutions/:problemId — load my workspace
 *   PUT  /ct/:courseId/solutions/:problemId — autosave my workspace
 *   POST /ct/:courseId/solutions/:problemId/publish — publish summary note
 *   POST /ct/:courseId/ai-assist            — AI scaffolding (decompose/pattern/feedback)
 *   GET  /ct/:courseId/my-stats             — real analysis tab data
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { resolveCourseProviderChain, callJson } from './thinkingTrainer';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../middleware/rateLimitKey';
import { ensureSpaceAccess } from '../services/accessControl';
import { sanitizeNoteHtml } from '../services/noteHtml';

const router = Router();

const aiLimit = rateLimit({
  windowMs: 60 * 1000, max: 15,
  message: { error: 'Too many AI requests' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

async function requireCourseMember(courseId: string, req: Request): Promise<'teacher' | 'student' | 'admin'> {
  if (!req.user) throw new ApiError(401, 'Auth required');
  if (req.user.role === 'admin') return 'admin';
  const [memberRes, instructorRes] = await Promise.all([
    supabase.from('course_members').select('user_id').eq('course_id', courseId).eq('user_id', req.user.id).maybeSingle(),
    supabase.from('courses').select('id').eq('id', courseId).eq('instructor_id', req.user.id).maybeSingle(),
  ]);
  if (instructorRes.data) return 'teacher';
  if (memberRes.data) return 'student';
  throw new ApiError(403, 'Not a member of this course');
}

/** A :problemId in the path must actually belong to the :courseId beside it. */
async function assertProblemInCourse(problemId: string, courseId: string): Promise<void> {
  const { data } = await supabase
    .from('ct_problems')
    .select('id')
    .eq('id', problemId)
    .eq('course_id', courseId)
    .maybeSingle();
  if (!data) throw new ApiError(404, 'Problem not found in this course');
}

// ── Built-in problem seeds ─────────────────────────────────────

const BUILTIN_PROBLEMS = [
  {
    seed_key: 'hanoi',
    title: '汉诺塔',
    description: '把 N 个大小不同的圆盘从 A 柱全部移到 C 柱：每次只能移动一个圆盘，且大盘不能压在小盘上。最少需要多少步？怎么移？',
    category: '递归',
    difficulty: 'medium',
    starter_code: 'def hanoi(n, source, auxiliary, target):\n    # 基线条件：只有 1 个盘时直接移动\n    if n == 1:\n        print(f"把盘 1 从 {source} 移到 {target}")\n        return\n    # 递归步骤：你的代码…\n    pass\n\nhanoi(3, "A", "B", "C")',
    hints: ['先想 N=1、N=2 的最少步数，找规律', '把"移 N 个盘"拆成三个子任务', '递归的关键：相信函数能完成小一号的任务'],
  },
  {
    seed_key: 'planner',
    title: '课程表排布',
    description: '给 5 门课和 3 个时间段排课，某些课不能同时上（同一个老师教）。怎样设计一个方法，判断能否排开？这和地图着色有什么关系？',
    category: '图与约束',
    difficulty: 'hard',
    starter_code: '# 冲突关系：不能同时段的课\nconflicts = [("数学", "物理"), ("物理", "化学"), ("语文", "英语")]\ncourses = ["数学", "物理", "化学", "语文", "英语"]\nslots = 3\n\ndef can_schedule(courses, conflicts, slots):\n    # 你的思路…\n    pass',
    hints: ['把课看成点，冲突看成边——这是一张图', '相邻的点不能用同一种颜色（时间段）', '试试贪心：按冲突多少排序处理'],
  },
  {
    seed_key: 'change',
    title: '找零钱问题',
    description: '自动售货机要用最少张数的纸币找零（面额 100/50/20/10/5/1）。贪心策略总是对的吗？如果面额是 1/3/4 要找 6 元呢？',
    category: '贪心与优化',
    difficulty: 'easy',
    starter_code: 'def make_change(amount, denominations=[100, 50, 20, 10, 5, 1]):\n    result = {}\n    # 你的代码…\n    return result\n\nprint(make_change(186))',
    hints: ['先用常规面额验证贪心可行', '再试 [1,3,4] 找 6：贪心给出 4+1+1 三张，但 3+3 只要两张！', '什么情况下贪心会失效？'],
  },
  {
    seed_key: 'search',
    title: '猜数字的最优策略',
    description: '我心里想一个 1-100 的数，你每猜一次我告诉你大了还是小了。最坏情况下最少几次能猜中？为什么？',
    category: '分治与搜索',
    difficulty: 'easy',
    starter_code: 'def guess_number(low=1, high=100, target=42):\n    attempts = 0\n    # 模拟二分查找过程，打印每次猜测\n    # 你的代码…\n    return attempts\n\nprint(f"共猜了 {guess_number()} 次")',
    hints: ['每次猜测最多能排除多少可能？', '对半排除：100 → 50 → 25 → …', '2 的几次方超过 100？'],
  },
  {
    seed_key: 'pattern_seq',
    title: '数列侦探',
    description: '1, 1, 2, 3, 5, 8, 13… 下一个是几？写一个函数生成前 N 项，再想想：自然界哪里出现过这个数列？递归写法和循环写法哪个快？为什么？',
    category: '模式识别',
    difficulty: 'medium',
    starter_code: 'def fib(n):\n    # 返回前 n 项组成的列表\n    pass\n\nprint(fib(10))',
    hints: ['每一项和前两项的关系是什么？', '递归版 fib(30) 会明显变慢——数一数重复计算', '用列表记住算过的值（记忆化）'],
  },
];

async function ensureSeeds(courseId: string) {
  const { data: existing } = await supabase
    .from('ct_problems')
    .select('seed_key')
    .eq('course_id', courseId)
    .not('seed_key', 'is', null);
  const have = new Set((existing ?? []).map((p: any) => p.seed_key));
  const missing = BUILTIN_PROBLEMS.filter(p => !have.has(p.seed_key));
  if (missing.length > 0) {
    await supabase.from('ct_problems').insert(
      missing.map(p => ({ ...p, course_id: courseId, source: 'builtin', created_by: null })),
    );
  }
}

// ── GET /ct/:courseId/problems ─────────────────────────────────

router.get('/ct/:courseId/problems', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMember(courseId, req);
  await ensureSeeds(courseId);

  const [problemsRes, mySolutionsRes] = await Promise.all([
    supabase.from('ct_problems')
      .select('id, title, description, category, difficulty, source, created_by, created_at, hints, starter_code')
      .eq('course_id', courseId)
      .order('created_at', { ascending: true }),
    supabase.from('ct_solutions')
      .select('problem_id, status, step_status, updated_at')
      .eq('user_id', req.user!.id),
  ]);

  const myByProblem = new Map((mySolutionsRes.data ?? []).map((s: any) => [s.problem_id, s]));

  // Solver counts (community signal)
  const problemIds = (problemsRes.data ?? []).map((p: any) => p.id);
  const solverCounts = new Map<string, number>();
  if (problemIds.length > 0) {
    const { data: allSols } = await supabase
      .from('ct_solutions').select('problem_id').in('problem_id', problemIds);
    for (const s of allSols ?? []) {
      solverCounts.set(s.problem_id, (solverCounts.get(s.problem_id) ?? 0) + 1);
    }
  }

  // Proposer names for student/teacher-sourced problems
  const proposerIds = [...new Set((problemsRes.data ?? []).map((p: any) => p.created_by).filter(Boolean))];
  const names = new Map<string, string>();
  if (proposerIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', proposerIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name ?? '');
  }

  res.json({
    problems: (problemsRes.data ?? []).map((p: any) => {
      const mine = myByProblem.get(p.id);
      const stepStatus = (mine?.step_status ?? {}) as Record<string, boolean>;
      const doneSteps = Object.values(stepStatus).filter(Boolean).length;
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        category: p.category,
        difficulty: p.difficulty,
        source: p.source,
        proposerName: p.created_by ? (names.get(p.created_by) || '') : '',
        solverCount: solverCounts.get(p.id) ?? 0,
        myStatus: mine ? mine.status : 'not_started',
        myProgress: Math.round((doneSteps / 5) * 100),
        updatedAt: mine?.updated_at ?? null,
        hints: p.hints ?? [],
        starterCode: p.starter_code ?? '',
      };
    }),
  });
});

// ── POST /ct/:courseId/problems — propose (KB: real ideas) ─────

router.post('/ct/:courseId/problems', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const role = await requireCourseMember(courseId, req);

  const { title, description, category, difficulty } = req.body as {
    title: string; description: string; category?: string; difficulty?: string;
  };
  if (!title?.trim() || !description?.trim()) throw new ApiError(400, 'title and description required');
  if (title.length > 100 || description.length > 2000) throw new ApiError(400, 'Too long');

  const { data, error } = await supabase
    .from('ct_problems')
    .insert({
      course_id: courseId,
      created_by: req.user!.id,
      title: title.trim(),
      description: description.trim(),
      category: (category ?? 'general').slice(0, 30),
      difficulty: ['easy', 'medium', 'hard'].includes(difficulty ?? '') ? difficulty : 'medium',
      source: role === 'teacher' || role === 'admin' ? 'teacher' : 'student',
    })
    .select('id')
    .single();
  if (error) throw new ApiError(500, error.message);
  res.json({ problemId: data.id });
});

// ── GET/PUT solutions — the improvable workspace ───────────────

router.get('/ct/:courseId/solutions/:problemId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMember(courseId, req);

  const { data } = await supabase
    .from('ct_solutions')
    .select('steps, step_status, status, published_note_id, updated_at')
    .eq('problem_id', String(req.params.problemId))
    .eq('user_id', req.user!.id)
    .maybeSingle();

  res.json({
    solution: data ?? { steps: {}, step_status: {}, status: 'active', published_note_id: null, updated_at: null },
  });
});

router.put('/ct/:courseId/solutions/:problemId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMember(courseId, req);
  // Membership of :courseId does not make :problemId one of its problems —
  // the publish route below binds the two, and this write must match, or a
  // student can seed solution rows against another course's problems.
  await assertProblemInCourse(String(req.params.problemId), courseId);

  const { steps, step_status, status } = req.body as {
    steps: Record<string, unknown>; step_status: Record<string, boolean>; status?: string;
  };
  if (JSON.stringify(steps ?? {}).length > 100_000) throw new ApiError(400, 'Workspace too large');

  const { error } = await supabase
    .from('ct_solutions')
    .upsert({
      problem_id: String(req.params.problemId),
      user_id: req.user!.id,
      steps: steps ?? {},
      step_status: step_status ?? {},
      status: status === 'completed' ? 'completed' : 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'problem_id,user_id' });
  if (error) throw new ApiError(500, error.message);
  res.json({ saved: true });
});

// ── POST publish — solution flows back to the community ────────

router.post('/ct/:courseId/solutions/:problemId/publish', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMember(courseId, req);

  const [{ data: problem }, { data: solution }] = await Promise.all([
    supabase.from('ct_problems').select('id, title, description').eq('id', String(req.params.problemId)).eq('course_id', courseId).maybeSingle(),
    supabase.from('ct_solutions').select('steps').eq('problem_id', String(req.params.problemId)).eq('user_id', req.user!.id).maybeSingle(),
  ]);
  if (!problem) throw new ApiError(404, 'Problem not found');
  if (!solution) throw new ApiError(400, 'No workspace to publish');

  const steps = (solution.steps ?? {}) as any;
  const esc = (s: unknown) => String(s ?? '').replace(/</g, '&lt;').replace(/\n/g, '<br/>');
  const sections: string[] = [];
  if (steps.decomposition?.nodes?.length) {
    sections.push(`<p><strong>① 问题分解</strong><br/>${(steps.decomposition.nodes as string[]).map(n => `· ${esc(n)}`).join('<br/>')}</p>`);
  }
  if (steps.pattern?.observation) sections.push(`<p><strong>② 发现的模式</strong><br/>${esc(steps.pattern.observation)}</p>`);
  if (steps.abstraction?.essence) sections.push(`<p><strong>③ 抽象与本质</strong><br/>${esc(steps.abstraction.essence)}</p>`);
  if (steps.algorithm?.steps?.length) {
    sections.push(`<p><strong>④ 算法步骤</strong><br/>${(steps.algorithm.steps as string[]).map((s, i) => `${i + 1}. ${esc(s)}`).join('<br/>')}</p>`);
  }
  if (steps.code?.source) sections.push(`<p><strong>⑤ 代码实现</strong></p><pre>${String(steps.code.source).replace(/</g, '&lt;').slice(0, 3000)}</pre>`);
  if (steps.reflection?.text) sections.push(`<p><strong>我的反思</strong><br/>${esc(steps.reflection.text)}</p>`);
  if (sections.length === 0) throw new ApiError(400, 'Workspace is empty — nothing to publish');

  const { data: spaces } = await supabase
    .from('spaces').select('id').eq('course_id', courseId).order('created_at', { ascending: true }).limit(1);
  const spaceId = spaces?.[0]?.id;
  if (!spaceId) throw new ApiError(404, 'Course has no space');
  // Courses in the cluster-randomised study use group-bound spaces. Taking the
  // course's first space blindly would publish a student's note into another
  // group's canvas, breaking the isolation the experiment depends on.
  await ensureSpaceAccess(spaceId, req.user!);

  const content = await sanitizeNoteHtml(`<p><em>问题：${esc(problem.description).slice(0, 300)}</em></p>${sections.join('')}<p style="color:#888;font-size:12px">—— 来自计算思维工具的解题方案，欢迎建构与改进</p>`);

  const { data: note, error } = await supabase
    .from('notes')
    .insert({
      space_id: spaceId,
      author_id: req.user!.id,
      type: 'note',
      title: `CT 解题方案 · ${String(problem.title).slice(0, 40)}`,
      content,
      x: 100 + Math.random() * 400,
      y: 100 + Math.random() * 300,
      views: [],
      tags: ['计算思维', problem.title],
      epistemic_status: 'standard',
    })
    .select('id, title')
    .single();
  if (error) throw new ApiError(500, error.message);

  await supabase.from('note_metrics_realtime').insert({
    note_id: note.id,
    direct_in_degree: 0, direct_out_degree: 0, build_on_count: 0,
    unique_contributor_count: 0, revision_count: 0, challenge_count: 0,
    evidence_count: 0, synthesis_count: 0, recent_activity_score: 0, heat_score: 0,
  });
  await supabase.from('events').insert({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'note_created',
    object_type: 'note',
    object_id: note.id,
    space_id: spaceId,
    metadata_json: { source: 'ct_tool_solution', problem_id: problem.id },
  });

  await supabase
    .from('ct_solutions')
    .update({ published_note_id: note.id, updated_at: new Date().toISOString() })
    .eq('problem_id', problem.id)
    .eq('user_id', req.user!.id);

  res.json({ noteId: note.id, title: note.title });
});

// ── POST ai-assist — real AI scaffolding (replaces stub gemini) ─

router.post('/ct/:courseId/ai-assist', verifyJWT, aiLimit, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMember(courseId, req);

  const { kind, problemTitle, problemDescription, context } = req.body as {
    kind: 'decompose' | 'pattern_hint' | 'algorithm_review' | 'code_feedback' | 'reflect_prompt';
    problemTitle: string;
    problemDescription: string;
    context?: string;
  };
  if (!['decompose', 'pattern_hint', 'algorithm_review', 'code_feedback', 'reflect_prompt'].includes(kind)) {
    throw new ApiError(400, 'Invalid kind');
  }
  if ((context ?? '').length > 6000) throw new ApiError(400, 'Context too long');

  // 这门课的 key；课程 AI 设置里「思维练习、编程练习、计算思维工具」选的模型排第一，失败换下一家
  const chain = await resolveCourseProviderChain(courseId, 'practice');
  const cfg = chain[0] ?? null;
  if (!cfg) {
    return res.json({ aiPowered: false, suggestions: [], feedback: '课程未配置 AI，先自己动手试试——提示按钮里有思路指引。' });
  }

  const prompts: Record<string, { system: string; user: string }> = {
    decompose: {
      system: '你是计算思维教练。学生正在练习"问题分解"。不要直接给完整答案，给出引导性的子问题拆分建议。只输出 JSON。',
      user: `问题：${problemTitle} — ${problemDescription}\n学生已有的分解：${context || '(还没开始)'}\n\n给出 2-3 个学生可能遗漏的子问题（每个 15 字内，是"要解决什么"而不是"怎么解决"）。\n输出：{"suggestions":["...","..."],"feedback":"一句引导语（30字内）"}`,
    },
    pattern_hint: {
      system: '你是计算思维教练。学生在找模式规律。用提问引导而非直接揭示。只输出 JSON。',
      user: `问题：${problemTitle} — ${problemDescription}\n学生的观察：${context || '(空)'}\n\n输出：{"feedback":"针对学生观察的点评+一个引导性问题（50字内），如果学生观察正确要确认并深化"}`,
    },
    algorithm_review: {
      system: '你是算法评审教练。检查学生的算法步骤是否完整、有无遗漏边界情况。只输出 JSON。',
      user: `问题：${problemTitle} — ${problemDescription}\n学生的算法步骤：\n${context || '(空)'}\n\n输出：{"feedback":"指出最重要的 1-2 个问题或确认正确（60字内）","suggestions":["遗漏的步骤或边界情况（如有，最多2条）"]}`,
    },
    code_feedback: {
      system: '你是编程教练。学生的代码运行出错或结果不对，给渐进式提示不给完整答案。只输出 JSON。',
      user: `问题：${problemTitle}\n学生代码与输出：\n${context || '(空)'}\n\n输出：{"feedback":"指出问题方向的提示（不超过 60 字，不要贴修正代码）"}`,
    },
    reflect_prompt: {
      system: '你是反思教练。根据学生的解题过程生成一个个性化的深度反思问题。只输出 JSON。',
      user: `问题：${problemTitle}\n学生解题摘要：${context || '(空)'}\n\n输出：{"feedback":"一个连接到更广泛情境的反思问题（40字内），例如这个方法还能用在哪/什么情况会失效"}`,
    },
  };

  const p = prompts[kind];
  const result = await callJson(cfg, p.system, p.user, 800, 'fast', chain.slice(1));
  if (!result) return res.json({ aiPowered: true, suggestions: [], feedback: 'AI 暂时开小差了，稍后再试。' });

  res.json({
    aiPowered: true,
    suggestions: Array.isArray(result.suggestions) ? (result.suggestions as string[]).slice(0, 3).map(s => String(s).slice(0, 100)) : [],
    feedback: String(result.feedback ?? '').slice(0, 300),
  });
});

// ── GET my-stats — real analysis data ──────────────────────────

router.get('/ct/:courseId/my-stats', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMember(courseId, req);

  const { data: problems } = await supabase
    .from('ct_problems').select('id').eq('course_id', courseId);
  const problemIds = (problems ?? []).map((p: any) => p.id);

  let solutions: any[] = [];
  if (problemIds.length > 0) {
    const { data } = await supabase
      .from('ct_solutions')
      .select('problem_id, status, step_status, published_note_id, updated_at')
      .eq('user_id', req.user!.id)
      .in('problem_id', problemIds);
    solutions = data ?? [];
  }

  const stepKeys = ['decomposition', 'pattern', 'abstraction', 'algorithm', 'code'];
  const stepCounts: Record<string, number> = {};
  for (const k of stepKeys) stepCounts[k] = 0;
  for (const s of solutions) {
    const st = (s.step_status ?? {}) as Record<string, boolean>;
    for (const k of stepKeys) if (st[k]) stepCounts[k]++;
  }

  res.json({
    stats: {
      attempted: solutions.length,
      completed: solutions.filter(s => s.status === 'completed').length,
      published: solutions.filter(s => s.published_note_id).length,
      totalProblems: problemIds.length,
      stepCounts,
      lastActive: solutions.length > 0 ? solutions.map(s => s.updated_at).sort().slice(-1)[0] : null,
    },
  });
});

export default router;
