/**
 * The curated icon registry a ResourceCategory.iconKey points into — ported from
 * temp_works/src/lib/icons.tsx's registry, minus the `CategoryIcon` React component
 * (JSX belongs in components/**, not lib/domain/**; a later UI phase adds a thin
 * wrapper around `categoryIconFor` wherever a category icon actually renders).
 */
import {
  Armchair,
  ArrowLeftRight,
  Beaker,
  Box,
  Boxes,
  Building2,
  Cable,
  CircuitBoard,
  Cog,
  Container,
  Cpu,
  Database,
  Droplets,
  Factory,
  FlaskConical,
  Gauge,
  Gem,
  HardDrive,
  Keyboard,
  Laptop,
  Layers3,
  Link2,
  MemoryStick,
  Monitor,
  Mouse,
  Network,
  Package,
  Presentation,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Speaker,
  Table2,
  TestTubes,
  Thermometer,
  Warehouse,
  Waves,
  type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Package,
  Building2,
  Warehouse,
  Boxes,
  Laptop,
  Cpu,
  MemoryStick,
  HardDrive,
  CircuitBoard,
  Monitor,
  Keyboard,
  Mouse,
  Speaker,
  Cable,
  Server,
  Network,
  Link2,
  Table2,
  Armchair,
  Presentation,
  FlaskConical,
  Beaker,
  TestTubes,
  Cog,
  Box,
  Container,
  Layers3,
  RefreshCw,
  Gauge,
  Waves,
  Factory,
  Droplets,
  Gem,
  ArrowLeftRight,
  Thermometer,
  SlidersHorizontal,
  Database,
};

export const CATEGORY_ICON_OPTIONS = Object.keys(CATEGORY_ICONS).sort();

/** Falls back to a generic package icon for a key not in the curated set — a category
 *  editor should never render a blank glyph. */
export function categoryIconFor(iconKey?: string): LucideIcon {
  return (iconKey && CATEGORY_ICONS[iconKey]) || Package;
}
