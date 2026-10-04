import React, { useRef, useState } from 'react';

interface SpotlightCardProps {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  spotlightColor?: string;
  borderColor?: string;
  glareColor?: string;
  enableGlare?: boolean;
}

export default function SpotlightCard({
  children,
  className = "",
  innerClassName = "p-6",
  spotlightColor = "rgba(52, 87, 213, 0.08)", // 皇家学术蓝晕光
  borderColor = "rgba(52, 87, 213, 0.22)",   // 精细蓝色描边跟随发光
  glareColor = "rgba(255, 255, 255, 0.22)",
  enableGlare = true,
}: SpotlightCardProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [positionPct, setPositionPct] = useState({ x: 50, y: 50 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPosition({ x, y });
    setPositionPct({
      x: Math.max(0, Math.min(100, (x / rect.width) * 100)),
      y: Math.max(0, Math.min(100, (y / rect.height) * 100)),
    });
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={`group relative rounded-2xl p-[1px] overflow-hidden bg-slate-200/80 dark:bg-white/10 transition-[transform,box-shadow,background] duration-300 ease-out ${className}`}
      style={{
        backgroundImage: opacity > 0 
          ? `radial-gradient(300px circle at ${position.x}px ${position.y}px, ${borderColor}, transparent 80%)`
          : undefined
      }}
    >
      <div className={`relative w-full h-full bg-white dark:bg-[#080A3A]/95 rounded-[15px] overflow-hidden z-10 ${innerClassName}`}>
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 ease-out z-0"
          style={{
            opacity,
            background: `radial-gradient(350px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 70%)`
          }}
        />
        {enableGlare && (
          <div
            className="pointer-events-none absolute inset-0 z-0 opacity-0 mix-blend-screen transition-opacity duration-500 ease-out"
            style={{
              opacity: opacity * 0.55,
              background: `linear-gradient(115deg, transparent 0%, transparent ${Math.max(0, positionPct.x - 24)}%, ${glareColor} ${positionPct.x}%, transparent ${Math.min(100, positionPct.x + 24)}%, transparent 100%)`,
              transform: `translate3d(${(positionPct.x - 50) * 0.08}px, ${(positionPct.y - 50) * 0.04}px, 0)`,
            }}
          />
        )}
        <div className="relative z-10 w-full h-full">
          {children}
        </div>
      </div>
    </div>
  );
}
