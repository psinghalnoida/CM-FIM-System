// M16: the sidebar's nav list, matching the Claims Mitra design's
// section — but only linking to routes that actually exist today. The
// design's list also includes Fleet, Documents (org-wide), TAT &
// Escalations (unified), and Reports & MIS, none of which are built
// yet — see docs/SCOPE.md's M19-M29 for each. Grows as those land;
// never a placeholder link to a page that 404s.
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
  // M18: just Users today — grows into the design's full tabbed
  // Administration screen (Master Data/M27, Integration Settings/M29).
  { label: "Administration", href: "/admin/users" },
];
