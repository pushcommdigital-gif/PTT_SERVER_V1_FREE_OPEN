import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { apiFetch, ApiError } from '../lib/api';
import { Building2, UserCog, CheckCircle2 } from 'lucide-react';

type Step = 1 | 2;

export function SetupWizard() {
  const { login } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — organization
  const [orgName, setOrgName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

  // Step 2 — admin
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  function next() {
    setError('');
    if (step === 1) {
      if (!orgName.trim()) return setError('Please enter your organization name.');
      setStep(2);
    } else if (step === 2) {
      if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required.');
      if (!username.trim()) return setError('A username is required.');
      if (password.length < 6) return setError('Password must be at least 6 characters.');
      if (password !== confirm) return setError('Passwords do not match.');
    }
  }
  function back() { setError(''); setStep((s) => (s > 1 ? ((s - 1) as Step) : s)); }

  async function finish() {
    setError('');
    setSubmitting(true);
    try {
      await apiFetch('/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          organizationName: orgName.trim(),
          timezone: timezone.trim() || 'UTC',
          admin: { firstName: firstName.trim(), lastName: lastName.trim(), username: username.trim(), email: email.trim() || undefined, password },
        }),
      });
      // Log in with the credentials just created (stores tokens), then do a FULL
      // reload to "/". A reload is required so the app re-fetches setup state —
      // it's now complete, so the setup gate steps aside and the logged-in
      // dashboard loads. (An in-app navigate would bounce back to /setup because
      // the cached setup-state flag is still false from initial page load.)
      await login(username.trim(), password);
      window.location.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed. Please try again.');
      setSubmitting(false);
    }
  }

  const steps = [
    { n: 1, label: 'Organization', Icon: Building2 },
    { n: 2, label: 'Admin account', Icon: UserCog },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-accent">PUSHCOMM</h1>
          <p className="text-text-secondary mt-2">Welcome — let's set up your server</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {steps.map((s, i) => (
            <div key={s.n} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                step === s.n ? 'bg-accent text-white' : step > s.n ? 'bg-success/20 text-success' : 'bg-bg-card text-text-secondary border border-border'
              }`}>
                {step > s.n ? <CheckCircle2 size={13} /> : <s.Icon size={13} />}
                {s.label}
              </div>
              {i < steps.length - 1 && <div className="w-4 h-px bg-border" />}
            </div>
          ))}
        </div>

        <div className="bg-bg-card rounded-xl border border-border p-6">
          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm mb-4">{error}</div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">Name your organization. This is the department your users, groups, and devices belong to.</p>
              <Input id="orgName" label="Organization name" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Security" autoFocus />
              <Input id="timezone" label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
              <Button onClick={next} className="w-full">Continue</Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">Create your administrator account. You'll use this to sign in and manage everything.</p>
              <div className="grid grid-cols-2 gap-3">
                <Input id="firstName" label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
                <Input id="lastName" label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <Input id="username" label="Username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
              <Input id="email" label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@acme.com" />
              <div className="grid grid-cols-2 gap-3">
                <Input id="password" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
                <Input id="confirm" label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={back} disabled={submitting} className="flex-1">Back</Button>
                <Button onClick={finish} loading={submitting} className="flex-1">Finish setup</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
