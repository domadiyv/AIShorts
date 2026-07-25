import { adminPassword } from '../../lib/auth';
import { login } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const configured = adminPassword() !== null;

  return (
    <main className="wrap login-wrap">
      <h1>AIShorts — Admin</h1>
      <p className="sub">Sign in to review and publish cards.</p>

      {!configured ? (
        <div className="empty">
          <strong>No password configured.</strong>
          <br />
          Add <code>ADMIN_PASSWORD=your-long-random-password</code> to{' '}
          <code>D:\Claude\AiShorts\.env</code>, then restart the admin server.
        </div>
      ) : (
        <form className="card login-card" action={login}>
          <input type="hidden" name="next" value={sp.next ?? '/'} />
          <label className="login-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
          />
          {sp.error === '1' && <p className="login-error">Incorrect password. Try again.</p>}
          <button className="btn-approve" type="submit">
            Sign in
          </button>
        </form>
      )}
    </main>
  );
}
