import { useState } from 'react';
import { X, SlidersHorizontal, Radio, Navigation } from 'lucide-react';
import { MicPicker } from '../voice/MicSettings';
import {
  useSettings,
  type UnitSystem,
  type TimeFormat,
  type MonitorDefault,
  type TransmitDefault,
  type MessageAlertVolume,
} from '../../contexts/SettingsContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'voice', label: 'Voice & Monitoring', icon: Radio },
  { id: 'map', label: 'Map', icon: Navigation },
] as const;

export function SettingsPanel({ open, onClose }: Props) {
  const {
    unitSystem, timeFormat, monitorDefault, transmitDefault, messageSoundEnabled, messageAlertVolume,
    followTalker,
    setUnitSystem, setTimeFormat, setMonitorDefault, setTransmitDefault, setMessageSoundEnabled,
    setMessageAlertVolume, setFollowTalker,
  } = useSettings();
  const [active, setActive] = useState<(typeof SECTIONS)[number]['id']>('general');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl h-[80vh] max-h-[640px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-bold text-white">Dispatch Settings</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left nav */}
          <nav className="w-48 shrink-0 border-r border-border p-2 space-y-1 overflow-y-auto">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                  active === s.id ? 'bg-accent text-white' : 'text-text-secondary hover:bg-white/5 hover:text-white'
                }`}
              >
                <s.icon size={15} />
                <span className="font-medium">{s.label}</span>
              </button>
            ))}
          </nav>

          {/* Detail pane */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {active === 'general' && (
              <>
                <SettingSection label="Unit System" hint="Affects distances and speeds">
                  <RadioGroup value={unitSystem} onChange={(v) => setUnitSystem(v as UnitSystem)} options={[
                    { value: 'metric', label: 'Metric', sub: 'km, m/s' },
                    { value: 'imperial', label: 'Imperial', sub: 'mi, mph' },
                  ]} />
                </SettingSection>
                <SettingSection label="Time Format" hint="Clock and timestamps">
                  <RadioGroup value={timeFormat} onChange={(v) => setTimeFormat(v as TimeFormat)} options={[
                    { value: '24h', label: '24-hour', sub: '14:30:00' },
                    { value: '12h', label: '12-hour', sub: '2:30:00 PM' },
                  ]} />
                </SettingSection>
              </>
            )}

            {active === 'voice' && (
              <>
                <SettingSection label="Microphone" hint="Choose the PTT input device and test it — the bar should move when you speak">
                  <MicPicker enabled={active === 'voice'} />
                </SettingSection>
                <SettingSection label="Default Monitoring" hint="What the dispatcher hears after login">
                  <RadioGroup value={monitorDefault} onChange={(v) => setMonitorDefault(v as MonitorDefault)} options={[
                    { value: 'all', label: 'All Groups', sub: 'Command view' },
                    { value: 'last', label: 'Last Used', sub: 'This browser' },
                  ]} />
                </SettingSection>
                <SettingSection label="Default Transmit" hint="Who hears the dispatcher PTT">
                  <RadioGroup value={transmitDefault} onChange={(v) => setTransmitDefault(v as TransmitDefault)} columns={3} options={[
                    { value: 'all', label: 'All Groups', sub: 'Broadcast PTT' },
                    { value: 'none', label: 'None', sub: 'Manual select' },
                    { value: 'last', label: 'Last Used', sub: 'This browser' },
                  ]} />
                </SettingSection>
                <SettingSection label="Message Alerts" hint="Incoming unit message attention cues">
                  <ToggleButton checked={messageSoundEnabled} onChange={setMessageSoundEnabled} label="Sound alert"
                    sub={messageSoundEnabled ? 'Tone plays on new messages' : 'Visual alerts only'} />
                  {messageSoundEnabled && (
                    <div className="pt-2">
                      <RadioGroup value={messageAlertVolume} onChange={(v) => setMessageAlertVolume(v as MessageAlertVolume)} columns={3} options={[
                        { value: 'low', label: 'Low', sub: '~60 dB' },
                        { value: 'medium', label: 'Medium', sub: '~68-70 dB' },
                        { value: 'high', label: 'High', sub: '~78-82 dB' },
                      ]} />
                      <p className="mt-1 text-[10px] text-text-secondary/45">Browser tones are approximate; actual volume depends on device and OS audio.</p>
                    </div>
                  )}
                </SettingSection>
              </>
            )}

            {active === 'map' && (
              <>
                <SettingSection label="Map" hint="How the map reacts to live activity">
                  <ToggleButton checked={followTalker} onChange={setFollowTalker} label="Follow the talking unit"
                    sub={followTalker ? 'Map zooms to the unit on the air' : 'Highlight only, map stays put'} />
                </SettingSection>
              </>
            )}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-[10px] text-text-secondary/50 text-center py-2 border-t border-border shrink-0">
          Settings are saved automatically to this browser.
        </p>
      </div>
    </div>
  );
}

function SettingSection({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-white">{label}</p>
        <p className="text-[10px] text-text-secondary/60">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function ToggleButton({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-full flex items-center justify-between gap-3 py-2 px-3 rounded-lg border text-left transition-colors ${
        checked
          ? 'border-accent bg-accent/15 text-white'
          : 'border-border bg-bg-sidebar/50 text-text-secondary hover:border-accent/40 hover:text-white'
      }`}
    >
      <span>
        <span className="block text-xs font-semibold">{label}</span>
        <span className="block text-[10px] opacity-60 mt-0.5">{sub}</span>
      </span>
      <span className={`w-9 h-5 rounded-full border flex items-center px-0.5 transition-colors ${
        checked ? 'bg-accent border-accent' : 'bg-bg-primary border-border'
      }`}>
        <span className={`w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

function RadioGroup({
  value,
  onChange,
  options,
  columns = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; sub: string }[];
  columns?: 2 | 3 | 4;
}) {
  const columnClass = columns === 4 ? 'grid-cols-4' : columns === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className={`grid gap-2 ${columnClass}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex flex-col items-center py-2 px-3 rounded-lg border text-center transition-colors ${
            value === opt.value
              ? 'border-accent bg-accent/15 text-white'
              : 'border-border bg-bg-sidebar/50 text-text-secondary hover:border-accent/40 hover:text-white'
          }`}
        >
          <span className="text-xs font-semibold">{opt.label}</span>
          <span className="text-[10px] opacity-60 mt-0.5">{opt.sub}</span>
        </button>
      ))}
    </div>
  );
}
