export const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'colorblind', label: 'Color Blind (High Contrast)' },
  { value: 'solarized', label: 'Solarized Dark' }
] as const;

export type ThemeName = (typeof THEME_OPTIONS)[number]['value'];

export const DEFAULT_THEME: ThemeName = 'dark';

export function isThemeName(value: string): value is ThemeName {
  return THEME_OPTIONS.some((option) => option.value === value);
}

export function getStoredTheme(rawValue: string | null): ThemeName {
  return rawValue && isThemeName(rawValue) ? rawValue : DEFAULT_THEME;
}
