// api/src/config/supabase.ts 在模块加载时就 throw，导致任何 import 了它的单测
// （agentTools 等）连测试体都跑不到。这里只补占位值，真实环境变量优先。
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
