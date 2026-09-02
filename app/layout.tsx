import type { Metadata } from "next";
import { ThemeProvider } from "@/lib/theme-context";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASTU · Laboratory Resource Management",
};

/**
 * `data-theme="light"` mirrors the old index.html's hardcoded default — the same
 * first-paint assumption theme-context.tsx's SSR guard (lib/theme-context.tsx) makes,
 * corrected client-side after mount exactly as before. No BrowserRouter: the app/
 * directory's file-based routing needs no root router component.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
