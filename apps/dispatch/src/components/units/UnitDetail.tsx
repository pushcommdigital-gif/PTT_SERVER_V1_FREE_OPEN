import { useState, useEffect } from 'react';
import { Badge } from '../ui/Badge';
import { apiFetch } from '../../lib/api';
import { Truck, Building2, Hash, Car } from 'lucide-react';

interface UnitDetailData {
  id: string;
  name: string;
  type: string | null;
  plateNumber: string | null;
  vin: string | null;
  stationName: string | null;
  createdAt: string;
}

interface UnitDetailProps {
  unitId: string;
}

export function UnitDetail({ unitId }: UnitDetailProps) {
  const [unit, setUnit] = useState<UnitDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUnit();
  }, [unitId]);

  async function fetchUnit() {
    setLoading(true);
    try {
      const res = await apiFetch<UnitDetailData>(`/units/${unitId}`);
      setUnit(res.data || null);
    } catch {
      setUnit(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!unit) {
    return <p className="text-text-secondary text-center py-8 text-sm">Unit not found.</p>;
  }

  return (
    <div className="space-y-4 p-3">
      {/* Unit header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Truck size={16} className="text-accent" />
          <h2 className="text-base font-semibold">{unit.name}</h2>
        </div>
        {unit.type && <Badge variant="info">{unit.type}</Badge>}
      </div>

      {/* Info */}
      <div className="space-y-2">
        {unit.stationName && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <Building2 size={12} />
            <span>Station: {unit.stationName}</span>
          </div>
        )}
        {unit.plateNumber && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <Car size={12} />
            <span>Plate: {unit.plateNumber}</span>
          </div>
        )}
        {unit.vin && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <Hash size={12} />
            <span>VIN: {unit.vin}</span>
          </div>
        )}
      </div>

      {/* Status placeholder */}
      <div className="border border-border rounded-lg p-3">
        <h3 className="text-xs font-semibold uppercase text-text-secondary mb-2">Status</h3>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-success" />
          <span className="text-sm">In Service</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {['In Service', 'Out of Service', 'Enroute', 'On Scene'].map((status) => (
            <button
              key={status}
              className="px-2 py-1.5 rounded text-xs bg-bg-primary border border-border hover:border-accent/30 text-text-secondary hover:text-white transition-colors cursor-pointer"
              title="Status change — coming soon"
            >
              {status}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-text-secondary/50 mt-2">Status changes coming soon</p>
      </div>

      {/* Personnel placeholder */}
      <div className="border border-border rounded-lg p-3">
        <h3 className="text-xs font-semibold uppercase text-text-secondary mb-2">Personnel</h3>
        <p className="text-xs text-text-secondary/50">Personnel assignment coming soon</p>
      </div>
    </div>
  );
}
