/**
 * 文档阅读页。原来是一个 max-w-7xl 的弹窗，压在半透明蒙层上读几千字的材料 ——
 * 阅读是要停留很久的事，弹窗撑不住。现在是满屏页面，三栏：左目录、中正文、右侧栏。
 *
 * Markdown 与 Word 走**同一条路径**：Word 由服务端 mammoth 转成 HTML（结果缓存），
 * 之后的目录、选中、批注、引用全部共用。原 .docx 始终可下载。
 * 这也顺带把 .docx 预览从微软的在线查看器上摘了下来 —— 那条路会把学生作业
 * 的地址交给 view.officeapps.live.com 去渲染。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Download, X, FileText, Pencil, Check, Loader2, Sparkles, MessageSquare } from 'lucide-react';
import DocAnnotationPanel from './DocAnnotationPanel';
import DocAiPanel from './DocAiPanel';
import SpreadsheetView from './SpreadsheetView';
import {
  loadWorkbook, spreadsheetErrorMessage, spreadsheetKind, SpreadsheetError, workbookToText,
  type SpreadsheetErrorCode, type WorkbookView,
} from './spreadsheet';
import UserAvatar from './UserAvatar';
import { MORANDI, chipStyle, ink } from './morandiPalette';
import { addHeadingIds, anchorFromSelection, findQuoteRange, scrollToAnchor, clearHighlight, type OutlineItem } from './docAnchor';
import { documents as docsApi, type DocAnnotation } from '../services/apiClient';
import type { Language } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  /** 附件笔记的 id。批注挂在它上面；没有 id 就只能读，不能批注。 */
  noteId?: string;
  currentUserId?: string;
  courseId?: string;
  /** 课程教职（按课内身份）：可以删别人的批注 */
  isStaff?: boolean;
  /** 能不能改正文：上传者本人和课程教职。.md 存新版本走 POST /notes/:id/markdown-versions，Word 走 PUT /notes/:id/document，后端都只放行这两类人 */
  canEdit?: boolean;
  /** 从 AI 回答的来源卡片打开时跳到第几页（PDF 用浏览器自带阅读器的 #page=） */
  initialPage?: number | null;
  lang: Language;
  onConvertToNote?: (payload: { title: string; html: string; fileName: string }) => Promise<void> | void;
  onSaveMarkdown?: (payload: { text: string; fileName: string }) => Promise<void> | void;
  onAskAi?: () => Promise<void> | void;
  onQuoteToNote?: (payload: { quote: string; fileName: string }) => Promise<void> | void;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const FileViewerPage: React.FC<Props> = ({
  isOpen, onClose, fileUrl, fileName, mimeType, noteId, currentUserId, courseId, isStaff = false, canEdit = false, initialPage, lang,
  onConvertToNote, onSaveMarkdown, onAskAi, onQuoteToNote,
}) => {
  const zh = lang === 'zh';
  const [content, setContent] = useState<string | null>(null);
  /** 表格附件（Excel、CSV）在浏览器里解析的结果，见 spreadsheet.ts */
  const [book, setBook] = useState<WorkbookView | null>(null);
  const [bookError, setBookError] = useState<SpreadsheetErrorCode | null>(null);
  /**
   * Word 转成 Markdown 之后就和 .md 完全一样：可编辑、有目录、能批注。
   * 保存写在平台呈现层，不回写 .docx —— 往返会丢格式且容易损坏原件，
   * 而原件是学生交上来的东西，下载拿到的永远是他最初那一份。
   */
  const [wordMarkdown, setWordMarkdown] = useState<string | null>(null);
  const [wordError, setWordError] = useState<string | null>(null);

  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [askingAi, setAskingAi] = useState(false);
  /**
   * 选中时**当场**把锚点算好存下来，而不是等点按钮时再读 window.getSelection()。
   * 浏览器选区是易失的：任何一次重渲染、点一下别处、甚至输入法都可能清掉它，
   * 实测 React 提交之后它就没了 —— 点「批注」拿到的是空选区，什么也不会发生。
   */
  const [selection, setSelection] = useState<
    { text: string; top: number; left: number; headingId: string | null } | null
  >(null);
  const [quoting, setQuoting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // 批注
  const [sidebar, setSidebar] = useState<'none' | 'comments' | 'ai'>('none');

  /**
   * 侧栏宽度可拖。320 对一段带引文和列表的 AI 回答太窄，每行只放得下十几个字，
   * 读起来像在看手机。记在 localStorage 里 —— 调过一次就不该再调第二次。
   */
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('hakcc-doc-sidebar-width'));
    return Number.isFinite(stored) && stored >= 320 ? Math.min(stored, 720) : 400;
  });
  const resizingRef = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      // 从右边缘往左量：往左拖变宽，符合直觉
      const next = Math.min(720, Math.max(320, window.innerWidth - e.clientX));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('hakcc-doc-sidebar-width', String(sidebarWidth)); } catch { /* 隐私模式 */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [sidebarWidth]);

  const startResize = () => {
    resizingRef.current = true;
    // 拖动时锁住光标和选区，否则会一路选中正文
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const ResizeHandle = () => (
    <div
      onMouseDown={startResize}
      role="separator"
      aria-orientation="vertical"
      aria-label={zh ? '调整侧栏宽度' : 'Resize sidebar'}
      className="group absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize"
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-[#000080]/30" />
    </div>
  );
  const [annotations, setAnnotations] = useState<DocAnnotation[]>([]);
  const [annLoading, setAnnLoading] = useState(false);
  const [composer, setComposer] = useState<{ quote: string; headingId: string | null; top: number } | null>(null);
  const [composerDraft, setComposerDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const isMarkdown = mimeType === 'text/markdown'
    || mimeType === 'text/x-markdown'
    || /\.(md|markdown)$/i.test(fileName);
  const isWord = mimeType === DOCX_MIME || /\.docx$/i.test(fileName);
  /** 有目录、能选中、能批注的「富文档」。PDF 暂不在内：行内锚定要 pdf.js 文本层。 */
  const isRich = isMarkdown || isWord;
  const isRichSource = isRich;
  const sheetKind = spreadsheetKind(mimeType, fileName);

  useEffect(() => {
    if (!isOpen || !fileUrl) return;
    setContent(null);
    setBook(null);
    setBookError(null);
    setWordMarkdown(null);
    setWordError(null);
    setEditing(false);
    setSaveError(null);
    setConvertError(null);

    if (sheetKind) {
      // 原来的 CSV 是按换行和逗号硬切：引号里的逗号、换行和 GBK 编码都会读错
      let cancelled = false;
      fetch(fileUrl)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then(data => loadWorkbook(data, sheetKind))
        .then(result => { if (!cancelled) setBook(result); })
        .catch(err => {
          if (cancelled) return;
          console.warn('Failed to open spreadsheet', err);
          setBookError(err instanceof SpreadsheetError ? err.code : 'unreadable');
        });
      return () => { cancelled = true; };
    }

    if (isMarkdown || mimeType === 'text/plain') {
      fetch(fileUrl)
        .then(res => res.text())
        .then(text => setContent(text))
        .catch(err => console.error('Failed to load text file', err));
    }
  }, [isOpen, fileUrl, mimeType, fileName, isMarkdown, sheetKind]);

  // Word：服务端转换，结果有缓存，第二次打开直接命中
  useEffect(() => {
    if (!isOpen || !isWord || !noteId) return;
    let cancelled = false;
    docsApi.wordMarkdown(noteId)
      .then(({ markdown }) => { if (!cancelled) setWordMarkdown(markdown); })
      .catch(err => { if (!cancelled) setWordError(err instanceof Error ? err.message : '无法打开这份文档'); });
    return () => { cancelled = true; };
  }, [isOpen, isWord, noteId]);

  const previewSource = editing ? draft : (isWord ? wordMarkdown : content);

  /**
   * 渲染 + 抽目录。id 是消毒**之后**才加的：危险内容由 DOMPurify 剔除，
   * 锚点是我们自己生成的，不来自文件。
   */
  const { docHtml, outline } = useMemo(() => {
    if (!isRichSource || previewSource === null) return { docHtml: null, outline: [] as OutlineItem[] };
    const clean = DOMPurify.sanitize(
      marked.parse(previewSource, { async: false, gfm: true, breaks: true }) as string,
      { ADD_ATTR: ['target', 'rel'] },
    );
    const { html, outline: items } = addHeadingIds(clean);
    return { docHtml: html, outline: items };
  }, [isRichSource, previewSource]);

  // 批注：进页面取一次，不订阅实时——文档批注不是即时聊天，切走再回来会重取
  useEffect(() => {
    if (!isOpen || !noteId || !isRich) return;
    let cancelled = false;
    setAnnLoading(true);
    docsApi.listAnnotations(noteId)
      .then(({ annotations: rows }) => { if (!cancelled) setAnnotations(rows); })
      .catch(() => { if (!cancelled) setAnnotations([]); })
      .finally(() => { if (!cancelled) setAnnLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, noteId, isRich]);

  useEffect(() => () => clearHighlight(), []);

  /**
   * 给 AI 侧栏用的正文。能在前端拿到的就地取（md 已经下载过，Word 的 HTML 剥标签），
   * 拿不到的（PDF）才走服务端抽取 —— 那一步要下载并解析文件，不该每开一份文档就跑。
   */
  // undefined = 还在取；'' = 取到了但没有文字（扫描版 PDF）；字符串 = 就绪。
  // 这三种必须分开：混成一个「空」会让 AI 在正文还没到手时就回答「文档无法读取」，
  // 学生看到的是一句错误的结论 —— 线上就这么发生过。
  const [docText, setDocText] = useState<string | undefined>(undefined);
  const [docTextSource, setDocTextSource] = useState<string | null>(null);
  const [docTextProgress, setDocTextProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    if (isMarkdown) { setDocText(content ?? undefined); return; }
    if (isWord) { setDocText(wordMarkdown ?? undefined); return; }
    // 表格在前端已经解析好了；读不出来就是「没有文字」，AI 那边会如实说
    if (sheetKind) { setDocText(book ? workbookToText(book, zh) : (bookError ? '' : undefined)); return; }
    if (content !== null) { setDocText(content); return; }   // txt
    if (sidebar !== 'ai' || !noteId) return;                  // 按需，别一打开文档就解析

    // PDF 走服务端：本地 pdf-parse 先给一份能用的文字，MinerU 在后台把它升级成
    // 结构化 Markdown。pending 期间隔几秒再取一次，学生不必等着才能提第一个问题。
    let cancelled = false;
    let timer: number | undefined;
    setDocText(undefined);

    const pull = () => {
      docsApi.text(noteId)
        .then(r => {
          if (cancelled) return;
          setDocText(r.text ?? '');
          setDocTextSource(r.source);
          setDocTextProgress(r.pending ? (r.progress ?? null) : null);
          if (r.pending) timer = window.setTimeout(pull, 5000);
        })
        .catch(() => { if (!cancelled) { setDocText(''); setDocTextSource('none'); } });
    };
    pull();

    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [isOpen, isMarkdown, isWord, content, wordMarkdown, sidebar, noteId, sheetKind, book, bookError, zh]);

  /**
   * 引文在当前正文里找不到 = 文档被改过，界面要说出来而不是装作还对得上。
   *
   * 必须在**渲染之后**算：useMemo 在渲染期间执行，那时新的 HTML 还没提交到 DOM，
   * 搜的是上一轮（甚至是空的）容器，结果每条批注都被判成失配。
   */
  const [staleIds, setStaleIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const box = previewRef.current;
    if (!box || !docHtml) { setStaleIds(new Set()); return; }
    const stale = new Set<string>();
    for (const a of annotations) {
      if (!a.quote) continue;
      if (!findQuoteRange(box, a.quote)) stale.add(a.id);
    }
    setStaleIds(prev => {
      if (prev.size === stale.size && [...stale].every(id => prev.has(id))) return prev;
      return stale;
    });
  }, [annotations, docHtml]);

  const closeSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  /** 在正文里选中一段就浮出操作按钮。编辑态下不打扰。 */
  const handlePreviewSelection = () => {
    if (editing) return;
    const sel = window.getSelection();
    const container = previewRef.current;
    if (!sel || sel.rangeCount === 0 || !container) { setSelection(null); return; }
    if (!container.contains(sel.anchorNode)) { setSelection(null); return; }

    const picked = anchorFromSelection(container);
    if (!picked) { setSelection(null); return; }

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const box = container.getBoundingClientRect();
    setSelection({
      text: picked.quote,
      headingId: picked.anchor.headingId,
      top: rect.top - box.top + container.scrollTop - 8,
      left: rect.left - box.left + rect.width / 2,
    });
  };

  const handleQuote = async () => {
    if (!onQuoteToNote || !selection || quoting) return;
    setQuoting(true);
    try {
      await onQuoteToNote({ quote: selection.text, fileName });
      closeSelection();
      onClose();
    } finally {
      setQuoting(false);
    }
  };

  const startAnnotation = () => {
    if (!selection) return;
    setComposer({ quote: selection.text, headingId: selection.headingId, top: selection.top });
    setComposerDraft('');
    setSidebar('comments');
    setSelection(null);
  };

  const submitAnnotation = async () => {
    if (!noteId || !composer || posting) return;
    const body = composerDraft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const { annotation } = await docsApi.addAnnotation(noteId, {
        body,
        quote: composer.quote,
        anchor: { kind: 'text', headingId: composer.headingId, quote: composer.quote },
      });
      setAnnotations(prev => [...prev, annotation]);
      setComposer(null);
      setComposerDraft('');
      window.getSelection()?.removeAllRanges();
    } finally {
      setPosting(false);
    }
  };

  const handleReply = useCallback(async (parentId: string, body: string) => {
    if (!noteId) return;
    const { annotation } = await docsApi.addAnnotation(noteId, { body, parent_id: parentId });
    setAnnotations(prev => [...prev, annotation]);
  }, [noteId]);

  const handleToggleResolved = useCallback(async (target: DocAnnotation) => {
    const next = !target.resolved;
    setAnnotations(prev => prev.map(a => (a.id === target.id ? { ...a, resolved: next } : a)));
    try {
      await docsApi.updateAnnotation(target.id, { resolved: next });
    } catch {
      setAnnotations(prev => prev.map(a => (a.id === target.id ? { ...a, resolved: target.resolved } : a)));
    }
  }, []);

  const handleDeleteAnnotation = useCallback(async (target: DocAnnotation) => {
    const before = annotations;
    setAnnotations(prev => prev.filter(a => a.id !== target.id && a.parentId !== target.id));
    try {
      await docsApi.removeAnnotation(target.id);
    } catch {
      setAnnotations(before);
    }
  }, [annotations]);

  const handleJump = useCallback((target: DocAnnotation) => {
    const box = previewRef.current;
    if (!box) return;
    const anchor = target.anchor as { headingId?: string | null; quote?: string };
    scrollToAnchor(box, { headingId: anchor?.headingId ?? null, quote: target.quote ?? anchor?.quote });
  }, []);

  const scrollToHeading = (id: string) => {
    const box = previewRef.current;
    if (box) scrollToAnchor(box, { headingId: id });
  };

  const handleConvert = async () => {
    if (!onConvertToNote || docHtml === null || converting) return;
    setConverting(true);
    setConvertError(null);
    try {
      const doc = new DOMParser().parseFromString(docHtml, 'text/html');
      const h1 = doc.querySelector('h1');
      const title = (h1?.textContent ?? '').trim() || fileName.replace(/\.(md|markdown|docx)$/i, '');
      if (h1 && h1.textContent?.trim() === title) h1.remove();
      const safeName = fileName.replace(/"/g, '&quot;');
      // data-imported-from：这些字不是学生写的。后端 segmentNoteContent 靠它
      // 单列成 imported，否则三千字的材料会被算进 studentChars，研究数据就假了。
      await onConvertToNote({ title, html: `<div data-imported-from="${safeName}">${doc.body.innerHTML}</div>`, fileName });
      onClose();
    } catch (error) {
      setConvertError(error instanceof Error ? error.message : '转换失败');
    } finally {
      setConverting(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (isWord) {
        // Word 保存到平台呈现层，原 .docx 不动
        if (!noteId) throw new Error('缺少笔记标识');
        await docsApi.saveWordMarkdown(noteId, draft);
        setWordMarkdown(draft);
      } else {
        if (!onSaveMarkdown) throw new Error('这份文档不支持保存');
        await onSaveMarkdown({ text: draft, fileName });
        setContent(draft);
      }
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const openCount = annotations.filter(a => !a.parentId && !a.resolved).length;

  // ── 正文 ──────────────────────────────────────────────────────────────────
  /**
   * 元素引用按 docHtml 记忆化。不这么做的话，每一次选中文字（selection 状态变化）
   * 都会让 React 重新写一遍 innerHTML：整篇文档的节点全部重建 —— 长文档上是白白
   * 再解析一次，而且会把用户刚做出的选区一起抹掉。
   */
  const richBody = useMemo(() => (
    docHtml === null ? null : (
      <div
        className="md-preview mx-auto max-w-[70ch] px-8 py-8 text-[0.9375rem] leading-relaxed text-zinc-800 dark:text-gray-200"
        dangerouslySetInnerHTML={{ __html: docHtml }}
      />
    )
  ), [docHtml]);

  const renderBody = () => {
    if (isRich) {
      if (wordError) {
        return (
          <div className="mx-auto mt-20 max-w-md rounded-xl border px-4 py-5 text-center text-sm" style={chipStyle(MORANDI.ochre)}>
            <p>{wordError}</p>
            <a href={fileUrl} download={fileName} className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold underline">
              <Download size={14} /> {zh ? '下载原文件' : 'Download the original'}
            </a>
          </div>
        );
      }
      if (richBody === null) {
        return <div className="p-16 text-center text-sm text-zinc-400">{zh ? '正在载入…' : 'Loading…'}</div>;
      }
      return richBody;
    }

    if (sheetKind) {
      if (bookError) {
        return (
          <div className="mx-auto mt-20 max-w-md rounded-xl border px-4 py-5 text-center text-sm" style={chipStyle(MORANDI.ochre)}>
            <p>{spreadsheetErrorMessage(bookError, zh)}</p>
            <a href={fileUrl} download={fileName} className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold underline">
              <Download size={14} /> {zh ? '下载原文件' : 'Download the original'}
            </a>
          </div>
        );
      }
      if (!book) {
        return <div className="p-16 text-center text-sm text-zinc-400">{zh ? '正在载入…' : 'Loading…'}</div>;
      }
      return <SpreadsheetView book={book} lang={lang} />;
    }

    if (mimeType.startsWith('image/')) {
      return <div className="flex h-full items-center justify-center p-6"><img src={fileUrl} alt={fileName} className="max-h-full max-w-full rounded object-contain" /></div>;
    }
    if (mimeType.startsWith('video/')) {
      return <div className="flex h-full items-center justify-center p-6"><video src={fileUrl} controls className="max-h-full max-w-full rounded" /></div>;
    }
    if (mimeType === 'application/pdf') {
      return <iframe key={initialPage ?? 0} src={initialPage ? `${fileUrl}#page=${initialPage}` : fileUrl} className="h-full w-full border-0" title="PDF" />;
    }
    if (content) {
      return <pre className="h-full overflow-auto whitespace-pre-wrap p-6 font-mono text-sm">{content}</pre>;
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
        <FileText size={44} className="text-zinc-300" />
        <p className="text-sm">{zh ? '这个格式无法在线预览' : 'No preview for this format'}</p>
        <a href={fileUrl} download={fileName} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          <Download size={15} /> {zh ? '下载原文件' : 'Download'}
        </a>
      </div>
    );
  };

  const headerButton = 'inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[0.75rem] font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';

  // 放在所有钩子之后：上面还有 useCallback / useMemo，提前 return 会让开和关两种状态的钩子数不一样（React #310）
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white font-sans dark:bg-gray-950">
      {/* 顶栏 */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-gray-800">
        <FileText size={16} className="shrink-0 text-zinc-400" />
        <span className="truncate text-[0.8125rem] font-semibold text-zinc-900 dark:text-gray-100">{fileName}</span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {isRich && !editing && canEdit && (isMarkdown ? !!onSaveMarkdown : !!noteId) && (
            <button
              className={headerButton}
              onClick={() => { setDraft((isWord ? wordMarkdown : content) ?? ''); setSaveError(null); setEditing(true); }}
            >
              <Pencil size={13} />{zh ? '编辑' : 'Edit'}
            </button>
          )}
          {editing && (
            <>
              <button className={headerButton} onClick={() => setEditing(false)}>{zh ? '取消' : 'Cancel'}</button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#000080] px-3 py-1.5 text-[0.75rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{zh ? '保存' : 'Save'}
              </button>
            </>
          )}
          <button
            onClick={() => setSidebar(s => (s === 'ai' ? 'none' : 'ai'))}
            className={headerButton}
            style={sidebar === 'ai' ? chipStyle(MORANDI.lilac) : undefined}
          >
            <Sparkles size={13} />{zh ? 'AI 助手' : 'AI'}
          </button>
          {isRich && onConvertToNote && !editing && (
            <button className={headerButton} disabled={converting} onClick={() => void handleConvert()}>
              {zh ? '转成笔记' : 'To note'}
            </button>
          )}
          {isRich && noteId && (
            <button
              onClick={() => setSidebar(s => (s === 'comments' ? 'none' : 'comments'))}
              className={headerButton}
              style={sidebar === 'comments' ? chipStyle(MORANDI.ochre) : undefined}
            >
              <MessageSquare size={13} />
              {zh ? '批注' : 'Comments'}
              {openCount > 0 && <span className="font-bold">{openCount}</span>}
            </button>
          )}
          <a href={fileUrl} download={fileName} className={headerButton} title={zh ? '下载原文件' : 'Download'}>
            <Download size={14} />
          </a>
          <button onClick={onClose} className={headerButton} aria-label={zh ? '关闭' : 'Close'}>
            <X size={14} />
          </button>
        </div>
      </div>

      {(convertError || saveError) && (
        <div className="shrink-0 border-b px-4 py-2 text-[0.75rem]" style={chipStyle(MORANDI.rose)}>{convertError || saveError}</div>
      )}

      {/* 三栏 */}
      <div className="flex min-h-0 flex-1">
        {isRich && !editing && outline.length >= 3 && (
          <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-zinc-100 px-2 py-4 lg:block dark:border-gray-800">
            <p className="mb-2 px-2 text-[0.6875rem] font-bold uppercase tracking-wider text-zinc-400">{zh ? '目录' : 'Outline'}</p>
            <ul className="space-y-0.5">
              {outline.map(item => (
                <li key={item.id}>
                  <button
                    onClick={() => scrollToHeading(item.id)}
                    style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
                    className="block w-full truncate rounded-md py-1 pr-2 text-left text-[0.75rem] leading-5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-gray-400 dark:hover:bg-gray-800"
                    title={item.text}
                  >
                    {item.text}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {editing && (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-0 w-1/2 shrink-0 resize-none border-r border-zinc-200 px-6 py-6 font-mono text-[0.8125rem] leading-6 text-zinc-800 outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
          />
        )}

        <div
          ref={previewRef}
          onMouseUp={handlePreviewSelection}
          onKeyUp={handlePreviewSelection}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {renderBody()}

          {selection && !editing && (
            <div
              style={{ top: selection.top, left: selection.left }}
              onMouseDown={e => e.preventDefault()}
              className="absolute z-10 flex -translate-x-1/2 -translate-y-full gap-1 whitespace-nowrap rounded-full bg-[#000080] p-1 shadow-lg"
            >
              {noteId && isRich && (
                <button onClick={startAnnotation} className="rounded-full px-3 py-1 text-[0.75rem] font-semibold text-white transition-colors hover:bg-white/15">
                  {zh ? '批注' : 'Comment'}
                </button>
              )}
              {onQuoteToNote && (
                <button onClick={() => void handleQuote()} disabled={quoting} className="rounded-full px-3 py-1 text-[0.75rem] font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-50">
                  {quoting ? (zh ? '正在引用…' : 'Quoting…') : (zh ? '引用到笔记' : 'Quote')}
                </button>
              )}
            </div>
          )}
        </div>

        {sidebar === 'ai' && (
          <aside
            className="relative flex shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/60 dark:border-gray-800 dark:bg-gray-900/40"
            style={{ width: sidebarWidth }}
          >
            <ResizeHandle />
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-gray-800">
              <Sparkles size={14} style={{ color: ink(MORANDI.lilac, 0.4) }} />
              <span className="text-[0.75rem] font-semibold text-zinc-800 dark:text-gray-200">{zh ? 'AI 助手' : 'AI'}</span>
              <span className="ml-auto truncate text-[0.6875rem] text-zinc-400">{zh ? '只读这份文档' : 'reads this document'}</span>
            </div>
            <DocAiPanel
              noteId={noteId}
              courseId={courseId}
              docTitle={fileName}
              docText={docText}
              isSpreadsheet={!!sheetKind}
              refining={docTextProgress !== null || (docTextSource === 'pdf' && docText !== undefined && docText !== '')}
              progress={docTextProgress}
              lang={lang}
              onQuoteToNote={onQuoteToNote ? async (text) => { await onQuoteToNote({ quote: text, fileName }); onClose(); } : undefined}
              onSaveAsAnnotation={noteId && isRich ? async (text) => {
                const { annotation } = await docsApi.addAnnotation(noteId, { body: text, anchor: {} });
                setAnnotations(prev => [...prev, annotation]);
                setSidebar('comments');
              } : undefined}
            />
            {onAskAi && (
              <button
                disabled={askingAi}
                onClick={async () => { setAskingAi(true); try { await onAskAi(); onClose(); } finally { setAskingAi(false); } }}
                className="shrink-0 border-t border-zinc-200 px-3 py-2 text-left text-[0.6875rem] text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-gray-800 dark:hover:bg-gray-800"
              >
                {zh ? '带这份文档去知识空间智能体，和其他笔记一起讨论 →' : 'Take this document to the knowledge space agent →'}
              </button>
            )}
          </aside>
        )}

        {sidebar === 'comments' && isRich && noteId && (
          <aside
            className="relative flex shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/60 dark:border-gray-800 dark:bg-gray-900/40"
            style={{ width: sidebarWidth }}
          >
            <ResizeHandle />
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-gray-800">
              <MessageSquare size={14} style={{ color: ink(MORANDI.ochre, 0.4) }} />
              <span className="text-[0.75rem] font-semibold text-zinc-800 dark:text-gray-200">{zh ? '批注' : 'Comments'}</span>
              <span className="ml-auto text-[0.6875rem] text-zinc-400">{annotations.filter(a => !a.parentId).length}</span>
            </div>

            {composer && (
              <div className="shrink-0 border-b border-zinc-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
                <div className="mb-2 flex items-center gap-2">
                  <UserAvatar name={undefined} avatar={undefined} size={20} />
                  <span className="text-[0.6875rem] text-zinc-500">{zh ? '批注这一段' : 'Comment on this passage'}</span>
                </div>
                <p className="mb-2 border-l-2 pl-2 text-[0.75rem] italic leading-5 text-zinc-600" style={{ borderColor: MORANDI.ochre }}>
                  {composer.quote}
                </p>
                <textarea
                  autoFocus
                  rows={3}
                  value={composerDraft}
                  maxLength={2000}
                  onChange={e => setComposerDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitAnnotation();
                    if (e.key === 'Escape') setComposer(null);
                  }}
                  placeholder={zh ? '写下你的批注⋯⋯' : 'Write your comment…'}
                  className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-2 text-[0.75rem] outline-none focus:border-[#000080]/50 dark:border-gray-700 dark:bg-gray-900"
                />
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={() => void submitAnnotation()}
                    disabled={posting || !composerDraft.trim()}
                    className="rounded-md bg-[#000080] px-3 py-1 text-[0.6875rem] font-semibold text-white disabled:opacity-40"
                  >
                    {zh ? '发布批注' : 'Post'}
                  </button>
                  <button onClick={() => setComposer(null)} className="rounded-md border border-zinc-200 px-3 py-1 text-[0.6875rem] text-zinc-600">
                    {zh ? '取消' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}

            <DocAnnotationPanel
              annotations={annotations}
              staleIds={staleIds}
              currentUserId={currentUserId}
              isStaff={isStaff}
              lang={lang}
              loading={annLoading}
              onJump={handleJump}
              onReply={handleReply}
              onToggleResolved={handleToggleResolved}
              onDelete={handleDeleteAnnotation}
            />
          </aside>
        )}
      </div>
    </div>
  );
};

export default FileViewerPage;
