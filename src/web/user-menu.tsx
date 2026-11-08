import { Link } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import { ThemeSwitch } from './theme-switch';
import { useDismiss } from './use-dismiss';
import styles from './user-menu.module.css';

/**
 * The signed-in email, which opens a panel with a link to Settings and the theme switch. Closes on
 * Escape, an outside click, tabbing away or following a link.
 */
export function UserMenu({ email }: { readonly email: string }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, menu, trigger, close);

  return (
    <div className={styles.menu} ref={menu}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={styles.trigger}
        onClick={() => setOpen(!open)}
        ref={trigger}
        type="button"
      >
        {email}
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
        </svg>
      </button>
      {open && (
        <div className={styles.panel} id={panelId}>
          <Link className={styles.item} onClick={() => setOpen(false)} to="/settings">
            Settings
          </Link>
          <div className={styles.theme}>
            <span className={styles.label}>Theme</span>
            <ThemeSwitch />
          </div>
        </div>
      )}
    </div>
  );
}
