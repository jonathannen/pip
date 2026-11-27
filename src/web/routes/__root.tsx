import type { ErrorComponentProps } from '@tanstack/react-router';
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import type { Me, Unauthorized } from '../../shared/api';
import logo from '../logo.png';
import type { GuardStore } from '../reauth';
import { LOGOUT_PATH, reasonRows, recovered, reloadOnce, unauthorized } from '../reauth';
import { UserMenu } from '../user-menu';
import styles from './root.module.css';

/** `/api/me` failed in a way signing in again might fix. `why` is the Worker's reason for a 401. */
class SignInError extends Error {
  readonly title: string;
  readonly why: Unauthorized | undefined;

  constructor(title: string, message: string, why?: Unauthorized) {
    super(message);
    this.title = title;
    this.why = why;
  }
}

/** sessionStorage, or nothing where the browser keeps it from the page (reading it can throw). */
function guardStore(): GuardStore | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export const Route = createRootRoute({
  loader: async ({ preload }): Promise<Me> => {
    let res: Response;
    try {
      res = await fetch('/api/me');
    } catch (error) {
      // A TypeError is no network, or Access redirecting to its sign-in, which is another origin.
      if (!(error instanceof TypeError)) {
        throw error;
      }
      // A page load can follow that redirect. Once (src/web/reauth.ts), and not offline, where a
      // reload would only lose the page, nor for a preload.
      if (!preload && navigator.onLine && reloadOnce(guardStore())) {
        location.reload();
        // The page is on its way out; nothing to render in the meantime.
        return new Promise(() => {});
      }
      throw new SignInError(
        "Can't reach pip",
        'You may be offline, or your sign-in may have run out.',
      );
    }
    if (res.status === 401) {
      // Always the error screen, with the Worker's reason on it; signing out is left to the link.
      const why = unauthorized(await res.json().catch(() => null));
      throw new SignInError(
        'Sign-in failed',
        why
          ? "pip didn't accept your sign-in."
          : "/api/me answered 401 without a reason, so it may not have come from pip's Worker.",
        why,
      );
    }
    if (!res.ok) {
      throw new Error(`/api/me ${res.status}`);
    }
    recovered(guardStore());
    return res.json();
  },
  component: Root,
  errorComponent: Failure,
  notFoundComponent: () => <p>Not found.</p>,
});

/**
 * Stands in for the whole page when `/api/me` fails. Installed, pip has no address bar or reload
 * button, so the ways out are here: a real navigation to Access's logout, and a reload. A 401 shows
 * why the Worker said no, to read off a screenshot.
 */
function Failure({ error }: ErrorComponentProps) {
  const signIn = error instanceof SignInError;
  return (
    <main className={styles.main}>
      <div className={styles.failure}>
        <h1>{signIn ? error.title : 'Something went wrong'}</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        {signIn && error.why && (
          <dl className={styles.details}>
            {reasonRows(error.why).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className={styles.actions}>
          {signIn && (
            <a className={styles.action} href={LOGOUT_PATH}>
              Sign out and sign in again
            </a>
          )}
          <button onClick={() => location.reload()} type="button">
            Reload
          </button>
        </div>
      </div>
    </main>
  );
}

function Root() {
  const me = Route.useLoaderData();
  return (
    <>
      <header className={styles.header}>
        <nav className={styles.nav}>
          <Link className={styles.brand} to="/">
            <img alt="" className={styles.mark} src={logo} />
            pip
          </Link>
          <Link activeOptions={{ exact: true }} className={styles.link} to="/">
            Notes
          </Link>
          <Link className={styles.link} to="/code">
            Code
          </Link>
          <Link className={styles.link} to="/mcp">
            MCP
          </Link>
          <Link className={styles.link} to="/schedules">
            Schedules
          </Link>
          <UserMenu email={me.email} />
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </>
  );
}
