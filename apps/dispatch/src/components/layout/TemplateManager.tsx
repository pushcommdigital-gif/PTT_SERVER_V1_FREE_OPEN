/*
 * PushComm Community Edition
 * Copyright (C) 2026 Corbani Mauro
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, LayoutTemplate, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useLayout } from '../../contexts/LayoutContext';

export function TemplateManager() {
  const layout = useLayout();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setTemplates(layout.listTemplates());
  }, [layout]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSave = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    layout.saveTemplate(name);
    setNewName('');
    setSaving(false);
    refresh();
  }, [layout, newName, refresh]);

  const handleLoad = useCallback((name: string) => {
    layout.loadTemplate(name);
    setOpen(false);
  }, [layout]);

  const handleDelete = useCallback((name: string) => {
    layout.deleteTemplate(name);
    refresh();
  }, [layout, refresh]);

  return (
    <div className="relative" ref={dropRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary hover:text-white transition-colors cursor-pointer"
        title="Interface Templates"
      >
        <LayoutTemplate size={14} />
        <span className="hidden sm:inline">Templates</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-border bg-bg-sidebar shadow-xl z-50">
          <div className="p-2 border-b border-border">
            <p className="text-[10px] uppercase text-text-secondary tracking-wide font-semibold mb-1.5">
              Interface Templates
            </p>
            <button
              onClick={() => { layout.resetLayout(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-secondary hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} />
              Reset to Default
            </button>
          </div>

          <div className="max-h-40 overflow-y-auto p-1">
            {templates.length === 0 ? (
              <p className="text-[11px] text-text-secondary px-2 py-2 text-center">No saved templates.</p>
            ) : (
              templates.map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-1 rounded hover:bg-white/5 transition-colors"
                >
                  <button
                    onClick={() => handleLoad(name)}
                    className="flex-1 text-left text-xs text-white px-2 py-1.5 truncate cursor-pointer"
                  >
                    {name}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(name); }}
                    className="p-1 text-text-secondary hover:text-danger cursor-pointer shrink-0"
                    title="Delete template"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="p-2 border-t border-border">
            {saving ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  placeholder="Template name"
                  className="flex-1 bg-bg-primary border border-border rounded px-2 py-1 text-xs text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={handleSave}
                  className="px-2 py-1 rounded bg-accent text-white text-xs cursor-pointer"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSaving(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-accent hover:bg-accent/10 transition-colors cursor-pointer"
              >
                <Plus size={12} />
                Save current layout
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
