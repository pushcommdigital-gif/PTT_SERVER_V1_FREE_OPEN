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

// Renders `children` into a real, separate OS window so a dispatch panel can live
// on another monitor — something a position:absolute element inside the page can
// never do. Because it's a React portal, the child stays in the same React tree:
// all contexts (Voice, Auth, WebSocket, Layout) keep working. Only the document
// shell and CSS have to be set up in the child window.
//
// ── On removing the address bar ──────────────────────────────────────────────
// A normal `window.open` popup ALWAYS shows its origin. Browsers enforce that
// deliberately so a page can't open a chromeless window and paint a convincing
// fake of someone else's site; there is no flag, feature string or permission
// that turns it off.
//
// The one standards-based way to get a genuinely chromeless window is the
// Document Picture-in-Picture API, so we prefer it and fall back to a popup.
// Its constraints, which are why the fallback has to stay:
//   • Chromium-only (Chrome/Edge 116+). No Firefox or Safari.
//   • Exactly ONE such window per document. Requesting a second CLOSES the
//     first, so only the first detached panel may use it — see pipInUse below.
//   • Always-on-top. Good for a PTT widget, possibly unwanted for a big list.

/** Static, script-free host page served from our own origin. See public/popout.html. */
const POPOUT_URL = '/popout.html';

/**
 * Only the first detached panel may take the Picture-in-Picture window, because
 * requesting a second one would silently close the first and make that panel
 * disappear. Everything after it gets an ordinary popup.
 */
let pipInUse = false;

interface DocumentPipWindow {
  requestWindow(opts: { width: number; height: number }): Promise<Window>;
}

function getDocumentPip(): DocumentPipWindow | null {
  const api = (window as unknown as { documentPictureInPicture?: DocumentPipWindow })
    .documentPictureInPicture;
  return api && typeof api.requestWindow === 'function' ? api : null;
}

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
 * Mirror the opener's root/body presentation onto the child window.
 *
 * The console's white text comes from an inline `color` on <body>, so anything
 * that inherits its colour rather than setting an explicit token would
 * otherwise fall back to the browser default — black text on our dark
 * background, unreadable. The Picture-in-Picture document starts completely
 * empty, so this is the only thing that styles it at all.
 */
function syncShell(dst: Document): void {
  dst.documentElement.className = document.documentElement.className;
  dst.body.className = document.body.className;

  const { color, backgroundColor } = getComputedStyle(document.body);
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
    let cancelled = false;
    let win: Window | null = null;
    let observer: MutationObserver | undefined;
    let closedPoll: number | undefined;
    let notified = false;
    let releasePip: (() => void) | undefined;

    const notifyClosed = () => {
      if (notified) return;
      notified = true;
      onCloseRef.current();
    };

    /** Style the child document and mount the portal host into it. */
    const attach = (w: Window) => {
      if (cancelled) return;
      w.document.title = `PushComm · ${title}`;
      syncShell(w.document);
      copyStyles(w.document);

      const mount =
        w.document.getElementById('popout-root') ??
        w.document.body.appendChild(w.document.createElement('div'));
      mount.style.cssText = 'width:100vw;height:100vh;overflow:hidden;';
      setHost(mount);

      // Vite injects <style> tags as it hot-updates, and the production build
      // can still add a sheet after first paint. Mirror later additions so the
      // detached panel doesn't drift out of style with the console.
      observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => {
            if (
              node instanceof HTMLStyleElement ||
              (node instanceof HTMLLinkElement && node.rel === 'stylesheet')
            ) {
              w.document.head.appendChild(cloneStyleNode(node));
            }
          });
        }
      });
      observer.observe(document.head, { childList: true });

      // Detect the operator closing the window, so the panel returns to the
      // console instead of vanishing from both places.
      //
      // Polling `closed` rather than listening for 'beforeunload': listeners
      // live on a DOCUMENT, and a popup navigates from its initial about:blank
      // to popout.html, which destroys anything registered before that. A
      // handler attached at open time is silently thrown away, and closing the
      // window then leaves the panel hidden with no way back short of reloading
      // the whole console. 'beforeunload' is not guaranteed to fire either.
      // Checking `closed` catches every case, for both window types.
      closedPoll = window.setInterval(() => {
        if (w.closed) {
          window.clearInterval(closedPoll);
          notifyClosed();
        }
      }, 300);
    };

    void (async () => {
      // Preferred: a chromeless Picture-in-Picture window (no address bar).
      const pip = getDocumentPip();
      if (pip && !pipInUse) {
        pipInUse = true;
        releasePip = () => { pipInUse = false; };
        try {
          const w = await pip.requestWindow({
            width: Math.round(width),
            height: Math.round(height),
          });
          if (cancelled) { w.close(); releasePip(); return; }
          win = w;
          attach(w);
          return;
        } catch {
          // Not permitted (needs a user gesture), already in use, or refused.
          // Fall through to a popup rather than leaving the panel stranded.
          releasePip();
          releasePip = undefined;
        }
      }

      if (cancelled) return;

      const features =
        `popup=yes,width=${Math.round(width)},height=${Math.round(height)}` +
        (left != null ? `,left=${Math.round(left)}` : '') +
        (top != null ? `,top=${Math.round(top)}` : '');
      const w = window.open(POPOUT_URL, '', features);
      if (!w) {
        alert('Detaching was blocked by the browser. Allow pop-ups for this site to move a panel to another window.');
        notifyClosed();
        return;
      }
      win = w;
      // The window navigates away from its initial about:blank, so wait for the
      // real document before mounting anything into it.
      if (w.document.readyState === 'complete' && w.location.pathname === POPOUT_URL) {
        attach(w);
      } else {
        w.addEventListener('load', () => attach(w), { once: true });
      }
    })();

    // Without this, reloading or closing the console leaves the detached window
    // orphaned on the other monitor: still on screen, but portalled from a React
    // tree that no longer exists, so it is frozen and never updates again.
    const closeChild = () => win?.close();
    window.addEventListener('pagehide', closeChild);

    return () => {
      cancelled = true;
      // Stop the poll BEFORE closing, or our own teardown trips it and calls
      // back into a component that is already unmounting.
      if (closedPoll !== undefined) window.clearInterval(closedPoll);
      notified = true;
      observer?.disconnect();
      window.removeEventListener('pagehide', closeChild);
      releasePip?.();
      win?.close();
    };
    // Open exactly once; size/pos are only the initial hints (the operator
    // moves it afterwards).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the OS window title in step if the panel's title changes.
  useEffect(() => {
    const doc = host?.ownerDocument;
    if (doc) doc.title = `PushComm · ${title}`;
  }, [host, title]);

  return host ? createPortal(children, host) : null;
}
