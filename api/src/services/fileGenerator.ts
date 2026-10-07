import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, Table, TableRow, TableCell, WidthType,
  BorderStyle, PageBreak, Footer, Header,
} from 'docx';
import type { ChartConfiguration, ChartItem, Plugin } from 'chart.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FILES_DIR = path.join(process.cwd(), 'generated_files');
const FILE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

const BRAND_NAVY = '#000080';
const BRAND_NAVY_LIGHT = '#3457D5';

// ---------------------------------------------------------------------------
// Cleanup stale files (runs on import, then every 30 min)
// ---------------------------------------------------------------------------

function cleanupStaleFiles() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(FILES_DIR)) {
      const fp = path.join(FILES_DIR, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > FILE_TTL_MS) fs.unlinkSync(fp);
    }
  } catch { /* ignore */ }
}
cleanupStaleFiles();
setInterval(cleanupStaleFiles, 30 * 60 * 1000);

function makeFileId(ext: string): { id: string; filePath: string } {
  const id = crypto.randomBytes(16).toString('hex');
  return { id, filePath: path.join(FILES_DIR, `${id}.${ext}`) };
}

// ---------------------------------------------------------------------------
// Word document generation
// ---------------------------------------------------------------------------

interface DocSection {
  heading: string;
  content: string;
  items?: string[];
}

interface DocOptions {
  title: string;
  subtitle?: string;
  sections: DocSection[];
  lang?: 'zh' | 'en';
}

export async function generateWordDoc(opts: DocOptions): Promise<{ fileId: string; fileName: string }> {
  const { id, filePath } = makeFileId('docx');
  const children: Paragraph[] = [];

  // Title page
  children.push(new Paragraph({ spacing: { before: 3000 } }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: opts.title, bold: true, size: 52, color: BRAND_NAVY, font: 'Microsoft YaHei' })],
  }));
  if (opts.subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
      children: [new TextRun({ text: opts.subtitle, size: 24, color: '666666', font: 'Microsoft YaHei' })],
    }));
  }
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400 },
    children: [new TextRun({ text: new Date().toLocaleDateString(opts.lang === 'zh' ? 'zh-CN' : 'en-US'), size: 20, color: '999999' })],
  }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Sections
  for (const section of opts.sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
      children: [new TextRun({ text: section.heading, bold: true, size: 28, color: BRAND_NAVY, font: 'Microsoft YaHei' })],
    }));

    if (section.content) {
      for (const para of section.content.split('\n').filter(Boolean)) {
        children.push(new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: para, size: 22, font: 'Microsoft YaHei' })],
        }));
      }
    }

    if (section.items && section.items.length > 0) {
      for (const item of section.items) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80 },
          children: [new TextRun({ text: item, size: 22, font: 'Microsoft YaHei' })],
        }));
      }
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 22 } },
      },
    },
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'HAKCC Knowledge Building', size: 16, color: 'AAAAAA', italics: true })],
          })],
        }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);

  const safeTitle = opts.title.replace(/[^\w一-鿿-]/g, '_').slice(0, 40);
  return { fileId: id, fileName: `${safeTitle}.docx` };
}

// ---------------------------------------------------------------------------
// Table-based Word document (for engagement reports)
// ---------------------------------------------------------------------------

interface TableDocOptions {
  title: string;
  subtitle?: string;
  summary: string;
  headers: string[];
  rows: string[][];
  insights?: string[];
  lang?: 'zh' | 'en';
}

export async function generateTableDoc(opts: TableDocOptions): Promise<{ fileId: string; fileName: string }> {
  const { id, filePath } = makeFileId('docx');
  const children: Paragraph[] = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1600, after: 400 },
    children: [new TextRun({ text: opts.title, bold: true, size: 48, color: BRAND_NAVY, font: 'Microsoft YaHei' })],
  }));
  if (opts.subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [new TextRun({ text: opts.subtitle, size: 22, color: '666666', font: 'Microsoft YaHei' })],
    }));
  }

  children.push(new Paragraph({
    spacing: { before: 200, after: 200 },
    children: [new TextRun({ text: opts.summary, size: 22, font: 'Microsoft YaHei' })],
  }));

  // Table
  const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
  const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

  const headerRow = new TableRow({
    tableHeader: true,
    children: opts.headers.map(h => new TableCell({
      borders,
      shading: { fill: BRAND_NAVY, color: 'FFFFFF' },
      width: { size: Math.floor(9000 / opts.headers.length), type: WidthType.DXA },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: h, bold: true, size: 20, color: 'FFFFFF', font: 'Microsoft YaHei' })],
      })],
    })),
  });

  const dataRows = opts.rows.map((row, ri) => new TableRow({
    children: row.map(cell => new TableCell({
      borders,
      shading: ri % 2 === 0 ? { fill: 'F8F9FA' } : undefined,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: cell, size: 20, font: 'Microsoft YaHei' })],
      })],
    })),
  }));

  children.push(new Paragraph({ spacing: { before: 200 } }));
  children.push(new Paragraph({ children: [] })); // spacer before table

  const table = new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows: [headerRow, ...dataRows],
  });

  // Insights
  if (opts.insights && opts.insights.length > 0) {
    children.push(new Paragraph({ spacing: { before: 400 } }));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: opts.lang === 'zh' ? '分析洞察' : 'Insights', bold: true, size: 26, color: BRAND_NAVY, font: 'Microsoft YaHei' })],
    }));
    for (const insight of opts.insights) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80 },
        children: [new TextRun({ text: insight, size: 22, font: 'Microsoft YaHei' })],
      }));
    }
  }

  const doc = new Document({
    sections: [{
      children: [...children.slice(0, 4), new Paragraph({ children: [] })],
    }, {
      children: [new Paragraph({ children: [] })],
    }],
  });

  // Rebuild with table — docx library needs tables at section level
  const docWithTable = new Document({
    sections: [{
      children: [...children, table, ...(opts.insights ?? []).length > 0 ? [] : []],
    }],
  });

  const buffer = await Packer.toBuffer(docWithTable);
  fs.writeFileSync(filePath, buffer);

  const safeTitle = opts.title.replace(/[^\w一-鿿-]/g, '_').slice(0, 40);
  return { fileId: id, fileName: `${safeTitle}.docx` };
}

// ---------------------------------------------------------------------------
// Chart generation
// ---------------------------------------------------------------------------

// 用 @napi-rs/canvas 画：预编译包作为普通 npm 依赖装上，不跑安装脚本。以前的 canvas 原生模块要靠安装脚本，
// deploy.sh 的 npm ci 带 --ignore-scripts，线上从没编出来过，图表一张都没画成。
// 中文字体名要写进字体列表，不能指望它自己找。服务器上的中文字体是 apt 装的 fonts-noto-cjk：
// 那是 TTC 字体集，@napi-rs/canvas 只认出第一个字面的名字 Noto Sans CJK JP，认不出 SC，两个都写上。
const CHART_FONT_FAMILY = "'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Hiragino Sans GB', 'Microsoft YaHei', 'DejaVu Sans', sans-serif";
const CHART_WIDTH = 800;
const CHART_HEIGHT = 500;

type ChartRenderer = {
  render: (config: ChartConfiguration) => Buffer;
  rendersChinese: boolean;
};

let rendererLoad: Promise<ChartRenderer | null> | null = null;

// 第一次画图时才加载：原生模块加载失败只让图表不可用，不能拖垮整个进程
function loadChartRenderer(): Promise<ChartRenderer | null> {
  rendererLoad ??= (async () => {
    try {
      const [{ createCanvas }, { Chart, registerables }] = await Promise.all([import('@napi-rs/canvas'), import('chart.js')]);
      Chart.register(...registerables);
      Chart.defaults.font.family = CHART_FONT_FAMILY;
      const whiteBackground: Plugin = {
        id: 'hakcc-white-background',
        beforeDraw: (chart) => {
          const { ctx, width, height } = chart;
          ctx.save();
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        },
      };

      // 缺字时每个字都画成同一个方块：两个不同的汉字画得一模一样，就是没有可用的中文字体
      const glyph = (ch: string) => {
        const canvas = createCanvas(40, 40);
        const ctx = canvas.getContext('2d');
        ctx.font = `28px ${CHART_FONT_FAMILY}`;
        ctx.fillText(ch, 4, 32);
        return Buffer.from(ctx.getImageData(0, 0, 40, 40).data);
      };
      const rendersChinese = !glyph('学').equals(glyph('生'));
      if (!rendersChinese) {
        console.warn('[fileGenerator] no Chinese font found, chart labels will show as boxes. On the server: apt install fonts-noto-cjk');
      }

      return {
        rendersChinese,
        render: (config) => {
          const canvas = createCanvas(CHART_WIDTH, CHART_HEIGHT);
          const chart = new Chart(canvas.getContext('2d') as unknown as ChartItem, {
            ...config,
            options: { ...config.options, responsive: false, animation: false },
            plugins: [...(config.plugins ?? []), whiteBackground],
          });
          try {
            return canvas.toBuffer('image/png');
          } finally {
            chart.destroy();
          }
        },
      };
    } catch (err) {
      console.warn(`[fileGenerator] chart rendering unavailable: ${(err as Error).message}`);
      return null;
    }
  })();
  return rendererLoad;
}

/** 这台机器画出来的图里，中文是真字还是方块。部署后可在服务器上直接调用核对 */
export async function chartsRenderChinese(): Promise<boolean> {
  return (await loadChartRenderer())?.rendersChinese ?? false;
}

export async function generateChart(
  config: ChartConfiguration,
  fileName?: string,
): Promise<{ fileId: string; fileName: string }> {
  const renderer = await loadChartRenderer();
  if (!renderer) throw new Error('Chart generation not available — @napi-rs/canvas could not be loaded');
  const { id, filePath } = makeFileId('png');
  fs.writeFileSync(filePath, renderer.render(config));

  const safeName = (fileName ?? 'chart').replace(/[^\w一-鿿-]/g, '_').slice(0, 40);
  return { fileId: id, fileName: `${safeName}.png` };
}

// Pre-built chart configs

export function engagementBarChartConfig(
  labels: string[], values: number[], lang: 'zh' | 'en' = 'zh',
): ChartConfiguration {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: lang === 'zh' ? '笔记数量' : 'Note Count',
        data: values,
        backgroundColor: values.map((_, i) => i % 2 === 0 ? BRAND_NAVY : BRAND_NAVY_LIGHT),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: lang === 'zh' ? '学生参与度分析' : 'Student Engagement Analysis', font: { size: 18 } },
        legend: { display: false },
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: lang === 'zh' ? '笔记数' : 'Notes' } },
        x: { title: { display: true, text: lang === 'zh' ? '学生' : 'Student' } },
      },
    },
  };
}

export function timelineChartConfig(
  labels: string[], values: number[], lang: 'zh' | 'en' = 'zh',
): ChartConfiguration {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: lang === 'zh' ? '笔记数量' : 'Note Count',
        data: values,
        borderColor: BRAND_NAVY,
        backgroundColor: `${BRAND_NAVY}22`,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: BRAND_NAVY,
        pointRadius: 4,
      }],
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: lang === 'zh' ? '活动趋势' : 'Activity Trend', font: { size: 18 } },
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: lang === 'zh' ? '笔记数' : 'Notes' } },
        x: { title: { display: true, text: lang === 'zh' ? '时间' : 'Time' } },
      },
    },
  };
}

export function comparisonBarChartConfig(
  labels: string[], period1: number[], period2: number[],
  period1Label: string, period2Label: string, lang: 'zh' | 'en' = 'zh',
): ChartConfiguration {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: period1Label, data: period1, backgroundColor: BRAND_NAVY, borderRadius: 4 },
        { label: period2Label, data: period2, backgroundColor: BRAND_NAVY_LIGHT, borderRadius: 4 },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: lang === 'zh' ? '时期对比分析' : 'Period Comparison', font: { size: 18 } },
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: lang === 'zh' ? '笔记数' : 'Notes' } },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// File retrieval
// ---------------------------------------------------------------------------

export function getFilePath(fileId: string): string | null {
  const safe = fileId.replace(/[^a-f0-9]/g, '');
  for (const ext of ['docx', 'png', 'pdf']) {
    const fp = path.join(FILES_DIR, `${safe}.${ext}`);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

export function getFileMime(filePath: string): string {
  if (filePath.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}
