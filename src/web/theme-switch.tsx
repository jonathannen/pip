import type { ReactNode } from 'react';
import { useState } from 'react';
import styles from './theme-switch.module.css';

type Theme = 'dark' | 'light' | 'system';

interface Option {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: Theme;
}

/** Read before first paint by the inline script in index.html. */
const STORAGE_KEY = 'pip-theme';

const options: readonly Option[] = [
  {
    icon: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
      </>
    ),
    label: 'Light',
    value: 'light',
  },
  {
    icon: <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />,
    label: 'Dark',
    value: 'dark',
  },
  {
    icon: (
      <>
        <rect height="8.5" rx="1.25" width="12" x="2" y="2.5" />
        <path d="M5.5 13.5h5M8 11v2.5" />
      </>
    ),
    label: 'System',
    value: 'system',
  },
];

function current(): Theme {
  const { theme } = document.documentElement.dataset;
  return theme === 'dark' || theme === 'light' ? theme : 'system';
}

/** Light / dark / system. "System" clears the override so CSS follows prefers-color-scheme. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState(current);

  function choose(value: Theme) {
    setTheme(value);
    if (value === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = value;
    }
    try {
      if (value === 'system') {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, value);
      }
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
  }

  return (
    <fieldset aria-label="Theme" className={styles.switch}>
      {options.map((option) => (
        <button
          aria-label={option.label}
          aria-pressed={theme === option.value}
          className={styles.option}
          key={option.value}
          onClick={() => choose(option.value)}
          title={option.label}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16">
            {option.icon}
          </svg>
        </button>
      ))}
    </fieldset>
  );
}
