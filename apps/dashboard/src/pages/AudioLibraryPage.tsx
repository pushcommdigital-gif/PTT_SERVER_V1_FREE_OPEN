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
import { useState, useRef } from 'react';
import { useAudioLibrary, type AudioData } from '../hooks/useAudioLibrary';
import { useDebounce } from '../hooks/useDebounce';
import { AudioUploadModal } from '../components/audio/AudioUploadModal';
import { ConfirmDialog, DataTable, Pagination, Badge, Button } from '../components/ui';
import { apiFetch } from '../lib/api';
import { Upload, Play, Square, Trash2 } from 'lucide-react';
import { AUDIO_CATEGORY_COLORS } from '@pushcomm/shared';
import type { Column } from '../components/ui/DataTable';

const CATEGORY_TABS = [
  { key: 'all', label: 'All' },
  { key: 'emergency', label: 'Emergency' },
  { key: 'alert', label: 'Alert' },
  { key: 'standard', label: 'Standard' },
  { key: 'info', label: 'Info' },
  { key: 'custom', label: 'Custom' },
] as const;

function formatSize(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: string | null) {
  if (!seconds) return '—';
  const sec = parseFloat(seconds);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioLibraryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const debouncedSearch = useDebounce(search, 300);

  const { audioFiles, pagination, loading, refetch } = useAudioLibrary({
    page,
    limit: 20,
    search: debouncedSearch,
    category: categoryFilter,
  });

  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AudioData | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function handlePlay(audio: AudioData) {
    if (playingId === audio.id) {
      // Stop
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingId(null);
    } else {
      // Stop previous
      audioRef.current?.pause();
      // Play new
      const el = new Audio(`/api/audio-library/${audio.id}/stream`);
      el.onended = () => setPlayingId(null);
      el.play();
      audioRef.current = el;
      setPlayingId(audio.id);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await apiFetch(`/audio-library/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    refetch();
  }

  const columns: Column<AudioData>[] = [
    {
      key: 'play',
      header: '',
      render: (audio) => (
        <button
          onClick={() => handlePlay(audio)}
          className="p-1.5 text-text-secondary hover:text-accent rounded transition-colors"
        >
          {playingId === audio.id ? <Square size={16} /> : <Play size={16} />}
        </button>
      ),
    },
    {
      key: 'filename',
      header: 'Filename',
      render: (audio) => <span className="font-medium">{audio.filename}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      render: (audio) => {
        const color = AUDIO_CATEGORY_COLORS[audio.category as keyof typeof AUDIO_CATEGORY_COLORS] || '#95a5a6';
        return (
          <span
            className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
            style={{ backgroundColor: color }}
          >
            {audio.category.toUpperCase()}
          </span>
        );
      },
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (audio) => <span className="text-text-secondary">{formatDuration(audio.duration)}</span>,
    },
    {
      key: 'fileSize',
      header: 'Size',
      render: (audio) => <span className="text-text-secondary">{formatSize(audio.fileSize)}</span>,
    },
    {
      key: 'uploadedBy',
      header: 'Uploaded By',
      render: (audio) => (
        <span className="text-text-secondary text-sm">
          {audio.uploaderFirstName ? `${audio.uploaderFirstName} ${audio.uploaderLastName}` : '—'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Date',
      render: (audio) => (
        <span className="text-text-secondary text-sm">
          {new Date(audio.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (audio) => (
        <button
          onClick={() => setDeleteTarget(audio)}
          className="p-1.5 text-text-secondary hover:text-danger rounded transition-colors"
        >
          <Trash2 size={14} />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audio Library</h1>
          <p className="text-text-secondary mt-1">
            {pagination?.total ?? 0} audio file{(pagination?.total ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload size={16} className="mr-1.5" />
          Upload
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search audio files..."
          className="w-64 rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-white placeholder:text-text-secondary focus:border-accent focus:outline-none"
        />

        <div className="flex gap-1 bg-bg-card rounded-lg p-1 border border-border">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setCategoryFilter(tab.key); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                categoryFilter === tab.key
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <DataTable columns={columns} data={audioFiles} keyExtractor={(a) => a.id} loading={loading} />

      {pagination && pagination.totalPages > 1 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onPageChange={setPage}
        />
      )}

      <AudioUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={refetch}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Audio File"
        message={`Are you sure you want to delete "${deleteTarget?.filename}"? The file will be permanently removed.`}
      />
    </div>
  );
}
