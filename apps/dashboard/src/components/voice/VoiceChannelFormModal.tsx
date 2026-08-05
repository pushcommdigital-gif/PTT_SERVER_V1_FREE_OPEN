import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { apiFetch, ApiError } from '../../lib/api';
import type { VoiceChannelData } from '../../hooks/useVoiceChannels';

interface GroupOption {
  id: string;
  name: string;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface ChannelDetail {
  id: string;
  name: string;
  displayOrder: number;
  isDefault: boolean;
  assignedGroups: Array<{ groupId: string; name: string }>;
  assignedUsers: Array<{ userId: string; firstName: string; lastName: string; role: string }>;
}

interface VoiceChannelFormModalProps {
  open: boolean;
  onClose: () => void;
  channel: VoiceChannelData | null;
  onSuccess: () => void;
}

export function VoiceChannelFormModal({ open, onClose, channel, onSuccess }: VoiceChannelFormModalProps) {
  const [name, setName] = useState('');
  const [displayOrder, setDisplayOrder] = useState(0);
  const [isDefault, setIsDefault] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [allGroups, setAllGroups] = useState<GroupOption[]>([]);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!channel;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoadingData(true);
    setError(null);

    Promise.all([
      apiFetch<GroupOption[]>('/groups?page=1&limit=100'),
      apiFetch<UserOption[]>('/users?page=1&limit=100'),
      channel ? apiFetch<ChannelDetail>(`/voice-channels/${channel.id}`) : Promise.resolve(null),
    ])
      .then(([groupsRes, usersRes, channelRes]) => {
        if (cancelled) return;

        setAllGroups((groupsRes as any)?.data || []);
        setAllUsers((usersRes as any)?.data || []);

        if (channelRes && (channelRes as any).data) {
          const detail = (channelRes as any).data as ChannelDetail;
          setName(detail.name);
          setDisplayOrder(detail.displayOrder ?? 0);
          setIsDefault(detail.isDefault ?? false);
          setGroupIds(detail.assignedGroups.map((g) => g.groupId));
          setUserIds(detail.assignedUsers.map((u) => u.userId));
        } else {
          setName('');
          setDisplayOrder(0);
          setIsDefault(false);
          setGroupIds([]);
          setUserIds([]);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load form data');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, channel]);

  const sortedGroups = useMemo(
    () => [...allGroups].sort((a, b) => a.name.localeCompare(b.name)),
    [allGroups],
  );
  const sortedUsers = useMemo(
    () => [...allUsers].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)),
    [allUsers],
  );

  function toggleGroup(groupId: string) {
    setGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function toggleUser(userId: string) {
    setUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Channel name is required');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        displayOrder,
        isDefault,
        groupIds,
        userIds,
      };

      if (isEdit && channel) {
        await apiFetch(`/voice-channels/${channel.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/voice-channels', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save channel');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Voice Channel' : 'Create Voice Channel'}
      maxWidth="max-w-3xl"
    >
      {loadingData ? (
        <div className="py-8 text-center text-text-secondary">Loading...</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Channel Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dispatch"
              required
            />
            <Input
              label="Display Order"
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(parseInt(e.target.value || '0', 10))}
            />
            <label className="text-sm text-text-secondary flex items-end pb-2 gap-2">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Set as default channel
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-border rounded-lg p-3 bg-bg-sidebar/50">
              <p className="text-sm font-medium mb-2">Assign Groups</p>
              <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                {sortedGroups.length === 0 ? (
                  <p className="text-xs text-text-secondary">No groups available</p>
                ) : (
                  sortedGroups.map((group) => (
                    <label key={group.id} className="flex items-center gap-2 text-sm text-text-secondary hover:text-white">
                      <input
                        type="checkbox"
                        checked={groupIds.includes(group.id)}
                        onChange={() => toggleGroup(group.id)}
                      />
                      <span>{group.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="border border-border rounded-lg p-3 bg-bg-sidebar/50">
              <p className="text-sm font-medium mb-2">Assign Individual Users</p>
              <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                {sortedUsers.length === 0 ? (
                  <p className="text-xs text-text-secondary">No users available</p>
                ) : (
                  sortedUsers.map((user) => (
                    <label key={user.id} className="flex items-center gap-2 text-sm text-text-secondary hover:text-white">
                      <input
                        type="checkbox"
                        checked={userIds.includes(user.id)}
                        onChange={() => toggleUser(user.id)}
                      />
                      <span>
                        {user.firstName} {user.lastName} ({user.role})
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {isEdit ? 'Save Changes' : 'Create Channel'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

