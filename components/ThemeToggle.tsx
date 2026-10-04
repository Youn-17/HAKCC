import React from 'react';
import { useTheme, ThemeMode } from '../contexts/ThemeContext';
import { Moon, Sun, Monitor } from 'lucide-react';

const CYCLE: ThemeMode[] = ['light', 'dark', 'system'];

const ICONS: Record<ThemeMode, React.ReactNode> = {
  light:  <Sun    size={16} />,
  dark:   <Moon   size={16} />,
  system: <Monitor size={16} />,
};

const TITLES: Record<ThemeMode, string> = {
  light:  'Light mode',
  dark:   'Dark mode',
  system: 'Follow system',
};

const ThemeToggle: React.FC<{ compact?: boolean; lang?: string }> = () => {
  const { theme, setTheme } = useTheme();

  const handleClick = () => {
    const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];
    setTheme(next);
  };

  return (
    <button
      onClick={handleClick}
      title={TITLES[theme]}
      className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/8 transition-colors cursor-pointer"
    >
      {ICONS[theme]}
    </button>
  );
};

export default ThemeToggle;
