import { sessionSecret } from '../../lib/auth';
import { login } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const configured = sessionSecret() !== null;

  return (
    <main className="wrap login-wrap">
      <h1>AIShorts — Admin</h1>
      <p className="sub">Sign in to review and publish cards.</p>

      {!configured ? (
        <div className="empty">
          <strong>Admin not configured.</strong>
          <br />
          Set <code>ADMIN_TOKEN</code> in <code>.env</code> and create an operator with{' '}
          <code>npm run -w @aishorts/api create-admin</code>, then restart the admin server.
        </div>
      ) : (
        <form className="card login-card" action={login}>
          <input type="hidden" name="next" value={sp.next ?? '/'} />
          <label className="login-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
          />
          <label className="login-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          {sp.error === '1' && <p className="login-error">Incorrect email or password. Try again.</p>}
          <button className="btn-approve" type="submit">
            Sign in
          </button>
        </form>
      )}
    </main>
  );
}
