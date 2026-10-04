#!/usr/bin/env python3
"""把一段录屏按时间均匀抽 9 帧拼成一张图，检查镜头和内容用。"""
import subprocess, sys, tempfile, os
from PIL import Image
video, out = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 9
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).strip())
tmp = tempfile.mkdtemp()
ims = []
for i in range(n):
    t = dur * (i + 0.5) / n
    f = os.path.join(tmp, f'{i}.jpg')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', f'{t:.2f}', '-i', video, '-frames:v', '1', '-q:v', '3', f], check=True)
    ims.append(Image.open(f).resize((640, 400)))
cols = 3
sheet = Image.new('RGB', (640 * cols, 400 * ((n + cols - 1) // cols)), 'white')
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * 640, (i // cols) * 400))
sheet.save(out, quality=82)
print(f'{os.path.basename(video)} {dur:.1f}s')
