# 使用手册截图与录屏

`public/manual/` 下的截图和录屏由这里的脚本生成。界面改了以后重新跑一遍即可，不需要登录线上，也不会碰线上数据。

## 原理

- 把前端按 `VITE_API_URL=/api` 单独构建一份，由 `server.mjs` 在本地托管。
- 所有 `/api` 请求由 `mockApi.mjs`、`mockAi.mjs`、`mockMore.mjs`、`mockTeacher.mjs` 回答。演示课程的数据在 `world.mjs`，AI 的回复和反馈文本在 `scripts.mjs`，支架库是线上全局支架的快照 `scaffolds.json`。
- AI 回复按真实节奏逐段流式写出，所以录下来和实际使用时一样有「思考中」和逐字输出。
- 浏览器里对 127.0.0.1 以外的请求和所有 WebSocket 一律拦截。
- `record.mjs` 用 CDP 按 2 倍像素抓帧，场景脚本在关键时刻记「镜头」关键帧；`render.py` 按帧时间戳重建 30fps 时间轴，镜头在关键帧之间缓动推拉，输出 1280×800 的 mp4、webm 和海报图。

## 运行

```bash
# 1. 构建录制用的前端
VITE_API_URL=/api npx vite build --outDir /tmp/hakcc-capture-dist --emptyOutDir

# 2. 起演示服务（另开一个终端）
CAPTURE_DIST=/tmp/hakcc-capture-dist node scripts/manual-capture/server.mjs

# 3. 录全部场景，或者只录几个
node scripts/manual-capture/capture.mjs
node scripts/manual-capture/capture.mjs c08-feedback ui-home
```

- 输出默认写进 `public/manual/`。先想看效果，设 `CAPTURE_OUT=<目录>` 输出到别处。
- `python3 scripts/manual-capture/sheet.py <视频> <输出.jpg>` 把一段录屏抽 9 帧拼成一张图，检查镜头用。
- 换了素材要把 `components/manual/ManualMedia.tsx` 里的 `ASSET_V` 加一，否则浏览器四小时内还用缓存里的旧图。
- 未实现的接口会记在 `/tmp/manual-capture-api.log`（MISS 开头），新页面录不出来时先看这里。

## 场景

场景定义在 `scenes.mjs`，按手册章节排。录屏场景用 `cam.focus()` 推镜头、`cam.wide()` 拉回全景、`cam.mark()` 标海报帧的时间点。依赖：`node_modules` 里的 playwright（含 Chromium）、ffmpeg、Python 3 与 Pillow。
