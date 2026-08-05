import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { apiFetch, ApiError } from '../../lib/api';
import { useGroupTypes } from '../../hooks/useGroupTypes';

interface GroupData {
  id: string;
  name: string;
  type: string;
  description: string | null;
}

interface GroupFormModalProps {
  open: boolean;
  onClose: () => void;
  group: GroupData | null;
  onSuccess: () => void;
  defaultType?: string;
}

export function GroupFormModal({ open, onClose, group, onSuccess, defaultType }: GroupFormModalProps) {
  const { groupTypes } = useGroupTypes();

  const typeOptions = useMemo(() => {
    const base = groupTypes
      // Delivery-focused defaults: keep Team, plus any owner-created custom types.
      .filter((gt) => gt.name === 'team' || !gt.isSystem)
      .map((gt) => ({ value: gt.name, label: gt.displayName }));

    if (group && !base.some((opt) => opt.value === group.type)) {
      base.unshift({ value: group.type, label: group.type });
    }

    return base;
  }, [groupTypes, group]);
  const isEdit = !!group;
  const [name, setName] = useState('');
  const [type, setType] = useState('group');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (group) {
        setName(group.name);
        setType(group.type);
        setDescription(group.description || '');
      } else {
        setName('');
        setType(defaultType || 'group');
        setDescription('');
      }
      setError('');
    }
  }, [open, group]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isEdit) {
        await apiFetch(`/groups/${group!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, type, description: description || undefined }),
        });
      } else {
        await apiFetch('/groups', {
          method: 'POST',
          body: JSON.stringify({ name, type, description: description || undefined }),
        });
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save group');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Group' : 'Create Group'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <Input id="name" label="Group Name" value={name} onChange={(e) => setName(e.target.value)} required />

        <Select id="type" label="Type" value={type} onChange={(e) => setType(e.target.value)} options={typeOptions} />

        <div className="space-y-1">
          <label htmlFor="description" className="block text-sm font-medium text-text-secondary">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg bg-bg-primary border border-border px-3 py-2 text-sm text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-none"
            placeholder="Optional description"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Save Changes' : 'Create Group'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
