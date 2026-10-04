import React, { useState, useRef } from 'react';
import { X, UploadCloud, File, FileText, Image, Video } from 'lucide-react';
import { Language } from '../types';

interface AttachmentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (file: File) => void;
  lang?: Language;
}

const AttachmentUploadModal: React.FC<AttachmentUploadModalProps> = ({ isOpen, onClose, onUpload, lang = 'en' }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const t = {
    title: lang === 'zh' ? '上传附件' : 'Upload Attachment',
    subtitle: lang === 'zh' ? '支持格式: 图片, 视频, PDF, Office 文档, CSV' : 'Supported formats: Images, Videos, PDF, Office Docs, CSV',
    dragText: lang === 'zh' ? '点击上传或拖拽文件' : 'Click to upload or drag and drop',
    maxSize: lang === 'zh' ? '单个文件最大 500MB；出于安全考虑不支持 SVG 和 HTML' : 'Up to 500 MB per file. SVG and HTML are not accepted for security reasons',
    cancel: lang === 'zh' ? '取消' : 'Cancel'
  };

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onUpload(e.dataTransfer.files[0]);
      onClose();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUpload(e.target.files[0]);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-8 relative flex flex-col items-center" 
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors">
          <X size={24} />
        </button>

        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{t.title}</h2>
          <p className="text-gray-500 text-sm">
            {t.subtitle}
          </p>
        </div>

        {/* Supported Types Icons */}
        <div className="flex gap-4 mb-8 text-gray-400">
           <div className="flex flex-col items-center gap-1"><Image size={24}/><span className="text-[0.6875rem]">IMG</span></div>
           <div className="flex flex-col items-center gap-1"><Video size={24}/><span className="text-[0.6875rem]">VID</span></div>
           <div className="flex flex-col items-center gap-1"><FileText size={24}/><span className="text-[0.6875rem]">DOC</span></div>
           <div className="flex flex-col items-center gap-1"><File size={24}/><span className="text-[0.6875rem]">FILE</span></div>
        </div>

        {/* Drop Zone */}
        <div 
          className={`
            w-full h-48 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all
            ${isDragging ? 'border-blue-500 bg-blue-50 scale-105' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className={`p-4 rounded-full mb-3 ${isDragging ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
            <UploadCloud size={32} />
          </div>
          <p className="text-sm font-medium text-gray-700">
            {t.dragText}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {t.maxSize}
          </p>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={handleFileSelect} 
          />
        </div>

        <div className="mt-6 w-full flex justify-end">
           <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">{t.cancel}</button>
        </div>
      </div>
    </div>
  );
};

export default AttachmentUploadModal;
