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
import { MapPin } from 'lucide-react';
import { getAccessToken } from '../../lib/api';
import { useLayout } from '../../contexts/LayoutContext';
import type { MessageData } from '../../hooks/useMessages';

interface MessageBubbleProps {
  message: MessageData;
  isSent: boolean;
  showSender?: boolean;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({ message, isSent, showSender }: MessageBubbleProps) {
  const { setMapDestination } = useLayout();
  const isAudio = message.body === '[audio]';
  const isImage = message.body.startsWith('[image]');
  const isLocation = message.body.startsWith('[location]');
  const imagePath = isImage ? message.body.slice('[image]'.length) : '';
  const imageToken = encodeURIComponent(getAccessToken() ?? '');
  const imageSrc = isImage
    ? `${imagePath}${imagePath.includes('?') ? '&' : '?'}token=${imageToken}`
    : '';

  let locationCard: React.ReactNode = null;
  if (isLocation) {
    const coords = message.body.slice('[location]'.length);
    const [latStr, lonStr] = coords.split(',');
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    const valid = !isNaN(lat) && !isNaN(lon);
    locationCard = (
      <button
        onClick={() => valid && setMapDestination({ lat, lon })}
        className="flex items-center gap-2 rounded-md bg-white/10 hover:bg-white/20 px-3 py-2 transition-colors text-left w-full cursor-pointer"
        title="Show on map"
      >
        <MapPin size={18} className="text-green-400 shrink-0" />
        <div>
          <p className="text-xs font-medium text-white">Location</p>
          {valid ? (
            <p className="text-[10px] text-text-secondary font-mono">
              {lat.toFixed(5)}, {lon.toFixed(5)}
            </p>
          ) : (
            <p className="text-[10px] text-text-secondary">Invalid coordinates</p>
          )}
          <p className="text-[9px] text-green-400/70 mt-0.5">Tap to show on map</p>
        </div>
      </button>
    );
  }

  return (
    <div className={`flex ${isSent ? 'justify-end' : 'justify-start'} mb-1.5`}>
      <div
        className={`max-w-[80%] rounded-lg px-2.5 py-1.5 ${
          isSent ? 'bg-accent/20 text-white' : 'bg-white/5 text-white'
        }`}
      >
        {showSender && !isSent && (
          <p className="text-[10px] font-medium text-accent mb-0.5">
            {message.senderFirstName} {message.senderLastName}
          </p>
        )}
        {isAudio ? (
          <audio
            controls
            src={`/api/messages/${message.id}/audio?token=${encodeURIComponent(getAccessToken() ?? '')}`}
            className="h-8 max-w-[220px]"
            style={{ accentColor: '#e67e22' }}
          />
        ) : isImage ? (
          <img
            src={imageSrc}
            alt="Message attachment"
            className="max-h-64 max-w-[260px] rounded-md object-cover border border-white/10"
          />
        ) : isLocation ? (
          locationCard
        ) : (
          <p className="text-xs whitespace-pre-wrap break-words">{message.body}</p>
        )}
        <p className={`text-[9px] mt-0.5 ${isSent ? 'text-accent/50' : 'text-text-secondary/50'} text-right`}>
          {formatTime(message.createdAt)}
          {isSent && message.isRead && ' \u2713'}
        </p>
      </div>
    </div>
  );
}
