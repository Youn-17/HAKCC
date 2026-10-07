import fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  chartsRenderChinese, comparisonBarChartConfig, engagementBarChartConfig, generateChart, getFilePath, timelineChartConfig,
} from './fileGenerator';

/**
 * 图表以前靠 chartjs-node-canvas + canvas 原生模块；deploy.sh 的 npm ci 带 --ignore-scripts，
 * 原生模块在线上从没编出来，generateChart 次次抛错。现在用 @napi-rs/canvas（预编译、不跑安装脚本）。
 * 这里真的画：三种图都要出 PNG、柱子和线真画上了、背景是白的，中文不能是方块。
 */

const made: string[] = [];
afterEach(() => {
  for (const fileId of made.splice(0)) {
    const fp = getFilePath(fileId);
    if (fp) fs.unlinkSync(fp);
  }
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function decode(png: Buffer) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(png);
  const ctx = createCanvas(img.width, img.height).getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

describe('generateChart 真的画出 PNG', () => {
  it.each([
    ['参与度柱状图', engagementBarChartConfig(['S1', 'S2', 'S3'], [5, 3, 1], 'zh'), '参与度分析'],
    ['活动趋势折线图', timelineChartConfig(['2026-10-01', '2026-10-02', '2026-10-03'], [2, 4, 3], 'zh'), '活动趋势'],
    ['时期对比图', comparisonBarChartConfig(['笔记数', '参与人数'], [4, 2], [6, 3], '14-7天前', '最近7天', 'zh'), '时期对比'],
  ])('%s', async (_name, config, fileName) => {
    const result = await generateChart(config, fileName);
    made.push(result.fileId);

    expect(result.fileName).toBe(`${fileName}.png`);
    expect(result).not.toHaveProperty('base64');
    const png = fs.readFileSync(getFilePath(result.fileId)!);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

    const { width, height, data } = await decode(png);
    expect([width, height]).toEqual([800, 500]);
    // 开着动画时第一帧的柱子高度是 0：数一数藏青色（#000080）的像素，确认数据真画上了
    let navy = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 30 && data[i + 1] < 30 && data[i + 2] > 100 && data[i + 2] < 160) navy++;
    }
    expect(navy).toBeGreaterThan(500);
    // 聊天界面有深色模式，透明底会让黑字看不见
    expect([...data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it('中文是真字，不是方块（服务器上靠 fonts-noto-cjk）', async () => {
    expect(await chartsRenderChinese()).toBe(true);
  });
});
