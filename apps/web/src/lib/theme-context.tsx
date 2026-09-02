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

function readInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStored<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  const stored = localStorage.getItem(key);
  return (valid as readonly string[]).includes(stored ?? "") ? (stored as T) : fallback;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [fontSize, setFontSize] = useState<FontSize>(() =>
    readStored(FONT_SIZE_KEY, FONT_SIZES.map((f) => f.key), "medium"),
  );
  const [fontFamily, setFontFamily] = useState<FontFamily>(() =>
    readStored(FONT_FAMILY_KEY, FONT_FAMILIES.map((f) => f.key), "sans"),
  );

  // Every colour utility resolves through a CSS variable keyed off this attribute, so
  // flipping it re-themes the whole app without a single `dark:` variant.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // "medium" needs no attribute at all — :root's own --font-scale: 1 already covers
  // it, so this only ever sets the attribute for a size that actually overrides it.
  useEffect(() => {
    if (fontSize === "medium") document.documentElement.removeAttribute("data-font-size");
    else document.documentElement.setAttribute("data-font-size", fontSize);
    localStorage.setItem(FONT_SIZE_KEY, fontSize);
  }, [fontSize]);

  useEffect(() => {
    if (fontFamily === "sans") document.documentElement.removeAttribute("data-font-family");
    else document.documentElement.setAttribute("data-font-family", fontFamily);
    localStorage.setItem(FONT_FAMILY_KEY, fontFamily);
  }, [fontFamily]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")),
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
