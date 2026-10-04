/**
 * 形状样式面板：填充/边框/文字颜色（含调色盘与色号输入）、边框粗细、
 * 字号、字重、水平与垂直对齐。
 *
 * 选中了形状就改那个形状，没选中就设定"接下来要画的"默认样式 ——
 * 两种情形共用同一套控件，用户不必先画后调。
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Check, ChevronsDown, ChevronsUp, Minus, Plus } from 'lucide-react';
import type { TextAlign, TextValign } from '../services/apiClient';
import type { Language } from '../types';

export interface ShapeStyleValue {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fontSize: number;
  fontWeight: number;
  textAlign: TextAlign;
  textValign: TextValign;
  textColor: string;
}

interface Props {
  value: ShapeStyleValue;
  lang: Language;
  /** true 时面板作用于已选中的形状，标题据此变化。 */
  editingSelection: boolean;
  onChange: (patch: Partial<ShapeStyleValue>) => void;
  onClose: () => void;
}

/** 常用色板：前两行是填充用的浅色，后一行是描边/文字用的深色。 */
const SWATCHES = [
  '#e0e7ff', '#dcfce7', '#fef3c7', '#fee2e2', '#f3e8ff', '#cffafe',
  '#c7d2fe', '#bbf7d0', '#fde68a', '#fecaca', '#e9d5ff', '#a5f3fc',
  '#1e293b', '#4338ca', '#15803d', '#b45309', '#b91c1c', '#7c3aed',
];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 归一化用户输入：允许省略 #，允许大写。返回 null 表示还不是合法色号。 */
function parseHex(raw: string): string | null {
  const v = raw.trim().replace(/^#?/, '#');
  return HEX_RE.test(v) ? v.toLowerCase() : null;
}

interface ColorFieldProps {
  label: string;
  value: string;
  /** 允许"无填充" */
  allowNone?: boolean;
  noneLabel?: string;
  onChange: (color: string) => void;
}

const ColorField: React.FC<ColorFieldProps> = ({ label, value, allowNone, noneLabel, onChange }) => {
  // 输入框保留用户正在敲的原文，只有合法时才向上提交 ——
  // 否则敲到 "#ab" 就被回写成别的值，根本打不完一个色号。
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { setDraft(value || ''); }, [value]);

  const commit = (raw: string) => {
    const hex = parseHex(raw);
    if (hex) onChange(hex);
    else setDraft(value || '');
  };

  const isNone = !value;

  return (
    <div>
      <div className="mb-1.5 text-[0.6875rem] font-semibold text-stone-600 dark:text-stone-300">{label}</div>
      {/* 固定 9 列：色板数量正好排满两行，不会留下孤零零的末行 */}
      <div className="grid grid-cols-9 gap-1">
        {SWATCHES.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            aria-label={c}
            className={`h-6 w-full rounded-md border transition-transform hover:scale-110 ${
              value.toLowerCase() === c ? 'border-[#000080] ring-2 ring-[#000080]/30' : 'border-stone-300/70'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {/* 系统调色盘 */}
        <label className="relative h-7 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-stone-300 dark:border-stone-600">
          <span className="block h-full w-full" style={{ backgroundColor: value || '#ffffff' }} />
          <input
            type="color"
            value={value || '#ffffff'}
            onChange={e => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={label}
          />
        </label>
        {/* 色号输入 */}
        <input
          type="text"
          value={draft}
          spellCheck={false}
          placeholder={isNone ? (noneLabel ?? '无') : '#RRGGBB'}
          onChange={e => setDraft(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
          className="h-7 w-full min-w-0 rounded-md border border-stone-300 bg-white px-2 font-mono text-[0.75rem] text-stone-800 outline-none transition-colors focus:border-[#000080] dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
        />
        {allowNone && (
          <button
            type="button"
            onClick={() => onChange('')}
            title={noneLabel}
            aria-label={noneLabel}
            aria-pressed={isNone}
            className={`h-7 w-8 shrink-0 rounded-md border transition-colors ${
              isNone ? 'border-[#000080] ring-2 ring-[#000080]/30' : 'border-stone-300 dark:border-stone-600'
            }`}
            style={{ backgroundImage: 'linear-gradient(45deg, transparent 44%, #ef4444 44%, #ef4444 56%, transparent 56%)' }}
          />
        )}
      </div>
    </div>
  );
};

const ShapeStylePanel: React.FC<Props> = ({ value, lang, editingSelection, onChange, onClose }) => {
  const zh = lang === 'zh';
  const ref = useRef<HTMLDivElement>(null);

  // 点面板外关闭。绑在 mousedown 上，跟画布的拖动起点一致。
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const iconBtn = (active: boolean) =>
    `flex h-7 flex-1 items-center justify-center rounded-md transition-colors ${
      active ? 'bg-[#000080] text-white' : 'text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800'
    }`;

  const stepFont = (delta: number) =>
    onChange({ fontSize: Math.min(96, Math.max(8, (value.fontSize || 15) + delta)) });

  return (
    <div
      ref={ref}
      // 面板比较高，笔记本屏幕上会顶到画布底部 —— 限高并允许内部滚动。
      className="absolute left-1/2 top-[calc(100%+8px)] z-40 max-h-[calc(100vh-120px)] w-[300px] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-stone-200 bg-white p-4 shadow-xl dark:border-stone-700 dark:bg-stone-950"
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[0.8125rem] font-semibold text-stone-900 dark:text-stone-100">
          {editingSelection
            ? (zh ? '编辑选中图形' : 'Edit selected shape')
            : (zh ? '新图形样式' : 'New shape style')}
        </div>
        {!editingSelection && (
          <span className="text-[0.6875rem] text-stone-400">{zh ? '应用于之后绘制' : 'Applies to next shape'}</span>
        )}
      </div>

      <div className="space-y-3.5">
        <ColorField
          label={zh ? '填充' : 'Fill'}
          value={value.fill}
          allowNone
          noneLabel={zh ? '无填充' : 'No fill'}
          onChange={fill => onChange({ fill })}
        />
        <ColorField
          label={zh ? '边框' : 'Border'}
          value={value.stroke}
          onChange={stroke => onChange({ stroke })}
        />

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold text-stone-600 dark:text-stone-300">{zh ? '边框粗细' : 'Border width'}</span>
            <span className="font-mono text-[0.6875rem] text-stone-500">{value.strokeWidth}px</span>
          </div>
          <input
            type="range"
            min={0}
            max={8}
            step={1}
            value={value.strokeWidth}
            onChange={e => onChange({ strokeWidth: Number(e.target.value) })}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-stone-200 accent-[#000080] dark:bg-stone-700"
            aria-label={zh ? '边框粗细' : 'Border width'}
          />
        </div>

        <div className="h-px bg-stone-100 dark:bg-stone-800" />

        <ColorField
          label={zh ? '文字颜色' : 'Text colour'}
          value={value.textColor}
          allowNone
          noneLabel={zh ? '跟随边框色' : 'Match border'}
          onChange={textColor => onChange({ textColor })}
        />

        <div>
          <div className="mb-1.5 text-[0.6875rem] font-semibold text-stone-600 dark:text-stone-300">{zh ? '字号' : 'Font size'}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => stepFont(-1)}
              aria-label={zh ? '缩小字号' : 'Smaller'}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-stone-300 text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <Minus size={13} />
            </button>
            <input
              type="number"
              min={8}
              max={96}
              value={value.fontSize}
              onChange={e => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) onChange({ fontSize: Math.min(96, Math.max(8, Math.round(n))) });
              }}
              className="h-7 w-14 rounded-md border border-stone-300 bg-white px-2 text-center font-mono text-[0.75rem] text-stone-800 outline-none focus:border-[#000080] dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
              aria-label={zh ? '字号' : 'Font size'}
            />
            <button
              type="button"
              onClick={() => stepFont(1)}
              aria-label={zh ? '放大字号' : 'Larger'}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-stone-300 text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              onClick={() => onChange({ fontWeight: value.fontWeight >= 700 ? 400 : 700 })}
              title={zh ? '加粗' : 'Bold'}
              aria-label={zh ? '加粗' : 'Bold'}
              aria-pressed={value.fontWeight >= 700}
              className={`ml-auto flex h-7 w-8 items-center justify-center rounded-md transition-colors ${
                value.fontWeight >= 700
                  ? 'bg-[#000080] text-white'
                  : 'border border-stone-300 text-stone-600 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              <Bold size={13} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1.5 text-[0.6875rem] font-semibold text-stone-600 dark:text-stone-300">{zh ? '左右对齐' : 'Horizontal'}</div>
            <div className="flex gap-1 rounded-lg border border-stone-200 p-0.5 dark:border-stone-700">
              {([
                { k: 'left' as TextAlign, icon: <AlignLeft size={13} />, zh: '左对齐', en: 'Left' },
                { k: 'center' as TextAlign, icon: <AlignCenter size={13} />, zh: '居中', en: 'Center' },
                { k: 'right' as TextAlign, icon: <AlignRight size={13} />, zh: '右对齐', en: 'Right' },
              ]).map(o => (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => onChange({ textAlign: o.k })}
                  title={zh ? o.zh : o.en}
                  aria-label={zh ? o.zh : o.en}
                  aria-pressed={value.textAlign === o.k}
                  className={iconBtn(value.textAlign === o.k)}
                >
                  {o.icon}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[0.6875rem] font-semibold text-stone-600 dark:text-stone-300">{zh ? '上下对齐' : 'Vertical'}</div>
            <div className="flex gap-1 rounded-lg border border-stone-200 p-0.5 dark:border-stone-700">
              {([
                { k: 'top' as TextValign, icon: <ChevronsUp size={13} />, zh: '顶端', en: 'Top' },
                { k: 'middle' as TextValign, icon: <Minus size={13} />, zh: '垂直居中', en: 'Middle' },
                { k: 'bottom' as TextValign, icon: <ChevronsDown size={13} />, zh: '底端', en: 'Bottom' },
              ]).map(o => (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => onChange({ textValign: o.k })}
                  title={zh ? o.zh : o.en}
                  aria-label={zh ? o.zh : o.en}
                  aria-pressed={value.textValign === o.k}
                  className={iconBtn(value.textValign === o.k)}
                >
                  {o.icon}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mt-4 flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg bg-stone-900 text-[0.8125rem] font-semibold text-stone-50 transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
      >
        <Check size={14} />
        {zh ? '完成' : 'Done'}
      </button>
    </div>
  );
};

export default ShapeStylePanel;
