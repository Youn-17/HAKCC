import { describe, expect, it } from 'vitest';
import { RELATION_PALETTE } from './morandiPalette';
import { RELATION_COLORS, RELATION_STYLE } from './relationColors';

function lab(hex: string): [number, number, number] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function relativeLuminance(hex: string): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('Build-on 连线配色', () => {
  const entries = Object.entries(RELATION_PALETTE);

  it('六种关系两两分得开：旧的莫兰迪六色最近一对只差 14.9，这里要求至少 30', () => {
    let closest = Infinity;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, b] = [lab(entries[i][1]), lab(entries[j][1])];
        closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    }
    expect(closest).toBeGreaterThan(30);
  });

  it('画在白底上的细线，对比度都不低于 3:1', () => {
    for (const [, hex] of entries) {
      expect((1.05) / (relativeLuminance(hex) + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });

  it('Tailwind 类名里写死的 hex 和色板一致', () => {
    for (const [type, hex] of entries) {
      expect(RELATION_COLORS[type]).toBe(hex);
      expect(RELATION_STYLE[type].border).toBe(`border-[${hex}]`);
      expect(RELATION_STYLE[type].ring).toBe(`ring-[${hex}]`);
      expect(RELATION_STYLE[type].bg).toBe(`bg-[${hex}]/10`);
    }
  });
});
