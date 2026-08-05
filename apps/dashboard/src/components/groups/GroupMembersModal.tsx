import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { apiFetch } from '../../lib/api';
import { UserMinus, UserPlus, Search } from 'lucide-react';

interface Member {
  id: string;
  userId: string;
  isAdmin: boolean;
  firstName: string;
  lastName: string;
  role: string;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  username: string;
}

interface GroupMembersModalProps {
  open: boolean;
  group: { id: string; name: string } | null;
  onClose: () => void;
  onChanged?: () => void;
}

export function GroupMembersModal({ open, group, onClose, onChanged }: GroupMembersModalProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!group) return;
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/groups/${group.id}`);
      setMembers(res.data?.members || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [group]);

  useEffect(() => {
    if (open && group) {
      fetchMembers();
      apiFetch<UserOption[]>('/users?limit=100').then((res: any) => setAllUsers(res.data || []));
      setAdding(false);
      setSearchTerm('');
    }
  }, [open, group, fetchMembers]);

  const availableUsers = allUsers
    .filter((u) => !members.some((m) => m.userId === u.id))
    .filter(
      (u) =>
        !searchTerm ||
        `${u.firstName} ${u.lastName} ${u.username}`.toLowerCase().includes(searchTerm.toLowerCase()),
    );

  async function addMember(userId: string) {
    if (!group) return;
    await apiFetch(`/groups/${group.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    fetchMembers();
    onChanged?.();
  }

  async function removeMember(userId: string) {
    if (!group) return;
    await apiFetch(`/groups/${group.id}/members/${userId}`, { method: 'DELETE' });
    fetchMembers();
    onChanged?.();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Members - ${group?.name || ''}`} maxWidth="max-w-xl">
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-primary">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-xs font-medium text-accent">
                    {m.firstName[0]}
                    {m.lastName[0]}
                  </div>
                  <span className="font-medium text-sm">
                    {m.firstName} {m.lastName}
                  </span>
                  <Badge>{m.role.replace('_', ' ')}</Badge>
                </div>
                <button
                  onClick={() => removeMember(m.userId)}
                  className="text-text-secondary hover:text-danger cursor-pointer p-1"
                  title="Remove member"
                >
                  <UserMinus size={16} />
                </button>
              </div>
            ))}
            {members.length === 0 && (
              <p className="text-text-secondary text-sm text-center py-4">No members yet</p>
            )}
          </div>

          <Button variant="secondary" size="sm" onClick={() => setAdding(!adding)}>
            <UserPlus size={16} /> {adding ? 'Close' : 'Add Members'}
          </Button>

          {adding && (
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-2.5 text-text-secondary" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-bg-primary border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder="Search users..."
                  autoFocus
                />
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {availableUsers.length === 0 ? (
                  <p className="text-text-secondary text-sm text-center py-3">No users available</p>
                ) : (
                  availableUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => addMember(u.id)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-sm cursor-pointer"
                    >
                      <span>
                        {u.firstName} {u.lastName}{' '}
                        <span className="text-text-secondary">@{u.username}</span>
                      </span>
                      <UserPlus size={14} className="text-success" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
