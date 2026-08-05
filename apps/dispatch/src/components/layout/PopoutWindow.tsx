import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Renders `children` into a real, separate browser window (window.open) so a dispatch
// panel can live on another monitor — something a position:absolute element inside the
// page can never do. Because it's a React portal, the child stays in the same React
// tree: all contexts (Voice, Auth, WebSocket, Layout) keep working. Only CSS must be
// copied into the child document.
function copyStyles(dst: Document) {
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    dst.head.appendChild(node.cloneNode(true));
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

  useEffect(() => {
    const features =
      `width=${Math.round(width)},height=${Math.round(height)}` +
      (left != null ? `,left=${Math.round(left)}` : '') +
      (top != null ? `,top=${Math.round(top)}` : '');
    const win = window.open('', '', features);
    if (!win) {
      // Popup blocked — tell the user and re-dock.
      alert('Pop-out was blocked by the browser. Allow pop-ups for this site to move a panel to another window.');
      onClose();
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

    // Closing the child window (OS chrome, Ctrl-W) re-docks the panel.
    win.addEventListener('beforeunload', onClose);
    return () => {
      win.removeEventListener('beforeunload', onClose);
      win.close();
    };
    // Open exactly once; size/pos are only the initial hints (user moves it after).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return host ? createPortal(children, host) : null;
}
