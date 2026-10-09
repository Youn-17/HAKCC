import { courseSettingsError } from './errorText';

import React, { useState, useRef, useEffect } from 'react';
import {
  Upload, FileText, Film, FileImage, Music, Download, Trash2,
  Loader2, File, X, RefreshCw
} from 'lucide-react';
import { Language, CourseMaterial } from '../../types';
import { courseSettings } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { supabase } from '../../services/supabaseClient';
import CourseKnowledgeBase, { KbSwitch } from './CourseKnowledgeBase';

interface CourseMaterialsProps {
  courseId: string;
  materials: CourseMaterial[];
  onRefresh: () => void;
  lang: Language;
}

const MAX_BYTES = 50 * 1024 * 1024;

type KbState = NonNullable<CourseMaterial['knowledgeBase']>['state'];

const TRANSLATIONS = {
  en: {
    title: 'Course Materials',
    upload: 'Upload Material',
    where: [
      'Uploaded files can be downloaded here.',
      'Parsed PDF, Word (.docx) and text files are available to course AI assistants for retrieval. Citations show sources and available PDF page numbers. Images, audio, video, PowerPoint and Excel files are stored for download only.',
      'Students cannot access this page. To share the original file, upload it as a knowledge space attachment.',
    ],
    dragDrop: 'Drag and drop a file here, or click to browse',
    maxSize: 'Maximum file size: 50MB',
    tooLarge: 'The file is larger than 50MB.',
    emptyState: 'No materials uploaded yet.',
    uploadTitle: 'Upload New Material',
    titlePlaceholder: 'Material title (used in citations)',
    descriptionPlaceholder: 'Description (optional)',
    uploadBtn: 'Upload',
    uploading: 'Uploading…',
    cancel: 'Cancel',
    deleteConfirm: 'Delete this material? The file and its knowledge base content will be removed.',
    uploadFailed: 'Upload failed. Please try again.',
    deleteFailed: 'Delete failed. Please try again.',
    kb: {
      ready: (n: number) => `Indexed · ${n} passages`,
      refining: 'Further PDF parsing is in progress. Knowledge base content will update automatically when complete.',
      unsearchable: 'Content is indexed, but retrieval is not configured. Please contact the platform administrator.',
      processing: 'Processing material. It will be available for AI retrieval when complete.',
      no_text: 'No searchable text was extracted. Check that the file contains recognizable text. The file is still available for download.',
      failed: 'Processing failed. Please re-parse the material.',
      unsupported: 'This format does not support knowledge base retrieval. The file is still available for download.',
    } as Record<Exclude<KbState, 'ready'>, string> & { ready: (n: number) => string; refining: string },
    kbSwitch: 'Allow AI retrieval',
    kbOff: 'AI retrieval is off. The file is still available for download.',
    reparse: 'Re-parse',
    reparseHint: 'Extract the file content again and update the knowledge base',
    actionFailed: 'Action failed. Please try again.',
    pages: (n: number) => `${n} pages`,
  },
  zh: {
    title: '课程资料',
    upload: '上传资料',
    where: [
      '上传的文件可在本页下载。',
      'PDF、Word（.docx）和文本文件解析后可供课程 AI 助手检索，引用内容显示来源及可用的 PDF 页码。图片、音视频、PPT 和 Excel 仅保存文件，不参与知识库检索。',
      '学生无法访问本页；如需共享原文，请将文件上传为知识空间附件。',
    ],
    dragDrop: '拖拽文件到此处，或点击选择文件',
    maxSize: '文件最大 50MB',
    tooLarge: '文件超过 50MB。',
    emptyState: '还没有上传资料。',
    uploadTitle: '上传新资料',
    titlePlaceholder: '资料标题（用于引用来源）',
    descriptionPlaceholder: '描述（可选）',
    uploadBtn: '上传',
    uploading: '上传中…',
    cancel: '取消',
    deleteConfirm: '删除此资料？文件及其知识库内容将一并移除。',
    uploadFailed: '上传失败，请重试。',
    deleteFailed: '删除失败，请重试。',
    kb: {
      ready: (n: number) => `已收录 · ${n} 个段落`,
      refining: 'PDF 正在进一步解析，完成后自动更新知识库内容。',
      unsearchable: '资料已收录，检索服务尚未配置。请联系平台管理员。',
      processing: '正在处理资料，完成后可用于 AI 检索。',
      no_text: '未提取到可检索文本。请检查文件是否包含可识别的文字；文件仍可下载。',
      failed: '资料处理失败，请重新解析。',
      unsupported: '此格式暂不支持知识库检索，文件仍可下载。',
    } as Record<Exclude<KbState, 'ready'>, string> & { ready: (n: number) => string; refining: string },
    kbSwitch: '允许 AI 检索',
    kbOff: '已关闭 AI 检索，文件仍可下载。',
    reparse: '重新解析',
    reparseHint: '重新提取文件内容并更新知识库',
    actionFailed: '操作失败，请重试。',
    pages: (n: number) => `${n} 页`,
  },
};

/** 有的系统给 .md / .txt 报不出类型，服务端会按未知类型拒收 */
function mimeOf(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'text/markdown';
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.csv')) return 'text/csv';
  return 'application/octet-stream';
}

const CourseMaterials: React.FC<CourseMaterialsProps> = ({ courseId, materials, onRefresh, lang }) => {
  const t = TRANSLATIONS[lang];
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadData, setUploadData] = useState({
    title: '',
    description: '',
    file: null as File | null,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 正在改开关或重新解析的资料 */
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());

  // 解析在后台跑（PDF 走 MinerU 要几十秒到几分钟，服务端最多等约 10 分钟），
  // 期间隔一会儿刷新一次状态。回调走 ref：父组件每次渲染都给一个新函数，
  // 放进依赖会让计时器和次数上限跟着重置。
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const busy = materials.some(m => m.knowledgeBase?.state === 'processing' || m.knowledgeBase?.refining);
  useEffect(() => {
    if (!busy) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > 60) { window.clearInterval(timer); return; }
      refreshRef.current();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <FileImage size={24} className="text-violet-500 dark:text-violet-400" />;
    if (mimeType.startsWith('video/')) return <Film size={24} className="text-rose-500 dark:text-rose-400" />;
    if (mimeType.startsWith('audio/')) return <Music size={24} className="text-emerald-500 dark:text-emerald-400" />;
    if (mimeType === 'application/pdf') return <FileText size={24} className="text-rose-600 dark:text-rose-400" />;
    return <File size={24} className="text-stone-500 dark:text-stone-400" />;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(t.tooLarge);
      return;
    }
    setError(null);
    setUploadData(prev => ({ ...prev, file, title: prev.title || file.name }));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    pickFile(e.dataTransfer.files[0]);
  };

  const closeUpload = () => {
    setShowUpload(false);
    setError(null);
    setUploadData({ title: '', description: '', file: null });
  };

  const handleUpload = async () => {
    const file = uploadData.file;
    const title = uploadData.title.trim();
    if (!title || !file) return;

    setUploading(true);
    setError(null);
    try {
      const mime = mimeOf(file);
      const { path, token, bucket } = await courseSettings.signMaterialUpload(courseId, {
        file_name: file.name,
        mime_type: mime,
        file_size: file.size,
      });
      const { error: storageError } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(path, token, file, { contentType: mime });
      if (storageError) throw storageError;

      await courseSettings.createMaterial(courseId, {
        title,
        description: uploadData.description.trim() || undefined,
        path,
        file_name: file.name,
        mime_type: mime,
      });

      closeUpload();
      onRefresh();
    } catch (err) {
      setError(courseSettingsError(err, lang === 'zh', t.uploadFailed));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (materialId: string) => {
    if (!confirm(t.deleteConfirm)) return;
    setError(null);
    try {
      await courseSettings.deleteMaterial(courseId, materialId);
      onRefresh();
    } catch (err) {
      setError(courseSettingsError(err, lang === 'zh', t.deleteFailed));
    }
  };

  const withPending = async (materialId: string, action: () => Promise<unknown>) => {
    setPendingIds(prev => new Set(prev).add(materialId));
    setError(null);
    try {
      await action();
      onRefresh();
    } catch (err) {
      setError(courseSettingsError(err, lang === 'zh', t.actionFailed));
    } finally {
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(materialId);
        return next;
      });
    }
  };

  const kbLine = (kb: CourseMaterial['knowledgeBase']) => {
    if (!kb) return null;
    if (kb.enabled === false && kb.state !== 'unsupported') {
      return <p className="mt-2 text-xs leading-relaxed text-stone-400 dark:text-stone-500">{t.kbOff}</p>;
    }
    const tone = kb.state === 'ready'
      ? 'text-emerald-700 dark:text-emerald-400'
      : kb.state === 'processing'
        ? 'text-stone-500 dark:text-stone-400'
        : kb.state === 'unsupported'
          ? 'text-stone-400 dark:text-stone-500'
          : 'text-amber-700 dark:text-amber-400';
    const text = kb.state === 'ready' ? t.kb.ready(kb.chunks) : t.kb[kb.state];
    return (
      <div className="mt-2 space-y-0.5 text-xs leading-relaxed">
        <p className={`flex items-start gap-1.5 ${tone}`}>
          {kb.state === 'processing' && <Loader2 size={12} className="mt-0.5 flex-shrink-0 animate-spin" />}
          <span>{text}</span>
        </p>
        {kb.refining && kb.state !== 'processing' && (
          <p className="text-stone-400 dark:text-stone-500">{t.kb.refining}</p>
        )}
      </div>
    );
  };

  return (
    <div className="course-settings-section flex min-h-full flex-col gap-4">
      {/* Header */}
      <div className="course-settings-section-header flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
          <FileText size={20} className="text-[#000080] dark:text-[#93AAFD]" />
          {t.title}
        </h3>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#000080] hover:bg-[#000080]/90 text-white rounded-lg font-medium text-sm transition-colors"
        >
          <Upload size={16} />
          {t.upload}
        </button>
      </div>

      <p className="course-settings-section-hint">{lang === 'zh'
        ? '本页由课程创建者和课程管理员管理。供学生阅读的文件请上传至知识空间。'
        : 'This page is managed by the course creator and course managers. Upload files to a knowledge space for student reading.'}</p>
      <details className="course-settings-guidance">
        <summary><RemixIcon name="information-line" size={16} />{lang === 'zh' ? '资料用途与可见范围' : 'Material use and visibility'}<RemixIcon name="arrow-down-s-line" size={16} /></summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
          {t.where.map(line => <li key={line}>{line}</li>)}
        </ul>
      </details>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="course-settings-form-panel bg-stone-50 dark:bg-stone-900 rounded-xl p-4 space-y-4 border border-stone-200 dark:border-stone-800">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-stone-900 dark:text-stone-100">{t.uploadTitle}</h4>
            <button
              onClick={closeUpload}
              aria-label={t.cancel}
              className="p-1 hover:bg-stone-200 dark:hover:bg-stone-800 rounded"
            >
              <X size={18} className="text-stone-500 dark:text-stone-400" />
            </button>
          </div>

          {/* File Drop Area */}
          <div
            role="button"
            tabIndex={0}
            aria-label={t.dragDrop}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInputRef.current?.click(); } }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="course-settings-dropzone border-2 border-dashed border-stone-200 dark:border-stone-700 rounded-xl p-8 text-center cursor-pointer hover:border-[#000080]/40 hover:bg-[#000080]/[0.03] dark:hover:border-[#93AAFD]/40 dark:hover:bg-[#93AAFD]/[0.06] transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => pickFile(e.target.files?.[0])}
              className="hidden"
            />
            <Upload size={32} className="mx-auto text-stone-400 dark:text-stone-500 mb-2" />
            <p className="text-sm text-stone-600 dark:text-stone-300">{t.dragDrop}</p>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">{t.maxSize}</p>
            {uploadData.file && (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-[#000080]/10 dark:bg-[#93AAFD]/15 text-[#000080] dark:text-[#93AAFD] rounded-full text-sm">
                <File size={14} />
                {uploadData.file.name}
              </div>
            )}
          </div>

          {/* Material Details */}
          <div className="space-y-3">
            <input
              type="text"
              placeholder={t.titlePlaceholder}
              value={uploadData.title}
              maxLength={200}
              onChange={(e) => setUploadData({ ...uploadData, title: e.target.value })}
              className="w-full px-4 py-2 border border-stone-200 dark:border-stone-700 rounded-lg focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-700 outline-none"
            />
            <textarea
              placeholder={t.descriptionPlaceholder}
              value={uploadData.description}
              onChange={(e) => setUploadData({ ...uploadData, description: e.target.value })}
              className="w-full px-4 py-2 border border-stone-200 dark:border-stone-700 rounded-lg focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-700 outline-none resize-none"
              rows={2}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              onClick={closeUpload}
              className="px-4 py-2 bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 rounded-lg font-medium text-sm transition-colors"
            >
              {t.cancel}
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadData.file || !uploadData.title.trim()}
              className="px-4 py-2 bg-[#000080] hover:bg-[#000080]/90 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading ? t.uploading : t.uploadBtn}
            </button>
          </div>
        </div>
      )}

      <CourseKnowledgeBase
        courseId={courseId}
        lang={lang}
        refreshKey={materials.map(m => `${m.id}:${m.knowledgeBase?.state}:${m.knowledgeBase?.enabled}:${m.knowledgeBase?.chunks}`).join('|')}
      />

      {/* Materials List */}
      {materials.length === 0 ? (
        <div className="flex min-h-[22rem] flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-200 bg-stone-50 px-6 py-12 text-center dark:border-stone-800 dark:bg-stone-900">
          <FileText size={40} className="mb-3 text-stone-300 dark:text-stone-600" />
          <p className="max-w-sm text-sm leading-relaxed text-stone-500 dark:text-stone-400">{t.emptyState}</p>
        </div>
      ) : (
        <div className="course-materials-list grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {materials.map((material) => (
            <div
              key={material.id}
              className="course-settings-card course-material-card bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-xl p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 p-3 bg-stone-100 dark:bg-stone-800 rounded-lg">
                  {getFileIcon(material.mimeType || '')}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-stone-900 dark:text-stone-100 truncate">{material.title}</h4>
                  {material.description && (
                    <p className="text-sm text-stone-500 dark:text-stone-400 line-clamp-2 mt-1">{material.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-stone-400 dark:text-stone-500">
                    <span className="truncate">{material.fileName}</span>
                    {material.fileSize ? <span className="flex-shrink-0">{formatFileSize(material.fileSize)}</span> : null}
                    {material.knowledgeBase?.pages ? <span className="flex-shrink-0">{t.pages(material.knowledgeBase.pages)}</span> : null}
                  </div>
                  {kbLine(material.knowledgeBase)}
                  {material.knowledgeBase && material.knowledgeBase.state !== 'unsupported' && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3">
                      <KbSwitch
                        checked={material.knowledgeBase.enabled !== false}
                        disabled={pendingIds.has(material.id)}
                        label={t.kbSwitch}
                        onChange={next => void withPending(material.id, () => courseSettings.setMaterialKb(courseId, material.id, next))}
                      />
                      <button
                        type="button"
                        title={t.reparseHint}
                        disabled={pendingIds.has(material.id) || material.knowledgeBase.state === 'processing'}
                        onClick={() => void withPending(material.id, () => courseSettings.reparseMaterial(courseId, material.id))}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-xs font-medium text-stone-500 transition-colors hover:text-[#000080] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-400 dark:hover:text-[#93AAFD]"
                      >
                        {pendingIds.has(material.id) ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {t.reparse}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <a
                    href={material.fileUrl}
                    download={material.fileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg transition-colors"
                    title={lang === 'zh' ? '下载' : 'Download'}
                  >
                    <Download size={16} className="text-stone-500 dark:text-stone-400" />
                  </a>
                  <button
                    onClick={() => handleDelete(material.id)}
                    className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
                    title={lang === 'zh' ? '删除' : 'Delete'}
                    aria-label={`${lang === 'zh' ? '删除资料' : 'Delete material'}: ${material.title}`}
                  >
                    <Trash2 size={16} className="text-rose-500 dark:text-rose-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CourseMaterials;
