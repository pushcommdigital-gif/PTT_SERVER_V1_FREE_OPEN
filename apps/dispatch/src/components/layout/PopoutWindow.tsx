/*
 * PushComm Community Edition
 * Copyright (C) 2026 PushComm Digital
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Renders `children` into a real, separate browser window (window.open) so a dispatch
// panel can live on another monitor — something a position:absolute element inside the
// page can never do. Because it's a React portal, the child stays in the same React
// tree: all contexts (Voice, Auth, WebSocket, Layout) keep working. Only CSS must be
// copied into the child document.

/**
 * Clone the opener's stylesheets into the popup.
 *
 * `window.open('')` gives an about:blank document. A cloned
 * `<link href="/assets/index-abc.css">` is a RELATIVE URL, and depending on how
 * the browser assigns that document's base URL it may not resolve — which shows
 * up as a popped-out panel rendering completely unstyled. Resolving every href
 * against the opener's location first makes it deterministic.
 */
function cloneStyleNode(node: Node): HTMLElement {
  const clone = node.cloneNode(true) as HTMLElement;
  if (clone instanceof HTMLLinkElement) {
    const href = clone.getAttribute('href');
    if (href) clone.href = new URL(href, document.baseURI).href;
  }
  return clone;
}

function copyStyles(dst: Document): void {
  document.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]').forEach((node) => {
    dst.head.appendChild(cloneStyleNode(node));
  });
}

export function PopoutWindow({
  title, width, height, left, top, onClose, children,
}: {
  title: string;
  width: number;
  height: number;
  left?: number;
  top?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  // The open effect runs once, so reading onClose through a ref keeps it from
  // capturing the first render's closure and going stale.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const features =
      `width=${Math.round(width)},height=${Math.round(height)}` +
      (left != null ? `,left=${Math.round(left)}` : '') +
      (top != null ? `,top=${Math.round(top)}` : '');
    const win = window.open('', '', features);
    if (!win) {
      // Popup blocked — tell the user and re-dock.
      alert('Pop-out was blocked by the browser. Allow pop-ups for this site to move a panel to another window.');
      onCloseRef.current();
      return;
    }
    win.document.title = `PushComm · ${title}`;
    copyStyles(win.document);
    win.document.documentElement.style.background = '#1a1d23';
    win.document.body.style.margin = '0';
    win.document.body.style.background = '#1a1d23';
    const div = win.document.createElement('div');
    div.style.cssText = 'width:100vw;height:100vh;overflow:hidden;';
    win.document.body.appendChild(div);
    setHost(div);

    // Vite injects <style> tags as it hot-updates, and the production build can
    // still add a sheet after first paint. Mirror later additions so the popup
    // doesn't drift out of style with the console.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (
            node instanceof HTMLStyleElement ||
            (node instanceof HTMLLinkElement && node.rel === 'stylesheet')
          ) {
            win.document.head.appendChild(cloneStyleNode(node));
          }
        });
      }
    });
    observer.observe(document.head, { childList: true });

    const handleChildClose = () => onCloseRef.current();
    win.addEventListener('beforeunload', handleChildClose);

    // Without this, reloading or closing the console leaves the popped-out
    // window orphaned on the other monitor: still on screen, but portalled from
    // a React tree that no longer exists, so it is frozen and never updates
    // again. Close our children when we go.
    const closeChild = () => win.close();
    window.addEventListener('pagehide', closeChild);

    return () => {
      observer.disconnect();
      window.removeEventListener('pagehide', closeChild);
      win.removeEventListener('beforeunload', handleChildClose);
      win.close();
    };
    // Open exactly once; size/pos are only the initial hints (user moves it after).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the OS window title in step if the panel's title changes.
  useEffect(() => {
    const doc = host?.ownerDocument;
    if (doc) doc.title = `PushComm · ${title}`;
  }, [host, title]);

  return host ? createPortal(children, host) : null;
}
