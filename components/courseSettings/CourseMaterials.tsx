
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
    whereTitle: 'Where uploaded materials go',
    where: [
      'The file is stored on the platform and can be downloaded from this list.',
      'PDF, Word (.docx) and text files are read in the background and added to this course\'s AI knowledge base. When students ask the AI in a note, it searches the knowledge base first, and the answer lists the passages it cites, with page numbers for PDFs. Images, audio, video, PowerPoint and Excel files are stored only.',
      'Students do not see this list. To let students read a file themselves, upload it with Attachment in a knowledge space.',
    ],
    dragDrop: 'Drag and drop a file here, or click to browse',
    maxSize: 'Maximum file size: 50MB',
    tooLarge: 'The file is larger than 50MB.',
    emptyState: 'No materials uploaded yet.',
    uploadTitle: 'Upload New Material',
    titlePlaceholder: 'Material title (the AI cites materials by this title)',
    descriptionPlaceholder: 'Description (optional)',
    uploadBtn: 'Upload',
    uploading: 'Uploading…',
    cancel: 'Cancel',
    deleteConfirm: 'Delete this material? It is also removed from the AI knowledge base.',
    uploadFailed: 'Upload failed: ',
    deleteFailed: 'Delete failed: ',
    kb: {
      ready: (n: number) => `In the AI knowledge base · ${n} passages`,
      refining: 'The PDF is still being parsed for structure; the knowledge base updates when that finishes.',
      unsearchable: 'Stored in the knowledge base, but the AI cannot search it yet: the platform\'s retrieval service is not set up. Please tell the platform administrator.',
      processing: 'Reading the file; it joins the AI knowledge base when done.',
      no_text: 'No text could be read, so the AI cannot use it (common with scanned PDFs). The file can still be downloaded.',
      failed: 'Adding it to the knowledge base failed. Use Re-parse to try again.',
      unsupported: 'This format is not added to the AI knowledge base. The file is stored for download only.',
    } as Record<Exclude<KbState, 'ready'>, string> & { ready: (n: number) => string; refining: string },
    kbSwitch: 'In the knowledge base',
    kbOff: 'Switched off: the AI cannot find this material. The file can still be downloaded.',
    reparse: 'Re-parse',
    reparseHint: 'Read the file again from scratch and replace its passages in the knowledge base',
    actionFailed: 'Could not change it: ',
    pages: (n: number) => `${n} pages`,
  },
  zh: {
    title: '课程资料',
    upload: '上传资料',
    whereTitle: '上传的资料去了哪里',
    where: [
      '文件存在平台上，可以在这个列表里下载。',
      'PDF、Word（.docx）和文本文件会在后台读出正文，进入本课程的 AI 知识库：学生在笔记里问 AI 时，AI 会先检索它，回答下面列出引用的段落，PDF 还写明第几页。图片、音视频、PPT 和 Excel 只存文件。',
      '学生看不到这个列表。要让学生自己阅读原文，请在知识空间里用「附件」上传。',
    ],
    dragDrop: '拖拽文件到此处，或点击选择文件',
    maxSize: '文件最大 50MB',
    tooLarge: '文件超过 50MB。',
    emptyState: '还没有上传资料。',
    uploadTitle: '上传新资料',
    titlePlaceholder: '资料标题（AI 引用资料时用这个标题）',
    descriptionPlaceholder: '描述（可选）',
    uploadBtn: '上传',
    uploading: '上传中…',
    cancel: '取消',
    deleteConfirm: '确定删除这份资料吗？它也会从 AI 知识库里移除。',
    uploadFailed: '上传失败：',
    deleteFailed: '删除失败：',
    kb: {
      ready: (n: number) => `已进入 AI 知识库 · ${n} 段`,
      refining: 'PDF 还在做结构化解析，完成后知识库里的内容会自动更新。',
      unsearchable: '已存入知识库，但 AI 还检索不到：平台的检索服务没有配置好，请告诉平台管理员。',
      processing: '正在读取正文，完成后进入 AI 知识库。',
      no_text: '没有读出正文，AI 用不上（扫描版 PDF 常见）。文件仍可下载。',
      failed: '进入知识库时出错，可以点「重新解析」再试。',
      unsupported: '这种格式不进 AI 知识库，只存文件供下载。',
    } as Record<Exclude<KbState, 'ready'>, string> & { ready: (n: number) => string; refining: string },
    kbSwitch: '进入知识库',
    kbOff: '已关闭：AI 检索不到这份资料，文件仍可下载。',
    reparse: '重新解析',
    reparseHint: '从头再读一遍文件，替换它在知识库里的段落',
    actionFailed: '没改成：',
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
      setError(`${t.uploadFailed}${err instanceof Error ? err.message : String(err)}`);
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
      setError(`${t.deleteFailed}${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const withPending = async (materialId: string, action: () => Promise<unknown>) => {
    setPendingIds(prev => new Set(prev).add(materialId));
    setError(null);
    try {
      await action();
      onRefresh();
    } catch (err) {
      setError(`${t.actionFailed}${err instanceof Error ? err.message : String(err)}`);
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
        ? '课程资料仅供教师管理；供学生阅读的文件请上传至知识空间。'
        : 'Course materials are managed by teachers. Upload files to a knowledge space for student reading.'}</p>
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
