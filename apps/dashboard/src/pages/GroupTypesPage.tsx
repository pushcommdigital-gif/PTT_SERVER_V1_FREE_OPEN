import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useGroupTypes, type GroupTypeData } from '../hooks/useGroupTypes';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { apiFetch, ApiError } from '../lib/api';
import { FolderPlus, Pencil, Trash2, Lock } from 'lucide-react';

const PRESET_COLORS = ['#6b7280', '#e67e22', '#3498db', '#27ae60', '#e74c3c', '#9b59b6', '#1abc9c', '#f39c12'];

function GroupTypeFormModal({
  open,
  onClose,
  groupType,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  groupType: GroupTypeData | null;
  onSuccess: () => void;
}) {
  const isEdit = !!groupType;
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6b7280');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (groupType) {
        setDisplayName(groupType.displayName);
        setDescription(groupType.description || '');
        setColor(groupType.color);
      } else {
        setDisplayName('');
        setDescription('');
        setColor('#6b7280');
      }
      setError('');
    }
  }, [open, groupType]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isEdit) {
        await apiFetch(`/group-types/${groupType!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ displayName, description: description || undefined, color }),
        });
      } else {
        const name = displayName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        await apiFetch('/group-types', {
          method: 'POST',
          body: JSON.stringify({ name, displayName, description: description || undefined, color }),
        });
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save group type');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Group Type' : 'Create Group Type'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        <Input
          id="displayName"
          label="Display Name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g., Precinct, Bureau"
          required
        />

        <div className="space-y-1">
          <label htmlFor="description" className="block text-sm font-medium text-text-secondary">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg bg-bg-primary border border-border px-3 py-2 text-sm text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-none"
            placeholder="Optional description"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-text-secondary">Badge Color</label>
          <div className="flex gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-lg cursor-pointer transition-all ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-bg-primary' : 'hover:scale-110'}`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent"
            />
          </div>
          <div className="mt-2">
            <span className="text-xs text-text-secondary mr-2">Preview:</span>
            <Badge style={{ backgroundColor: color, color: 'white' }}>{displayName || 'Type'}</Badge>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Save Changes' : 'Create Type'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function GroupTypesPage() {
  const { groupTypes, loading, refetch } = useGroupTypes();
  const [createOpen, setCreateOpen] = useState(false);
  const [editType, setEditType] = useState<GroupTypeData | null>(null);
  const [deleteType, setDeleteType] = useState<GroupTypeData | null>(null);

  async function handleDelete() {
    if (!deleteType) return;
    await apiFetch(`/group-types/${deleteType.id}`, { method: 'DELETE' });
    setDeleteType(null);
    refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Group Types</h1>
          <p className="text-text-secondary mt-1">Manage the types available when creating groups</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <FolderPlus size={18} /> Create Type
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groupTypes.map((gt) => (
            <Card key={gt.id}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: gt.color }}
                  >
                    {gt.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{gt.displayName}</h3>
                      {gt.isSystem && (
                        <span title="System type"><Lock size={14} className="text-text-secondary" /></span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary">{gt.name}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setEditType(gt)}
                    className="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-white cursor-pointer"
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  {!gt.isSystem && (
                    <button
                      onClick={() => setDeleteType(gt)}
                      className="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-danger cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
              {gt.description && (
                <p className="text-sm text-text-secondary mt-2">{gt.description}</p>
              )}
              <div className="mt-3">
                <Badge style={{ backgroundColor: gt.color, color: 'white' }}>{gt.displayName}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      <GroupTypeFormModal
        open={createOpen || !!editType}
        onClose={() => {
          setCreateOpen(false);
          setEditType(null);
        }}
        groupType={editType}
        onSuccess={refetch}
      />

      <ConfirmDialog
        open={!!deleteType}
        onClose={() => setDeleteType(null)}
        onConfirm={handleDelete}
        title="Delete Group Type"
        message={`Are you sure you want to delete the "${deleteType?.displayName}" group type? Groups using this type will keep their current type value.`}
      />
    </div>
  );
}
