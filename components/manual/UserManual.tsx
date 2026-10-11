import React, { useState } from 'react';
import RemixIcon from '../RemixIcon';

interface Props {
  lang: 'zh' | 'en';
  role: 'student' | 'teacher' | 'admin';
}

const videos = [
  { file: '01-note-build-on-v4.mp4', zh: '创建 Note 与 Build-on', en: 'Creating Notes and Build-ons' },
  { file: '02-note-ai-v2.mp4', zh: 'Note 助手与智能体', en: 'Note assistant and agents' },
  { file: '03-workspace-agent-v1.mp4', zh: '知识空间智能体', en: 'Workspace agent' },
];
const base = 'https://ideaweave.tech/manual/student-guide/';
const pdf = `${base}student-manual-20261010.pdf`;

const UserManual: React.FC<Props> = ({ lang }) => {
  const zh = lang === 'zh';
  const [selected, setSelected] = useState(0);
  const video = videos[selected];
  const linkStyle = 'inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:hover:bg-slate-800';

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-white text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-8">
        <h1 className="text-2xl font-semibold">{zh ? '使用手册' : 'User manual'}</h1>
        <section aria-labelledby="manual-videos-title">
          <h2 id="manual-videos-title" className="mb-4 text-lg font-semibold">{zh ? '操作视频' : 'Video tutorials'}</h2>
          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            {videos.map((item, index) => (
              <button key={item.file} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}
                className={`flex min-h-12 items-center gap-2 rounded-lg border px-4 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${selected === index ? 'border-slate-700 bg-slate-100 font-semibold dark:border-slate-300 dark:bg-slate-800' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900'}`}>
                <RemixIcon name="play-circle-line" size={18} />
                <span>{index + 1}. {zh ? item.zh : item.en}</span>
              </button>
            ))}
          </div>
          <video key={video.file} controls playsInline preload="metadata" aria-label={zh ? video.zh : video.en}
            className="aspect-video w-full rounded-xl bg-black" src={`${base}${video.file}`}>
            <a href={`${base}${video.file}`}>{zh ? '打开视频' : 'Open video'}</a>
          </video>
        </section>
        <section aria-labelledby="manual-pdf-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="manual-pdf-title" className="text-lg font-semibold">{zh ? '画布空间学生操作手册' : 'Student canvas manual'} <span className="text-sm font-normal text-slate-500">PDF</span></h2>
            <div className="flex flex-wrap gap-2">
              <a href={pdf} target="_blank" rel="noopener noreferrer" className={linkStyle}><RemixIcon name="external-link-line" size={16} />{zh ? '打开 PDF' : 'Open PDF'}</a>
              <a href={pdf} download="人智知识协作空间_画布空间学生操作手册.pdf" className={linkStyle}><RemixIcon name="download-line" size={16} />{zh ? '下载 PDF' : 'Download PDF'}</a>
            </div>
          </div>
          <iframe src={pdf} title={zh ? '画布空间学生操作手册 PDF' : 'Student canvas manual PDF'} loading="lazy"
            className="h-[75vh] min-h-[420px] w-full rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700" />
        </section>
      </main>
    </div>
  );
};

export default UserManual;
