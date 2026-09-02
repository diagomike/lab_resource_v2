import "./globals.css";

/**
 * Phase 1 scaffold — empty shell, proof of toolchain only. The real root layout
 * (theme attribute, metadata title, ThemeProvider, AuthProvider) is ported in Phase 6,
 * once lib/theme-context.tsx and lib/auth-context.tsx exist under this app.
 */
export const metadata = {
  title: "ASTU · Laboratory Resource Management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
