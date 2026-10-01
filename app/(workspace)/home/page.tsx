import RequireRole from "@/components/RequireRole";
import HomePage from "@/components/home/HomePage";

export default function Page() {
  return (
    <RequireRole>
      <HomePage />
    </RequireRole>
  );
}
