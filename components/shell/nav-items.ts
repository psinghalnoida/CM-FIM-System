// M16: the sidebar's nav list, matching the Claims Mitra design's
// section — but only linking to routes that actually exist today. The
// design's list also includes Fleet, Documents (org-wide), TAT &
// Escalations (unified), Reports & MIS, and Administration, none of
// which are built yet — see docs/SCOPE.md's M17-M29 for each. Grows as
// those land; never a placeholder link to a page that 404s.
export interface NavItem {
  label: string;
  href: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboards" },
  { label: "Incidents", href: "/incidents" },
  { label: "Claims", href: "/claims" },
  { label: "Vehicles", href: "/vehicles" },
  { label: "Drivers", href: "/drivers" },
  { label: "Depots", href: "/depots" },
  { label: "Cities", href: "/cities" },
  { label: "TAT Stage Templates", href: "/tat/stage-templates" },
  { label: "Escalation Rules", href: "/escalation-rules" },
];
