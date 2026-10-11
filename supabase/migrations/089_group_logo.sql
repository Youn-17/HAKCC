-- 小组 logo（2026-10-11 用户：各组设计了自己的 logo，教师在小组管理里给他们放进去，小组的视图卡片上显示）。
-- 存公开存储桶 note-chat-attachments 里 group-logos/ 下的地址；前端上传前已缩到 512 像素以内的 PNG。
alter table public.groups add column if not exists logo_url text;
