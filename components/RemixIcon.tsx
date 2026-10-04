import type { CSSProperties } from 'react';

type RemixIconProps = {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
};

export default function RemixIcon({
  name,
  size = 16,
  className = '',
  style,
  title,
}: RemixIconProps) {
  return (
    <i
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={`ri-${name} inline-flex items-center justify-center leading-none ${className}`}
      style={{ fontSize: size, width: size, height: size, ...style }}
    />
  );
}
