import RequireRole from "@/components/RequireRole";
import PlacePage from "@/components/places/PlacePage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireRole>
      <PlacePage id={id} />
    </RequireRole>
  );
}
