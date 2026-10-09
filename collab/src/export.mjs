import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, ImageRun } from 'docx';

function runs(nodes = []) {
  return nodes.flatMap(node => {
    if (node.type === 'hardBreak') return [new TextRun({ break: 1 })];
    if (node.type === 'text') {
      const marks = new Set((node.marks ?? []).map(mark => mark.type));
      return [new TextRun({ text: node.text ?? '', bold: marks.has('bold'), italics: marks.has('italic'),
        strike: marks.has('strike'), underline: marks.has('underline') ? {} : undefined,
        font: 'Microsoft YaHei' })];
    }
    return runs(node.content);
  });
}
function blocks(nodes = [], level = 0, ordered = false) {
  return nodes.flatMap(node => {
    if (node.type === 'image') {
      // Never fetch arbitrary URLs during server-side export.
      const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(node.attrs?.src ?? '');
      if (!match || match[2].length > 1_400_000) return [new Paragraph('[图片未导出]')];
      return [new Paragraph({ children: [new ImageRun({ type: match[1] === 'jpeg' ? 'jpg' : 'png',
        data: Buffer.from(match[2], 'base64'), transformation: { width: 400, height: 260 } })] })];
    }
    if (node.type === 'table') return [new Table({ rows: (node.content ?? []).map(row => new TableRow({
      children: (row.content ?? []).map(cell => new TableCell({ children: blocks(cell.content) })),
    })) })];
    if (node.type === 'bulletList' || node.type === 'orderedList') return blocks(node.content, level + 1, node.type === 'orderedList');
    if (node.type === 'listItem') return blocks(node.content, level, ordered);
    if (node.type === 'paragraph' || node.type === 'heading') return [new Paragraph({
      children: runs(node.content),
      heading: node.type === 'heading' ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Math.min(3, node.attrs?.level ?? 1) - 1] : undefined,
      numbering: level && ordered ? { reference: 'ordered', level: Math.min(level - 1, 8) } : undefined,
      bullet: level && !ordered ? { level: Math.min(level - 1, 8) } : undefined,
    })];
    return blocks(node.content, level, ordered);
  });
}
export async function exportWord(row) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, row.state);
    const json = yDocToProsemirrorJSON(doc, 'default');
    return await Packer.toBuffer(new Document({
      title: row.title,
      numbering: { config: [{ reference: 'ordered', levels: Array.from({ length: 9 }, (_, level) => ({
        level, format: 'decimal', text: `%${level + 1}.`, alignment: 'left',
      })) }] },
      sections: [{ children: blocks(json.content) }],
    }));
  } finally { doc.destroy(); }
}
