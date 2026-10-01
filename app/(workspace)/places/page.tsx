import RequireRole from "@/components/RequireRole";
import PlacesPage from "@/components/places/PlacesPage";

export default function Page() {
  return (
    <RequireRole>
      <PlacesPage />
    </RequireRole>
  );
}
