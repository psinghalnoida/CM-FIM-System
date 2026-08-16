// M16: the sidebar's nav list, matching the Claims Mitra design's
// section — but only linking to routes that actually exist today. Grows
// as milestones land; never a placeholder link to a page that 404s.
// Documents (M22), My Work/Fleet/TAT Dashboard/Reports (M23-M26), Master
// Data (M27) and Integration Settings (M29) added below.
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
  // M18: Users. M27: Master Data. M29: Integration Settings.
  { label: "Administration", href: "/admin/users" },
  { label: "Master Data", href: "/admin/master-data" },
  { label: "Integration Settings", href: "/admin/integrations" },
];
