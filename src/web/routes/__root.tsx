import type { ErrorComponentProps } from '@tanstack/react-router';
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import type { Me } from '../../shared/api';
import logo from '../logo.png';
import type { GuardStore, MeFailure } from '../reauth';
import { LOGOUT_PATH, recover, recovered } from '../reauth';
import { UserMenu } from '../user-menu';
import styles from './root.module.css';

/** `/api/me` failed in a way signing in again might fix, and doing that by itself is used up. */
class SignInError extends Error {
  readonly title: string;

  constructor(title: string, message: string) {
    super(message);
    this.title = title;
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

/**
 * Signs in again after a failed `/api/me`, once (src/web/reauth.ts); after that, or offline, where
 * a reload would only lose the page, it throws for the error screen. A preload only throws.
 */
async function signInAgain(failure: MeFailure, preload: boolean): Promise<never> {
  const online = failure === 'unauthorized' || navigator.onLine;
  const recovery = preload || !online ? 'none' : recover(failure, guardStore());
  if (recovery === 'none') {
    throw failure === 'unauthorized'
      ? new SignInError('Sign-in failed', "pip didn't accept your sign-in (/api/me 401).")
      : new SignInError("Can't reach pip", 'You may be offline, or your sign-in may have run out.');
  }
  if (recovery === 'logout') {
    location.assign(LOGOUT_PATH);
  } else {
    location.reload();
  }
  // The page is on its way out; nothing to render in the meantime.
  return new Promise(() => {});
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
      return signInAgain('unreachable', preload);
    }
    if (res.status === 401) {
      return signInAgain('unauthorized', preload);
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
 * button, so the ways out are here: a real navigation to Access's logout, and a reload.
 */
function Failure({ error }: ErrorComponentProps) {
  const signIn = error instanceof SignInError;
  return (
    <main className={styles.main}>
      <div className={styles.failure}>
        <h1>{signIn ? error.title : 'Something went wrong'}</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
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
