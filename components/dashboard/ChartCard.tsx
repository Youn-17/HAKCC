import React from 'react';
import RemixIcon from '../RemixIcon';

/**
 * Shared chart shell for the research modules.
 *
 * ResearchZone and ResearchAdvanced each carried an identical copy — same prop
 * signature, same markup — differing only in how the two download buttons were
 * styled, so the panels had quietly drifted apart.
 */

export const DownloadBtn: React.FC<{ onClick: () => void; label: string; icon?: string }> = ({ onClick, label, icon }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200"
  >
    {icon && <RemixIcon name={icon} size={12} />}
    {label}
  </button>
);

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
  onDownloadPng?: () => void;
  onDownloadCsv?: () => void;
}

export const ChartCard: React.FC<ChartCardProps> = ({ title, children, onDownloadPng, onDownloadCsv }) => (
  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</h4>
      <div className="flex gap-1.5">
        {onDownloadPng && <DownloadBtn onClick={onDownloadPng} label="PNG" icon="image-line" />}
        {onDownloadCsv && <DownloadBtn onClick={onDownloadCsv} label="CSV" icon="file-text-line" />}
      </div>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

export default ChartCard;
