"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { SearchResult } from "@/lib/search/search";

const DEBOUNCE_MS = 250;

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  incident: "Incidents",
  claim: "Claims",
  vehicle: "Vehicles",
};

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Below the minimum query length, the dropdown is already hidden by
    // the render guard (`query.trim().length >= 2`) below — no fetch,
    // and no state to reset synchronously from inside the effect.
    if (query.trim().length < 2) return;
    // setLoading(true) fires inside the timeout callback, not
    // synchronously in the effect body — the debounce delay is the
    // point, so there's no "immediately" here to begin with.
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) setResults(await res.json());
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function selectResult(href: string) {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(href);
  }

  const grouped = (["incident", "claim", "vehicle"] as const)
    .map((type) => ({ type, items: results.filter((r) => r.type === type) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="relative max-w-[360px] flex-1">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search incident no., claim no., bus no…"
        className="pl-9"
      />
      {open && query.trim().length >= 2 && (
        <div className="bg-popover border-border absolute top-full left-0 z-50 mt-1 w-full rounded-md border shadow-md">
          {loading && (
            <div className="text-muted-foreground p-3 text-sm">Searching…</div>
          )}
          {!loading && grouped.length === 0 && (
            <div className="text-muted-foreground p-3 text-sm">
              No matches for &quot;{query}&quot;.
            </div>
          )}
          {!loading &&
            grouped.map((group) => (
              <div key={group.type} className="py-1">
                <div className="text-muted-foreground px-3 py-1 text-[11px] font-medium tracking-wide uppercase">
                  {TYPE_LABEL[group.type]}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    // onMouseDown fires before the input's onBlur closes
                    // the dropdown, so the click actually registers.
                    onMouseDown={() => selectResult(item.href)}
                    className="hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                  >
                    <span className="font-medium">{item.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {item.sublabel}
                    </span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
