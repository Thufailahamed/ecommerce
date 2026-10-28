"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Field, Input } from "./ui";
import { AuthShell } from "./auth-shell";

const TURNSTILE_KEY = process.env["NEXT_PUBLIC_TURNSTILE_SITE_KEY"];

/** Only same-site relative paths: never redirect to a URL taken from the query string. */
const safeNext = (n: string | null) => (n && /^\/(?![\/\\])/.test(n) ? n : "/app");

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === "signup";
  const [token, setToken] = useState<string | undefined>();
  const widget = useRef<HTMLDivElement>(null);

  // Bot protection on signup, enabled when a Turnstile site key is configured.
  useEffect(() => {
    if (!signup || !TURNSTILE_KEY || !widget.current) return;
    const el = widget.current;
    const render = () => (window as unknown as { turnstile?: { render(e: HTMLElement, o: object): void } }).turnstile?.render(el, { sitekey: TURNSTILE_KEY, callback: (t: string) => setToken(t), "expired-callback": () => setToken(undefined) });
    if (document.querySelector("script[data-turnstile]")) { render(); return; }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true; s.dataset["turnstile"] = "1"; s.onload = render;
    document.head.appendChild(s);
  }, [signup]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(signup ? "/api/v1/auth/register" : "/api/v1/auth/login", { method: "POST", body: { email, password, ...(signup && token ? { turnstileToken: token } : {}), ...(needCode && code ? { code: code.trim() } : {}) } });
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === "mfa_required") { setNeedCode(true); setError(null); }
      else setError(err instanceof ApiError ? (err.code === "validation_failed" ? "Use a valid email and a password of at least 10 characters." : err.message) : "Could not reach the server.");
    } finally { setBusy(false); }
  }

  return (
    <AuthShell>
      <form onSubmit={submit} className="space-y-5">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">{signup ? "Create your workspace" : needCode ? "Two-step verification" : "Welcome back"}</h1>
        <p className="-mt-2 text-sm text-ink-2">{signup ? "Free plan, no card required to start." : needCode ? "Enter the code from your authenticator app, or a recovery code." : "Sign in to manage your campaigns."}</p>
        <ErrorNote error={error} />
        <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={needCode} /></Field>
        <Field label="Password" hint={signup ? "At least 10 characters." : undefined}>
          <Input type="password" required minLength={signup ? 10 : 1} autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} disabled={needCode} />
        </Field>
        {needCode && (
          <Field label="Authentication code" hint="6 digits, or a recovery code like ABCDE-12345.">
            <Input autoFocus required inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {signup && TURNSTILE_KEY && <div ref={widget} />}
        <Button type="submit" variant="primary" busy={busy} disabled={signup && !!TURNSTILE_KEY && !token} className="w-full">{signup ? "Create account" : needCode ? "Verify and sign in" : "Sign in"}</Button>
        {!signup && !needCode && <p className="text-sm"><Link className="text-brand underline underline-offset-2" href="/forgot-password">Forgot your password?</Link></p>}
        <p className="text-sm text-ink-2">
          {signup ? "Already have an account?" : "New here?"}{" "}
          <Link className="text-brand underline underline-offset-2" href={signup ? "/login" : "/signup"}>{signup ? "Sign in" : "Create an account"}</Link>
        </p>
      </form>
    </AuthShell>
  );
}
