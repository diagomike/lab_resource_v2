"use client";

export default function ContentHeader({
  crumb,
  title,
  subtitle,
}: {
  crumb?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="h-36 border-b border-border flex items-center gap-10 px-12 flex-none bg-panel">
      {crumb && <div className="text-10.5 text-faint whitespace-nowrap">{crumb}</div>}
      <div className="text-13.5 font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{title}</div>
      <div className="flex-1" />
      {subtitle && <div className="text-10.5 text-dim whitespace-nowrap">{subtitle}</div>}
    </div>
  );
}
