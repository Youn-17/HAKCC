import { describe, expect, it } from 'vitest';
import { KIT_CSS, KIT_GUIDE, KIT_JS, injectArtifactKit, stripArtifactKit } from './artifactKit';

/** 网页自带的样式和动效（2026-10-11）：塞在编码和安全策略后面、网页自己的样式前面，只有一份，能去掉 */

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="x"><title>t</title><style>body{color:red}</style></head><body><main class="hk-page">内容</main></body></html>';

describe('组件库', () => {
  it('塞在开头那几个 meta 后面、网页自己的样式前面；重复塞也只有一份；去掉后和原来一样', () => {
    const once = injectArtifactKit(PAGE);
    expect(once.indexOf('data-hakcc-kit')).toBeGreaterThan(once.indexOf('Content-Security-Policy'));
    expect(once.indexOf('<style data-hakcc-kit>')).toBeLessThan(once.indexOf('<style>body{color:red}'));
    const twice = injectArtifactKit(once);
    expect(twice.match(/<style data-hakcc-kit>/g)).toHaveLength(1);
    expect(twice.match(/<script data-hakcc-kit>/g)).toHaveLength(1);
    expect(stripArtifactKit(twice).replace(/\s+/g, '')).toBe(PAGE.replace(/\s+/g, ''));
  });

  it('没有 head 的片段也能塞；脚本是合法的 JS，不会把 </style>、</script> 提前截断', () => {
    expect(injectArtifactKit('<p>片段</p>').startsWith('<style data-hakcc-kit>')).toBe(true);
    expect(() => new Function(KIT_JS)).not.toThrow();
    expect(KIT_JS).not.toMatch(/<\/script/i);
    expect(KIT_CSS).not.toMatch(/<\/style/i);
    // 不联网、不用存储
    expect(KIT_JS).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
  });

  it('脚本没跑起来时内容照样看得见（动效只在 html.hk-js 下）；系统要求减少动态效果时不做动画', () => {
    expect(KIT_CSS).toMatch(/html\.hk-js \.hk-reveal\{opacity:0/);
    expect(KIT_CSS).not.toMatch(/(^|\})\.hk-reveal\{opacity:0/);
    expect(KIT_CSS).toContain('prefers-reduced-motion:reduce');
    expect(KIT_CSS).toContain('prefers-color-scheme:dark');
  });

  it('给写网页的模型的说明里有骨架、滚动出现、页签、自测题、留空让学生写这几样', () => {
    for (const word of ['hk-page', 'hk-hero', 'hk-reveal', 'data-hk-stagger', 'data-hk-tabs', 'data-hk-quiz', 'hk-write', 'hk-footer']) {
      expect(KIT_GUIDE).toContain(word);
    }
  });
});
