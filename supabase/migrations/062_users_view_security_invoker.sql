-- 062：public.users 视图按调用者身份检查，收回客户端写权限
--
-- 2026-09-28 复查发现：061 收回了 profiles 的写权限，但经 users 视图照样能改身份。
-- users 是 profiles 上的简单视图（可自动更新），属主 postgres，没有设 security_invoker，
-- authenticated 对它有 INSERT / UPDATE / DELETE。经视图访问时权限和 RLS 按属主判断，
-- postgres 是 profiles 的属主且有 BYPASSRLS，profiles 的 RLS 完全不起作用：
--   PATCH  /rest/v1/users?id=eq.<任何人>  {"role":"admin"}  任何登录用户能改任何人的 role / status
--   DELETE /rest/v1/users?id=eq.<任何人>                     删任何人的 profiles 行
--   GET    /rest/v1/users?select=email,role                  读全部账号的邮箱和身份
-- 以 authenticated 身份 EXPLAIN（不执行）核实过：UPDATE public.users 通过权限检查，计划里没有
-- RLS 过滤；同样的 UPDATE public.profiles 报 42501。安全顾问对这个视图报 security_definer_view（ERROR）。
-- 日志保留的约 20 小时内没有带用户 token 的 /rest/v1 请求；更早的查不到。
--
-- API 经 service_role 读这个视图（users!author_id(...) 联表）。service_role 对 profiles 有 SELECT
-- 且 BYPASSRLS，改成 security_invoker 后照常。前端不直连这个视图。
-- 改完后 authenticated 经视图读 profiles，受「profiles: read」约束，和直接读表一样。

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.users FROM anon, authenticated;
ALTER VIEW public.users SET (security_invoker = true);

-- 执行后核对：
-- SELECT reloptions FROM pg_class WHERE oid = 'public.users'::regclass;           -- {security_invoker=true}
-- SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND table_name = 'users' AND grantee IN ('anon', 'authenticated')
-- GROUP BY grantee;                                                                -- authenticated 只剩 SELECT
