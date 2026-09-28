import { redirect } from "next/navigation";

/** University resources is the Register's "Whole university" scope now — old links and
 *  bookmarks land there. */
export default function Page() {
  redirect("/register?scope=university");
}
