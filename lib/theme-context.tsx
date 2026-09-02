"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
export type FontSize = "small" | "medium" | "large" | "xlarge";
export type FontFamily = "sans" | "system" | "serif";

export const FONT_SIZES: { key: FontSize; label: string }[] = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Default" },
  { key: "large", label: "Large" },
  { key: "xlarge", label: "Extra large" },
];

export const FONT_FAMILIES: { key: FontFamily; label: string }[] = [
  { key: "sans", label: "IBM Plex Sans" },
  { key: "system", label: "System default" },
  { key: "serif", label: "Serif" },
];

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  fontFamily: FontFamily;
  setFontFamily: (family: FontFamily) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);
const THEME_KEY = "sc-theme";
const FONT_SIZE_KEY = "sc-font-size";
const FONT_FAMILY_KEY = "sc-font-family";

// SSR guard: `typeof window === "undefined"` only stops a crash on the server — during
// the browser's OWN first (hydration) render `window` already exists, so a read here
// would return the real stored/system value immediately and mismatch the server's
// static "light" default, failing hydration. The initializer must always return the
// same default the server rendered (index.html's hardcoded data-theme="light"); the
// real value is read only inside the mount effect below, after hydration completes.
// See the conversion plan §6.1.
function readInitialTheme(): Theme {
  return "light";
}

function readStored<T extends string>(_key: string, _valid: readonly T[], fallback: T): T {
  return fallback;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);
  const [fontSize, setFontSizeState] = useState<FontSize>(() =>
    readStored(FONT_SIZE_KEY, FONT_SIZES.map((f) => f.key), "medium"),
  );
  const [fontFamily, setFontFamilyState] = useState<FontFamily>(() =>
    readStored(FONT_FAMILY_KEY, FONT_FAMILIES.map((f) => f.key), "sans"),
  );

  // Runs once, after hydration — safe to touch localStorage/matchMedia here since this
  // is a real client-only effect, unlike a useState initializer. Calls the RAW state
  // setters only — never localStorage.setItem — so this bootstrap read can never race
  // against, or be clobbered by, a write. See setTheme/setFontSize/setFontFamily below
  // for why persistence is never inferred from a state-change effect.
  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_KEY);
    if (storedTheme === "light" || storedTheme === "dark") setThemeState(storedTheme);
    else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) setThemeState("dark");

    const storedSize = localStorage.getItem(FONT_SIZE_KEY);
    if (FONT_SIZES.some((f) => f.key === storedSize)) setFontSizeState(storedSize as FontSize);

    const storedFamily = localStorage.getItem(FONT_FAMILY_KEY);
    if (FONT_FAMILIES.some((f) => f.key === storedFamily)) setFontFamilyState(storedFamily as FontFamily);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // DOM/CSS sync only, deliberately with NO localStorage write here. Every colour utility
  // resolves through this attribute, so flipping it re-themes the whole app without a
  // single `dark:` variant. Re-running this on every render of `theme` (including the
  // mount effect's own correction above) is safe precisely because it never touches
  // storage — an earlier version wrote localStorage from this same effect, which meant
  // the FIRST run (still on the SSR-safe "light" placeholder, one commit before the
  // mount effect's correction lands) would overwrite a real stored "dark" with "light"
  // before the correction had a chance to apply.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // "medium" needs no attribute at all — :root's own --font-scale: 1 already covers it.
  useEffect(() => {
    if (fontSize === "medium") document.documentElement.removeAttribute("data-font-size");
    else document.documentElement.setAttribute("data-font-size", fontSize);
  }, [fontSize]);

  useEffect(() => {
    if (fontFamily === "sans") document.documentElement.removeAttribute("data-font-family");
    else document.documentElement.setAttribute("data-font-family", fontFamily);
  }, [fontFamily]);

  // The only places localStorage is ever written — at the exact point of a real user
  // action, never speculatively inferred from a state change.
  function setTheme(next: Theme) {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
  }
  function setFontSize(next: FontSize) {
    setFontSizeState(next);
    localStorage.setItem(FONT_SIZE_KEY, next);
  }
  function setFontFamily(next: FontFamily) {
    setFontFamilyState(next);
    localStorage.setItem(FONT_FAMILY_KEY, next);
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggle: () => setTheme(theme === "light" ? "dark" : "light"),
        fontSize,
        setFontSize,
        fontFamily,
        setFontFamily,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
