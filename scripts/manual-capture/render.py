#!/usr/bin/env python3
"""
把录下来的帧渲染成手册用的视频。

输入：record.mjs 写出的 timeline.json（每帧的浏览器时间戳 + 镜头关键帧）和 frames/*.jpg（2 倍像素）。
输出：<stem>.mp4（H.264，Safari 用）、<stem>.webm（VP9）、<stem>.jpg（海报帧）。

时间轴按帧自带的时间戳重建再重采样到 30fps。直接按固定间隔拼帧，页面卡顿的地方
在成片里就变成快进，看着很假。镜头在关键帧之间做缓入缓出。
"""
import argparse
import bisect
import json
import os
import subprocess
import sys

from PIL import Image


def ease(t):
    t = max(0.0, min(1.0, t))
    return 4 * t * t * t if t < 0.5 else 1 - pow(-2 * t + 2, 3) / 2


def lerp_rect(a, b, k):
    return {key: a[key] + (b[key] - a[key]) * k for key in ('x', 'y', 'w', 'h')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('work')
    ap.add_argument('stem')
    ap.add_argument('--fps', type=float, default=30)
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=800)
    ap.add_argument('--poster', default='end')
    ap.add_argument('--trim-start', type=float, default=0)
    ap.add_argument('--speed', type=float, default=1)
    args = ap.parse_args()

    meta = json.load(open(os.path.join(args.work, 'timeline.json')))
    frames = meta['frames']
    if not frames:
        sys.exit('no frames recorded')
    times = [f['t'] for f in frames]
    vp = meta['viewport']
    first = Image.open(frames[0]['file'])
    scale = first.width / vp['width']

    cams = meta['camera']
    starts = []
    for i, c in enumerate(cams):
        if i == 0:
            starts.append(c['rect'])
            continue
        prev, prev_start = cams[i - 1], starts[i - 1]
        k = 1.0 if prev['dur'] <= 0 else ease((c['t'] - prev['t']) / prev['dur'])
        starts.append(lerp_rect(prev_start, prev['rect'], k))
    cam_times = [c['t'] for c in cams]

    def camera_at(t):
        i = max(0, bisect.bisect_right(cam_times, t) - 1)
        c = cams[i]
        k = 1.0 if c['dur'] <= 0 else ease((t - c['t']) / c['dur'])
        return lerp_rect(starts[i], c['rect'], k)

    t_start = max(times[0], meta['t0']) + args.trim_start
    t_end = meta['tEnd']
    n_out = int((t_end - t_start) / args.speed * args.fps)

    if args.poster == 'end':
        poster_t = t_end - 0.05
    elif args.poster.startswith('mark:'):
        poster_t = meta['marks'][args.poster[5:]]
    else:
        poster_t = t_start + float(args.poster)

    mp4 = args.stem + '.mp4'
    enc = subprocess.Popen([
        'ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
        '-s', f'{args.width}x{args.height}', '-r', str(args.fps), '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-tune', 'animation', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', mp4,
    ], stdin=subprocess.PIPE)

    cache = {}
    poster_img = None
    for i in range(n_out):
        t = t_start + i / args.fps * args.speed
        j = max(0, bisect.bisect_right(times, t) - 1)
        src = frames[j]['file']
        if src not in cache:
            cache.clear()
            cache[src] = Image.open(src).convert('RGB')
        img = cache[src]
        r = camera_at(t)
        box = (round(r['x'] * scale), round(r['y'] * scale), round((r['x'] + r['w']) * scale), round((r['y'] + r['h']) * scale))
        out = img.crop(box).resize((args.width, args.height), Image.LANCZOS)
        enc.stdin.write(out.tobytes())
        if poster_img is None and t >= poster_t:
            poster_img = out.copy()
    if poster_img is None:
        poster_img = out.copy()
    enc.stdin.close()
    if enc.wait() != 0:
        sys.exit('ffmpeg mp4 failed')

    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error', '-i', mp4, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38',
        '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', args.stem + '.webm',
    ], check=True)
    poster_img.save(args.stem + '.jpg', quality=88, optimize=True, progressive=True)
    sizes = {ext: os.path.getsize(args.stem + ext) // 1024 for ext in ('.mp4', '.webm', '.jpg')}
    print(f'  rendered {os.path.basename(args.stem)}: {n_out / args.fps:.1f}s  mp4 {sizes[".mp4"]}K  webm {sizes[".webm"]}K  jpg {sizes[".jpg"]}K')


if __name__ == '__main__':
    main()
