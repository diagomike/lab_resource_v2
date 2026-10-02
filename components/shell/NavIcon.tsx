import { Boxes, Building2, CalendarDays, ChartColumn, CircleCheck, CircleHelp, Globe, History, House, Network, Shapes, ShoppingCart, UserRound, Users, type LucideIcon } from "lucide-react";
import type { NavIconName } from "@/lib/nav";

const ICONS: Record<NavIconName, LucideIcon> = { House, Boxes, Building2, CalendarDays, CircleCheck, ShoppingCart, Globe, Shapes, ChartColumn, History, Users, Network, CircleHelp, UserRound };

/** A sidebar entry's icon — decorative, the label beside it says what it is. */
export default function NavIcon({ name, size = 14 }: { name: NavIconName; size?: number }) {
  const Icon = ICONS[name];
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" className="flex-none" />;
}
