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
// tree: all contexts (Voice, Auth, WebSocket, Layout) keep working. Only the document
// shell and CSS must be set up in the child window.

/** Static, script-free host page served from our own origin. See public/popout.html. */
const POPOUT_URL = '/popout.html';

function cloneStyleNode(node: Node): HTMLElement {
  const clone = node.cloneNode(true) as HTMLElement;
  if (clone instanceof HTMLLinkElement) {
    const href = clone.getAttribute('href');
    // Resolve against the opener so the child never depends on its own base URL.
    if (href) clone.href = new URL(href, document.baseURI).href;
  }
  return clone;
}

function copyStyles(dst: Document): void {
  document.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]').forEach((node) => {
    dst.head.appendChild(cloneStyleNode(node));
  });
}

/**
 * Mirror the opener's root/body presentation onto the popup.
 *
 * The console's white text comes from an inline `color` on <body>, and any
 * element that inherits its colour rather than setting an explicit token would
 * otherwise fall back to the browser default — black text on our dark
 * background, unreadable. popout.html already declares these, but copying them
 * keeps the two in step if one drifts.
 */
function syncShell(dst: Document): void {
  const srcHtml = document.documentElement;
  const srcBody = document.body;

  dst.documentElement.className = srcHtml.className;
  dst.body.className = srcBody.className;

  const { color, backgroundColor } = getComputedStyle(srcBody);
  dst.documentElement.style.background = backgroundColor;
  dst.body.style.background = backgroundColor;
  dst.body.style.color = color;
  dst.body.style.margin = '0';
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
    // `popup=yes` asks for a chromeless window rather than a tab. The browser
    // still shows the origin for security — that's fine and expected; what we
    // avoid by not using about:blank is it reading as a broken page.
    const features =
      `popup=yes,width=${Math.round(width)},height=${Math.round(height)}` +
      (left != null ? `,left=${Math.round(left)}` : '') +
      (top != null ? `,top=${Math.round(top)}` : '');
    const win = window.open(POPOUT_URL, '', features);
    if (!win) {
      // Popup blocked — tell the user and re-dock.
      alert('Pop-out was blocked by the browser. Allow pop-ups for this site to move a panel to another window.');
      onCloseRef.current();
      return;
    }

    let observer: MutationObserver | undefined;
    let cancelled = false;

    // Because we navigate to a real URL, the window starts on its initial
    // about:blank and swaps documents when popout.html arrives. Setting up
    // before that lands would have our nodes thrown away with the old document.
    const setup = () => {
      if (cancelled || !win.document) return;
      win.document.title = `PushComm · ${title}`;
      syncShell(win.document);
      copyStyles(win.document);

      const mount =
        win.document.getElementById('popout-root') ??
        win.document.body.appendChild(win.document.createElement('div'));
      mount.style.cssText = 'width:100vw;height:100vh;overflow:hidden;';
      setHost(mount);

      // Vite injects <style> tags as it hot-updates, and the production build
      // can still add a sheet after first paint. Mirror later additions so the
      // popup doesn't drift out of style with the console.
      observer = new MutationObserver((records) => {
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
    };

    if (win.document.readyState === 'complete' && win.location.pathname === POPOUT_URL) {
      setup();
    } else {
      win.addEventListener('load', setup, { once: true });
    }

    const handleChildClose = () => onCloseRef.current();
    win.addEventListener('beforeunload', handleChildClose);

    // Without this, reloading or closing the console leaves the popped-out
    // window orphaned on the other monitor: still on screen, but portalled from
    // a React tree that no longer exists, so it is frozen and never updates
    // again. Close our children when we go.
    const closeChild = () => win.close();
    window.addEventListener('pagehide', closeChild);

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener('pagehide', closeChild);
      win.removeEventListener('beforeunload', handleChildClose);
      win.removeEventListener('load', setup);
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
