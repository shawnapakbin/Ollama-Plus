import { THEME_OPTIONS, type ThemeName } from '../theme';

interface ThemeSelectorProps {
  value: ThemeName;
  onChange: (theme: ThemeName) => void;
  label?: string;
  id?: string;
}

export default function ThemeSelector({ value, onChange, label = 'Theme', id = 'themeSelector' }: ThemeSelectorProps) {
  return (
    <div className="setting-group">
      <label htmlFor={id}>{label}</label>
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as ThemeName)}>
        {THEME_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}