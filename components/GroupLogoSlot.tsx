import React, { useRef, useState } from 'react';
import RemixIcon from './RemixIcon';
import { LOGO_ACCEPT } from './groupLogo';

interface Props {
  name: string;
  logoUrl?: string | null;
  lang: 'zh' | 'en';
  /** 教职能换、能去掉；其他人只看 */
  editable?: boolean;
  /** 方框大小，Tailwind 类 */
  sizeClass?: string;
  onUpload?: (file: File) => Promise<void>;
  onClear?: () => Promise<void>;
}

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * 小组 logo 的方框（2026-10-11）。教职：点一下选图，也可以把图片文件直接拖进来；有 logo 时右上角可以去掉。
 * 其他人只显示 logo，没有就不占位置。拖进来的不是文件（比如在拖组员）时不拦，照常交给小组卡片。
 */
const GroupLogoSlot: React.FC<Props> = ({ name, logoUrl, lang, editable = false, sizeClass = 'h-12 w-12', onUpload, onClear }) => {
  const zh = lang === 'zh';
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  /** 打不开的地址（文件被删了之类）：当作没有 logo */
  const [broken, setBroken] = useState<string | null>(null);
  const showImage = Boolean(logoUrl) && broken !== logoUrl;

  if (!editable) {
    if (!showImage) return null;
    return (
      <img
        src={logoUrl!}
        alt={zh ? `${name} 的 logo` : `${name} logo`}
        onError={() => setBroken(logoUrl!)}
        draggable={false}
        className={`shrink-0 rounded-xl border border-zinc-200 bg-white object-contain p-1 ${sizeClass}`}
      />
    );
  }

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try { await task(); } finally { setBusy(false); }
  };
  const pick = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file && onUpload) void run(() => onUpload(file));
  };
  const label = showImage
    ? (zh ? `更换${name}的 logo（点击或拖入图片）` : `Change the ${name} logo (click or drop an image)`)
    : (zh ? `给${name}上传 logo（点击或拖入图片）` : `Upload a logo for ${name} (click or drop an image)`);

  return (
    <div className="group/logo relative shrink-0">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          pick(e.dataTransfer.files);
        }}
        disabled={busy}
        aria-label={label}
        title={label}
        className={`flex items-center justify-center overflow-hidden rounded-xl border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 active:scale-[0.97] disabled:cursor-wait ${sizeClass} ${
          showImage
            ? 'border-zinc-200 bg-white hover:border-[#000080]/30'
            : 'border-dashed border-zinc-300 bg-zinc-50 text-zinc-400 hover:border-[#000080]/40 hover:bg-[#000080]/[0.03] hover:text-[#000080]'
        } ${dragOver ? 'border-[#000080]/60 ring-2 ring-[#000080]/15' : ''} ${busy ? 'animate-pulse' : ''}`}
      >
        {showImage
          ? <img src={logoUrl!} alt="" draggable={false} onError={() => setBroken(logoUrl!)} className="h-full w-full object-contain p-1" />
          : <RemixIcon name="image-add-line" size={18} />}
      </button>
      {showImage && onClear && !busy && (
        <button
          type="button"
          onClick={() => void run(onClear)}
          aria-label={zh ? `去掉${name}的 logo` : `Remove the ${name} logo`}
          title={zh ? '去掉 logo' : 'Remove logo'}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm transition-all after:absolute after:-inset-2.5 after:content-[''] hover:text-zinc-900 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/logo:opacity-100"
        >
          <RemixIcon name="close-line" size={12} />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_ACCEPT}
        className="hidden"
        onChange={e => { pick(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
};

export default GroupLogoSlot;
