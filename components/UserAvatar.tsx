/**
 * 用户头像 —— 全站唯一实现。
 *
 * 规则很简单：设置过头像就显示头像，没设置就回退到「按姓名散列的色块 + 首字」。
 * 之所以要收成一个组件，是因为这套回退逻辑此前在画布卡片、成员管理、顶栏、
 * 侧边栏、移动端各写了一遍，字数、取色、取字规则互不相同 ——
 * 同一个人在不同页面长得不一样，头像也就失去了「一眼认人」的作用。
 *
 * 回退色由姓名散列而来而非随机，所以同一个人在任何界面都是同一种颜色。
 */
import React from 'react';
import { AVATAR_HUES } from './morandiPalette';

export function avatarHue(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

/**
 * 头像里的字。小尺寸只放一个字：24px 的圆塞两个汉字每字不足 10px，
 * 已经低于可读下限。中文取名字末字（一个班里比姓氏更能区分人），
 * 西文取首字母缩写。
 */
export function avatarInitials(name: string, chars: number): string {
  const t = (name || '').trim();
  if (!t) return '?';
  if (/[一-龥]/.test(t)) return t.slice(-chars);
  return t.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, chars);
}

export interface UserAvatarProps {
  name?: string | null;
  /** 用户设置的头像地址。为空则走回退。 */
  avatar?: string | null;
  size?: number;
  /** 覆盖回退底色（例如按角色着色的场景）。 */
  fallbackColor?: string;
  /** 头像图片加载失败时是否回退到色块。默认 true。 */
  className?: string;
  title?: string;
}

const UserAvatar: React.FC<UserAvatarProps> = ({
  name, avatar, size = 32, fallbackColor, className = '', title,
}) => {
  const label = name?.trim() || '';
  // 图片挂了（存储被清、链接失效）不能留一个碎图占位，回退到色块。
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => { setBroken(false); }, [avatar]);

  const dim = { width: size, height: size };
  const shared = `flex-shrink-0 rounded-full object-cover ring-1 ring-black/5 ${className}`;

  if (avatar && !broken) {
    return (
      <img
        src={avatar}
        alt={label || 'avatar'}
        title={title ?? label}
        draggable={false}
        style={dim}
        onError={() => setBroken(true)}
        className={shared}
      />
    );
  }

  const oneChar = size < 28;
  return (
    <span
      style={{ ...dim, backgroundColor: fallbackColor ?? avatarHue(label) }}
      title={title ?? label}
      className={`flex items-center justify-center font-semibold leading-none text-white ${shared}`}
    >
      <span style={{ fontSize: Math.round(size * (oneChar ? 0.5 : 0.4)) }}>
        {avatarInitials(label, oneChar ? 1 : 2)}
      </span>
    </span>
  );
};

export default UserAvatar;
