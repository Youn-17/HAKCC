// api/src/config/supabase.ts 在模块加载时就 throw，导致任何 import 了它的单测
// （agentTools 等）连测试体都跑不到。这里只补占位值，真实环境变量优先。
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

// 测试不能打到真的 Jev：本机 api/.env 里有 key，在 api/ 目录下跑测试时 dotenv 会把它读进来。
// 先占成空串，dotenv 默认不覆盖已有的变量。要测 Jev 开着的路径，在测试里 mock config/jev。
process.env.JEV_API_KEY = '';

// 课程知识库的向量用平台的 OpenRouter key，DMX 连接保温用平台的 DMX key，同样不能让测试打到真的接口。
// 要测配了 key 的路径，在测试里自己设、用完还原
process.env.KB_OPENROUTER_API_KEY = '';
process.env.KB_DMX_API_KEY = '';
