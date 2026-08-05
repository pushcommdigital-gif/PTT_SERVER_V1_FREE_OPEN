import { Truck } from 'lucide-react';

interface UnitChipProps {
  unit: {
    id: string;
    name: string;
    type: string | null;
    stationName: string | null;
    availability?: 'available' | 'unavailable' | 'on_call';
  };
  selected: boolean;
  onSelect: (id: string) => void;
}

export function UnitChip({ unit, selected, onSelect }: UnitChipProps) {
  const statusClass =
    unit.availability === 'on_call'
      ? 'bg-warning'
      : unit.availability === 'unavailable'
        ? 'bg-danger'
        : 'bg-success';

  const statusTitle =
    unit.availability === 'on_call'
      ? 'On Call'
      : unit.availability === 'unavailable'
        ? 'Unavailable'
        : 'Available';

  return (
    <button
      onClick={() => onSelect(unit.id)}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap cursor-pointer ${
        selected
          ? 'bg-accent/20 border border-accent/40 text-white'
          : 'bg-bg-card border border-border hover:border-border/80 text-text-secondary hover:text-white'
      }`}
    >
      <Truck size={12} />
      <span className="font-medium">{unit.name}</span>
      <div className={`w-1.5 h-1.5 rounded-full ${statusClass}`} title={statusTitle} />
    </button>
  );
}
