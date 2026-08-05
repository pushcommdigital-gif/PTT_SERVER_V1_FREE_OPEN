import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { Eye, EyeOff, QrCode } from 'lucide-react';
import { DISPATCHER_LEVEL } from '@pushcomm/shared';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { apiFetch, ApiError } from '../../lib/api';
import { useRoles } from '../../hooks/useRoles';
import { ProvisioningQrModal } from '../devices/ProvisioningQrModal';

interface UserData {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  device: string | null; // legacy free-text column, no longer shown in the form
  assignedDevice: { id: string; name: string; status: string } | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  notes: string | null;
  groupId: string | null;
  groupName: string | null;
  role: string;
}

interface UserFormModalProps {
  open: boolean;
  onClose: () => void;
  user: UserData | null;
  onSuccess: (type: 'created' | 'updated') => void;
}

export function UserFormModal({ open, onClose, user, onSuccess }: UserFormModalProps) {
  const { roles } = useRoles();
  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.name, label: r.displayName })),
    [roles],
  );
  // Look up the hierarchy level of the currently-selected role so we can
  // hide the Group field for dispatchers / admins / super_admins. Those
  // roles get implicit access to every group in the department; assigning
  // a single primary group would just confuse the UX and limit them.
  const roleLevelByName = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.name, r.hierarchyLevel])) as Record<string, number>,
    [roles],
  );
  const [groupOptions, setGroupOptions] = useState<Array<{ value: string; label: string }>>([
    { value: '', label: 'Not assigned' },
  ]);
  // Device dropdown options: "— None —" + unassigned devices + this user's
  // currently-assigned device (so editing doesn't lose the selection).
  const [deviceOptions, setDeviceOptions] = useState<Array<{ value: string; label: string }>>([
    { value: '', label: '— None —' },
  ]);
  const isEdit = !!user;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [notes, setNotes] = useState('');
  const [groupId, setGroupId] = useState('');
  const [role, setRole] = useState('driver');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Activation-QR modal trigger. Holds the device row {id, name} the user
  // wants to provision so we can title the modal correctly. Reuses the
  // same component the Devices page mounts.
  const [qrDevice, setQrDevice] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (open) {
      if (user) {
        setFirstName(user.firstName);
        setLastName(user.lastName);
        setEmail(user.email);
        setUsername(user.username);
        setDeviceId(user.assignedDevice?.id || '');
        setPhone(user.phone || '');
        setAddress(user.address || '');
        setCity(user.city || '');
        setState(user.state || '');
        setZipCode(user.zipCode || '');
        setNotes(user.notes || '');
        setGroupId(user.groupId || '');
        setRole(user.role);
        setPassword('');
        setConfirmPassword('');
        setShowPassword(false);
      } else {
        setFirstName('');
        setLastName('');
        setEmail('');
        setUsername('');
        setDeviceId('');
        setPhone('');
        setAddress('');
        setCity('');
        setState('');
        setZipCode('');
        setNotes('');
        setGroupId('');
        const fallbackRole = roles.find((r) => r.name === 'not_assigned')?.name
          || roles[roles.length - 1]?.name
          || 'not_assigned';
        setRole(fallbackRole);
        setPassword('');
        setConfirmPassword('');
        setShowPassword(false);
      }
      setError('');
    }
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    apiFetch<any[]>('/groups?limit=200')
      .then((res: any) => {
        const options = (res.data || []).map((g: any) => ({ value: g.id, label: g.name }));
        setGroupOptions([{ value: '', label: 'Not assigned' }, ...options]);
      })
      .catch(() => {
        setGroupOptions([{ value: '', label: 'Not assigned' }]);
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Fetch unassigned devices PLUS the device this user already owns (if
    // editing) so the current selection survives the open. The API's
    // includeUserId param accepts a user id whose currently-assigned
    // device should also appear in the result.
    const includeUserParam = user?.id ? `&includeUserId=${encodeURIComponent(user.id)}` : '';
    apiFetch<any[]>(`/devices?unassigned=true&limit=200${includeUserParam}`)
      .then((res: any) => {
        const options = (res.data || []).map((d: any) => ({
          value: d.id,
          label: d.imei ? `${d.name} (${d.imei})` : d.name,
        }));
        setDeviceOptions([{ value: '', label: '— None —' }, ...options]);
      })
      .catch(() => {
        setDeviceOptions([{ value: '', label: '— None —' }]);
      });
  }, [open, user?.id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (password && password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (isEdit) {
        if (password && password.length < 6) {
          setError('Password must be at least 6 characters');
          return;
        }
        await apiFetch(`/users/${user!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            username,
            firstName,
            lastName,
            deviceId: deviceId || null,
            phone: phone || undefined,
            address: address || undefined,
            city: city || undefined,
            state: state || undefined,
            zipCode: zipCode || undefined,
            notes: notes || undefined,
            groupId: groupId || null,
            password: password || undefined,
            role,
          }),
        });
      } else {
        if (!password || password.length < 6) {
          setError('Password must be at least 6 characters');
          return;
        }
        await apiFetch('/users', {
          method: 'POST',
          body: JSON.stringify({
            firstName,
            lastName,
            email: email.trim() || undefined,
            username,
            deviceId: deviceId || null,
            phone: phone || undefined,
            address: address || undefined,
            city: city || undefined,
            state: state || undefined,
            zipCode: zipCode || undefined,
            notes: notes || undefined,
            groupId: groupId || undefined,
            role,
            password,
          }),
        });
      }
      onClose();
      onSuccess(isEdit ? 'updated' : 'created');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save user');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit User' : 'Create User'} maxWidth="max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            id="firstName"
            label="First Name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
          <Input
            id="lastName"
            label="Last Name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>

        {!isEdit && (
          <Input
            id="email"
            label="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}

        <Input
          id="username"
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="deviceId" className="block text-sm font-medium text-text-secondary">
              Device
            </label>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Select
                  id="deviceId"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  options={deviceOptions}
                />
              </div>
              {/* Show the QR shortcut only when the *currently saved* device
                  for this user is the one selected. Generating a QR for an
                  unsaved-yet selection would either silently fail (the
                  device→user link doesn't exist yet) or, worse, generate
                  for the wrong user. */}
              {isEdit && deviceId && deviceId === user?.assignedDevice?.id && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setQrDevice({ id: deviceId, name: user?.assignedDevice?.name ?? 'Device' })}
                  title="Generate activation QR for this device"
                >
                  <QrCode size={14} />
                  QR
                </Button>
              )}
            </div>
            {isEdit && deviceId && deviceId !== user?.assignedDevice?.id && (
              <p className="text-xs text-text-secondary">
                Save first to enable the activation QR for this new selection.
              </p>
            )}
          </div>

          <Input
            id="phone"
            label="Phone Number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <Input
            id="address"
            label="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />

          <Input
            id="city"
            label="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />

          <Input
            id="state"
            label="State"
            value={state}
            onChange={(e) => setState(e.target.value)}
          />

          <Input
            id="zipCode"
            label="Zip Code"
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value)}
          />

          <Select
            id="role"
            label="Role"
            value={role}
            onChange={(e) => {
              const next = e.target.value;
              setRole(next);
              // Dispatchers and above have implicit access to every group
              // in the department — they don't need a primary group set.
              // Clear any previously-selected group when promoting the user.
              if ((roleLevelByName[next] ?? 0) >= DISPATCHER_LEVEL) setGroupId('');
            }}
            options={roleOptions}
          />

          {(roleLevelByName[role] ?? 0) < DISPATCHER_LEVEL && (
            <Select
              id="groupId"
              label="Group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              options={groupOptions}
            />
          )}

          <div className="space-y-1">
            <label htmlFor="password" className="block text-sm font-medium text-text-secondary">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!isEdit}
                placeholder={isEdit ? 'Leave blank to keep current' : 'Minimum 6 characters'}
                className="w-full rounded-lg bg-bg-primary border border-border px-3 py-2 pr-9 text-sm text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                tabIndex={-1}
                className="absolute inset-y-0 right-2 flex items-center text-text-secondary hover:text-white"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-text-secondary">
              Confirm Password
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required={!isEdit}
                placeholder="Repeat password"
                className="w-full rounded-lg bg-bg-primary border border-border px-3 py-2 pr-9 text-sm text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                tabIndex={-1}
                className="absolute inset-y-0 right-2 flex items-center text-text-secondary hover:text-white"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="space-y-1 md:col-span-2">
            <label htmlFor="notes" className="block text-sm font-medium text-text-secondary">
              Notes
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg bg-bg-primary border border-border px-3 py-2 text-sm text-white placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              placeholder="Optional notes"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Save Changes' : 'Create User'}
          </Button>
        </div>
      </form>

      <ProvisioningQrModal
        deviceId={qrDevice?.id ?? null}
        deviceName={qrDevice?.name ?? ''}
        onClose={() => setQrDevice(null)}
      />
    </Modal>
  );
}
