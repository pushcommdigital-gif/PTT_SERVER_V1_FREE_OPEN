import { useState, useEffect, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { apiFetch, ApiError } from '../../lib/api';
import type { RoleData } from '../../hooks/useRoles';

const PRESET_COLORS = [
  '#e74c3c', '#e67e22', '#f39c12', '#27ae60',
  '#2ecc71', '#3498db', '#2980b9', '#9b59b6',
  '#8e44ad', '#1abc9c', '#16a085', '#6b7280',
];

interface RoleFormModalProps {
  open: boolean;
  onClose: () => void;
  role: RoleData | null;
  onSuccess: () => void;
}

export function RoleFormModal({ open, onClose, role, onSuccess }: RoleFormModalProps) {
  const isEdit = !!role;
  const [displayName, setDisplayName] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hierarchyLevel, setHierarchyLevel] = useState(10);
  const [color, setColor] = useState('#6b7280');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (role) {
        setDisplayName(role.displayName);
        setName(role.name);
        setDescription(role.description || '');
        setHierarchyLevel(role.hierarchyLevel);
        setColor(role.color);
      } else {
        setDisplayName('');
        setName('');
        setDescription('');
        setHierarchyLevel(10);
        setColor('#6b7280');
      }
      setError('');
    }
  }, [open, role]);

  function handleDisplayNameChange(value: string) {
    setDisplayName(value);
    if (!isEdit) {
      setName(value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isEdit) {
        await apiFetch(`/roles/${role!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ displayName, description: description || undefined, hierarchyLevel, color }),
        });
      } else {
        if (!name || !displayName) {
          setError('Display name is required');
          setLoading(false);
          return;
        }
        await apiFetch('/roles', {
          method: 'POST',
          body: JSON.stringify({ name, displayName, description: description || undefined, hierarchyLevel, color }),
        });
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save role');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Role' : 'Create Role'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <Input
          id="displayName"
          label="Display Name"
          value={displayName}
          onChange={(e) => handleDisplayNameChange(e.target.value)}
          required
          placeholder="e.g. Captain, Supervisor"
        />

        {!isEdit && (
          <Input
            id="name"
            label="Internal Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Auto-generated from display name"
          />
        )}

        <Input
          id="description"
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
        />

        <div>
          <label htmlFor="hierarchyLevel" className="block text-sm font-medium mb-1.5">
            Hierarchy Level ({hierarchyLevel})
          </label>
          <input
            id="hierarchyLevel"
            type="range"
            min={0}
            max={99}
            value={hierarchyLevel}
            onChange={(e) => setHierarchyLevel(parseInt(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-xs text-text-secondary mt-1">
            <span>0 (lowest)</span>
            <span>99 (highest)</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Badge Color</label>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-lg border-2 transition-all cursor-pointer ${
                  color === c ? 'border-white scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer"
            />
            <span className="text-xs text-text-secondary">{color}</span>
          </div>
        </div>

        <div className="pt-2">
          <label className="block text-sm font-medium mb-1.5">Preview</label>
          <span
            className="inline-block px-2.5 py-1 rounded-full text-xs font-medium text-white"
            style={{ backgroundColor: color }}
          >
            {displayName || 'Role Name'}
          </span>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Save Changes' : 'Create Role'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
