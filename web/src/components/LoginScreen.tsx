import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, LogIn } from "lucide-react";
import { api, setAuthListener, type AuthStatus } from "../lib/api";
import { Button, cx, inputCls } from "./ui";

/**
 * Shows the app only to this computer or a logged-in device. Another device (a phone) gets the
 * password screen first, and again whenever the server stops accepting its login.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.authStatus().then(setStatus, (e: Error) => setError(e.message));
    setAuthListener(() => setStatus((s) => (s ? { ...s, loggedIn: false } : s)));
    return () => setAuthListener(null);
  }, []);

  if (error) {
    return (
      <Card>
        <p className="mt-3 text-sm text-ink-2">Can't reach StudySpace ({error}). Is it running on the computer, and is the computer awake?</p>
      </Card>
    );
  }
  if (!status) return <div className="min-h-dvh bg-viewer" />;
  if (!status.loggedIn) return <LoginScreen passwordSet={status.passwordSet} onLoggedIn={setStatus} />;
  return children;
}

function Card({ children, onSubmit }: { children: ReactNode; onSubmit?: (e: FormEvent) => void }) {
  return (
    <div className="grid min-h-dvh place-items-center overflow-y-auto bg-viewer p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-7" />
          <h1 className="text-lg font-semibold">StudySpace</h1>
        </div>
        {children}
      </form>
    </div>
  );
}

function LoginScreen({ passwordSet, onLoggedIn }: { passwordSet: boolean; onLoggedIn: (s: AuthStatus) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await api.login(password));
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  if (!passwordSet) {
    return (
      <Card>
        <p className="mt-3 text-sm text-ink-2">StudySpace has no password yet, so it only works on the computer itself.</p>
        <p className="mt-2 text-sm text-ink-2">
          On the computer, add <code className="rounded bg-subtle px-1">STUDYSPACE_PASSWORD=…</code> to the <code className="rounded bg-subtle px-1">.env</code> file in
          the StudySpace folder, then restart StudySpace.
        </p>
      </Card>
    );
  }

  return (
    <Card onSubmit={submit}>
      <p className="mt-3 text-sm text-ink-2">Enter the password set on the computer. This device then stays logged in for 90 days.</p>
      {/* 16px text, or iPhones zoom in on the field. */}
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        aria-label="Password"
        placeholder="Password"
        className={cx(inputCls, "mt-4 h-10 text-base")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" className="mt-4 h-10 w-full" disabled={busy || !password}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Log in
      </Button>
    </Card>
  );
}
