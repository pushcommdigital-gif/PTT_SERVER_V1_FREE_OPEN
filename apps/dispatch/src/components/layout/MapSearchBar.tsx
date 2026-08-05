import { useEffect, useRef, useState } from 'react';
import { Loader, Search, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';

interface GeocodeResult {
  label: string;
  address: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  source: 'photon' | 'nominatim';
}

interface Props {
  onSelect: (lon: number, lat: number, displayName: string) => void;
}

export function MapSearchBar({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced server-side geocoding search. The API can choose Photon,
  // Nominatim, or a future customer-hosted provider without changing the UI.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;
      setLoading(true);
      try {
        const res = await apiFetch<GeocodeResult[]>(
          `/geocoding/autocomplete?q=${encodeURIComponent(query)}&limit=6`,
        );
        if (requestSeq !== requestSeqRef.current) return;
        setResults(res.data || []);
        setOpen(true);
        setActiveIdx(-1);
      } catch {
        if (requestSeq !== requestSeqRef.current) return;
        setResults([]);
      } finally {
        if (requestSeq === requestSeqRef.current) setLoading(false);
      }
    }, 400);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  function selectResult(r: GeocodeResult) {
    onSelect(r.longitude, r.latitude, r.address || r.label);
    setQuery(shortLabel(r));
    setOpen(false);
    setResults([]);
  }

  function clear() {
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      selectResult(results[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-72 max-w-[calc(100%-80px)]">
      {/* Input */}
      <div className="flex items-center gap-1.5 bg-bg-sidebar/95 backdrop-blur-md border border-border rounded-lg px-2.5 py-1.5 shadow-xl">
        {loading
          ? <Loader size={13} className="text-text-secondary/60 shrink-0 animate-spin" />
          : <Search size={13} className="text-text-secondary/60 shrink-0" />
        }
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search address or place..."
          className="flex-1 bg-transparent text-xs text-white placeholder-text-secondary/40 focus:outline-none"
        />
        {query && (
          <button onClick={clear} className="text-text-secondary/40 hover:text-white transition-colors shrink-0">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div className="mt-1 bg-bg-sidebar/98 backdrop-blur-md border border-border rounded-lg shadow-2xl overflow-hidden">
          {results.map((r, i) => (
            <button
              key={`${r.source}:${r.latitude}:${r.longitude}:${r.label}`}
              onClick={() => selectResult(r)}
              className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${
                i === activeIdx ? 'bg-accent/15' : 'hover:bg-white/5'
              } ${i > 0 ? 'border-t border-border/50' : ''}`}
            >
              <span className="shrink-0 mt-0.5 text-[9px] font-semibold uppercase px-1 py-0.5 rounded border bg-blue-500/15 text-blue-300 border-blue-500/25">
                {hasStreetNumber(r) ? 'Address' : 'Place'}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-white font-medium truncate">{shortLabel(r)}</span>
                <span className="block text-[10px] text-text-secondary/60 truncate">{r.address || r.label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function shortLabel(r: GeocodeResult): string {
  const source = r.address || r.label;
  const parts = source.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.slice(0, 3).join(', ') || source;
}

function hasStreetNumber(r: GeocodeResult): boolean {
  return /^\d+\b/.test(r.address || r.label);
}
