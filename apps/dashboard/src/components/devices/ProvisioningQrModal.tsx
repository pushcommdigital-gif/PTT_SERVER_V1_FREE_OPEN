import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Modal, Button } from '../ui';
import { apiFetch } from '../../lib/api';
import { Copy, Check, RefreshCw } from 'lucide-react';

interface ProvisioningQrModalProps {
  /** When non-null, the modal is open and immediately fetches the QR for this device. */
  deviceId: string | null;
  deviceName: string;
  onClose: () => void;
  /** Called after a successful (re)generation so the parent can refetch device lists. */
  onGenerated?: () => void;
}

/**
 * Reusable provisioning-QR modal. Generates a one-time 30-minute activation
 * code for the given device, encodes the payload as a QR image, and shows
 * the manual fallback code with a copy button. Used from both the Devices
 * page (where IT operators provision new hardware) and the User edit form
 * (where the operator already has the user's profile open and wants to
 * generate the device's QR without navigating away).
 */
export function ProvisioningQrModal({ deviceId, deviceName, onClose, onGenerated }: ProvisioningQrModalProps) {
  const [dataUrl, setDataUrl] = useState('');
  const [payloadText, setPayloadText] = useState('');
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function generate(id: string) {
    setLoading(true);
    setError('');
    setDataUrl('');
    setPayloadText('');
    setCode('');
    setExpiresAt('');
    setCopied(false);
    try {
      const res = await apiFetch<{
        provisioningCode: string;
        expiresAt: string;
        payload: Record<string, unknown>;
      }>(`/devices/${id}/provisioning-qr`, { method: 'POST' });
      const data = res.data;
      if (!data) throw new Error('Provisioning response was empty');
      const text = JSON.stringify(data.payload);
      const image = await QRCode.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setPayloadText(text);
      setDataUrl(image);
      setCode(data.provisioningCode);
      setExpiresAt(data.expiresAt);
      onGenerated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to generate provisioning QR');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (deviceId) {
      generate(deviceId);
    } else {
      // Closed — reset so the next open is clean.
      setDataUrl('');
      setPayloadText('');
      setCode('');
      setExpiresAt('');
      setError('');
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  function copyCode() {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal open={!!deviceId} onClose={onClose} title={deviceId ? `Provision ${deviceName}` : 'Provision Device'} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm text-text-secondary">
          Scan this QR from the Android app login screen. The code is one-time use and expires in 30 minutes.
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        ) : (
          <>
            {dataUrl && (
              <div className="flex justify-center rounded-xl bg-white p-4">
                <img src={dataUrl} alt="Device provisioning QR code" className="h-72 w-72" />
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-text-secondary">Manual fallback code</p>
              <div className="flex items-center gap-2 rounded-lg bg-bg-primary p-3">
                <code className="min-w-0 flex-1 break-all font-mono text-sm text-white">{code}</code>
                <button
                  type="button"
                  onClick={copyCode}
                  className="rounded-md p-2 text-text-secondary transition-colors hover:text-white"
                  title="Copy provisioning code"
                >
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                </button>
              </div>
              {expiresAt && (
                <p className="text-xs text-text-secondary">
                  Expires: {new Date(expiresAt).toLocaleString()}
                </p>
              )}
            </div>

            {payloadText && (
              <details className="rounded-lg border border-border bg-bg-primary p-3 text-xs text-text-secondary">
                <summary className="cursor-pointer text-white">QR payload</summary>
                <pre className="mt-2 whitespace-pre-wrap break-all">{payloadText}</pre>
              </details>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {deviceId && (
            <Button type="button" variant="secondary" onClick={() => generate(deviceId)} loading={loading}>
              <RefreshCw size={14} />
              Regenerate
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
