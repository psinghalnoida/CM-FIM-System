"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/components/shell/nav-items";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="border-border bg-card flex w-56 flex-none flex-col gap-6 border-r px-3 py-4">
      <div className="flex items-center gap-2 px-2">
        <div>
          <div className="text-primary font-heading text-lg font-bold">
            Claims Mitra
          </div>
          {/* The module tag — this deployment is the Fleet Incident &
              claims Management module; other CM modules may exist
              elsewhere, so this disambiguates which one a user is in. */}
          <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
            CM FIM
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="text-muted-foreground/70 mt-auto px-2 text-[11px] leading-relaxed">
        CM FIM System
      </div>
    </aside>
  );
}
