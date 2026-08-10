import Link from "next/link";

// M19: tab navigation for the sub-record detail pages (Survey/Repair
// job/Settlement/Payment), matching the Claims Mitra design's tab
// layout. Server-rendered via a `?tab=` search param rather than client
// state — no JS needed to switch tabs, consistent with the rest of these
// pages being plain server components.
export function DetailTabs({
  basePath,
  activeTab,
  tabs,
}: {
  basePath: string;
  activeTab: string;
  tabs: { key: string; label: string }[];
}) {
  return (
    <div className="border-border mb-4 flex gap-5 border-b text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`${basePath}?tab=${tab.key}`}
          className={
            tab.key === activeTab
              ? "border-primary text-primary -mb-px border-b-2 pb-2 font-medium"
              : "text-muted-foreground -mb-px border-b-2 border-transparent pb-2"
          }
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
