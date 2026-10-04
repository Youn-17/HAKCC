import { useEffect, useRef } from 'react';

type Conv = (text: string) => string;

// opencc-js carries ~470KB of conversion dictionaries — over half the dashboard
// bundle. Only zh-TW readers need it, so it is fetched on first activation.
let converterPromise: Promise<Conv> | null = null;

function getConverter(): Promise<Conv> {
  if (!converterPromise) {
    converterPromise = import('opencc-js')
      .then(({ Converter }) => Converter({ from: 'cn', to: 'tw' }) as Conv)
      .catch((err) => {
        converterPromise = null; // allow a retry on the next activation
        throw err;
      });
  }
  return converterPromise;
}

function convertTextNodes(root: Node, conv: (s: string) => string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeValue) {
      const converted = conv(node.nodeValue);
      if (converted !== node.nodeValue) node.nodeValue = converted;
    }
  }
}

export function useTraditionalChinese(active: boolean) {
  const observerRef = useRef<MutationObserver | null>(null);
  const convertingRef = useRef(false);

  useEffect(() => {
    if (!active) {
      observerRef.current?.disconnect();
      observerRef.current = null;
      return;
    }

    let cancelled = false;

    getConverter().then((conv) => {
      // The user may have switched away (or unmounted) while the chunk loaded.
      if (cancelled) return;

      const root = document.getElementById('root') ?? document.body;

      convertingRef.current = true;
      convertTextNodes(root, conv);
      convertingRef.current = false;

      const observer = new MutationObserver((mutations) => {
        if (convertingRef.current) return;
        convertingRef.current = true;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            convertTextNodes(node, conv);
          }
          if (mutation.type === 'characterData' && mutation.target.nodeValue) {
            const converted = conv(mutation.target.nodeValue);
            if (converted !== mutation.target.nodeValue) {
              mutation.target.nodeValue = converted;
            }
          }
        }
        convertingRef.current = false;
      });

      observer.observe(root, { childList: true, subtree: true, characterData: true });
      observerRef.current = observer;
    }).catch(() => {
      // Conversion is cosmetic: on failure the UI stays in Simplified Chinese.
    });

    return () => {
      cancelled = true;
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [active]);
}
