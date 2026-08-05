import { useState, useEffect, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { apiUpload } from '../../lib/api';
import { AUDIO_CATEGORIES } from '@pushcomm/shared';
import { Upload } from 'lucide-react';

interface AudioUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AudioUploadModal({ open, onClose, onSuccess }: AudioUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('standard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setCategory('standard');
      setError('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', category);

      await apiUpload('/audio-library', formData);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <Modal open={open} onClose={onClose} title="Upload Audio File">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {/* File drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent transition-colors"
        >
          <Upload size={32} className="mx-auto text-text-secondary mb-2" />
          {file ? (
            <div>
              <p className="font-medium">{file.name}</p>
              <p className="text-text-secondary text-sm">{formatSize(file.size)}</p>
            </div>
          ) : (
            <div>
              <p className="text-text-secondary">Click to select an audio file</p>
              <p className="text-text-secondary text-xs mt-1">MP3, WAV, OGG, M4A, WebM — max 10MB</p>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="hidden"
          />
        </div>

        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={AUDIO_CATEGORIES.map((c) => ({
            value: c,
            label: c.charAt(0).toUpperCase() + c.slice(1),
          }))}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading} disabled={!file}>
            Upload
          </Button>
        </div>
      </form>
    </Modal>
  );
}
