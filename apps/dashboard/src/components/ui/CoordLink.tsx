import { MapPin } from 'lucide-react';

interface CoordLinkProps {
  lat: string | number | null | undefined;
  lon: string | number | null | undefined;
  /** Override the displayed text (defaults to "lat, lon" at 5 decimals). */
  label?: string;
  className?: string;
}

/**
 * Renders a lat/lon pair as a link that opens the location on OpenStreetMap in a
 * new tab (consistent with the platform's OSM/MapLibre stack, no API key needed).
 * Falls back to a muted dash when coordinates are missing/invalid.
 */
export function CoordLink({ lat, lon, label, className }: CoordLinkProps) {
  const latN = typeof lat === 'string' ? parseFloat(lat) : lat;
  const lonN = typeof lon === 'string' ? parseFloat(lon) : lon;

  if (latN == null || lonN == null || Number.isNaN(latN) || Number.isNaN(lonN)) {
    return <span className="text-text-secondary text-sm">—</span>;
  }

  const href = `https://www.openstreetmap.org/?mlat=${latN}&mlon=${lonN}#map=17/${latN}/${lonN}`;
  const text = label ?? `${latN.toFixed(5)}, ${lonN.toFixed(5)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Open location in map"
      className={`inline-flex items-center gap-1 font-mono text-sm text-accent hover:underline ${className ?? ''}`}
    >
      <MapPin size={12} className="shrink-0" />
      {text}
    </a>
  );
}
