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
import { CheckSquare, Square, User } from 'lucide-react';

interface MemberRowProps {
  userId: string;
  name: string;
  role: string;
  isOnline?: boolean;
  isAdmin?: boolean;
  selected?: boolean;
  onToggle?: (user: { id: string; name: string }) => void;
}

export function MemberRow({ userId, name, role, isOnline, selected, onToggle }: MemberRowProps) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded transition-colors cursor-pointer ${
        selected ? 'bg-accent/10' : 'hover:bg-white/5'
      }`}
      onClick={() => onToggle?.({ id: userId, name })}
    >
      {onToggle && (
        <span className={`shrink-0 ${selected ? 'text-accent' : 'text-text-secondary/50'}`}>
          {selected ? <CheckSquare size={13} /> : <Square size={13} />}
        </span>
      )}
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          isOnline ? 'bg-success' : 'bg-text-secondary/40'
        }`}
      />
      <span className="text-xs text-white truncate flex-1">{name}</span>
      <span className="text-[10px] text-text-secondary uppercase shrink-0">{role}</span>
    </div>
  );
}
