// M16: the sidebar's nav list, matching the Claims Mitra design's
// section — but only linking to routes that actually exist today. Grows
// as milestones land; never a placeholder link to a page that 404s.
// Documents (M22), My Work/Fleet/TAT Dashboard/Reports (M23-M26) added
// below. Still missing: the design's tabbed Administration screen
// (Master Data/M27, Integration Settings/M29) — see docs/SCOPE.md.
export interface NavItem {
  label: string;
  href: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "My Work", href: "/my-work" },
  { label: "Dashboard", href: "/dashboards" },
  { label: "Fleet", href: "/fleet" },
  { label: "Incidents", href: "/incidents" },
  { label: "Claims", href: "/claims" },
  { label: "Vehicles", href: "/vehicles" },
  { label: "Drivers", href: "/drivers" },
  { label: "Documents", href: "/documents" },
  { label: "Depots", href: "/depots" },
  { label: "Cities", href: "/cities" },
  { label: "TAT Dashboard", href: "/tat/dashboard" },
  { label: "TAT Stage Templates", href: "/tat/stage-templates" },
  { label: "Escalation Rules", href: "/escalation-rules" },
  { label: "Reports", href: "/reports" },
  // M18: just Users today — grows into the design's full tabbed
  // Administration screen (Master Data/M27, Integration Settings/M29).
  { label: "Administration", href: "/admin/users" },
];
