import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import type { Me } from '../../shared/api';
import logo from '../logo.png';
import { UserMenu } from '../user-menu';
import styles from './root.module.css';

export const Route = createRootRoute({
  loader: async (): Promise<Me> => {
    const res = await fetch('/api/me');
    if (!res.ok) {
      throw new Error(`/api/me ${res.status}`);
    }
    return res.json();
  },
  component: Root,
  notFoundComponent: () => <p>Not found.</p>,
});

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
          <Link className={styles.link} to="/about">
            About
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
