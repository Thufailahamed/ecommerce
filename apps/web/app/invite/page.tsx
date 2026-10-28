"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";
import { Button, ErrorNote } from "@/components/ui";
import { Mascot, Scene } from "@/components/illustrations";

function Accept() {
  const token = useSearchParams().get("token") ?? "";
  const next = `/invite?token=${encodeURIComponent(token)}`;
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ name: string; role: string } | null>(null);

  useEffect(() => {
    api<{ email: string }>("/api/v1/auth/me").then((m) => { setEmail(m.email); setSignedIn(true); }).catch(() => setSignedIn(false));
  }, []);

  async function accept() {
    setBusy(true); setError(null);
    try { setJoined(await api<{ name: string; role: string }>("/api/v1/invitations/accept", { method: "POST", body: { token } })); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not reach the server."); }
    finally { setBusy(false); }
  }

  if (!token) return <><Scene kind="lost" className="mx-auto w-40" /><h1 className="text-center font-display text-2xl font-extrabold uppercase">Invitation not valid</h1><p className="text-sm text-ink-2">This link is incomplete.</p></>;
  if (joined) return <div role="status" className="space-y-4 text-center"><Scene kind="check" className="mx-auto w-40" /><h1 className="font-display text-2xl font-extrabold uppercase">You&apos;ve joined {joined.name || "the workspace"}</h1><p className="text-sm text-ink-2">Your role: <span className="font-medium text-ink">{joined.role}</span>.</p><Link className="btn btn-primary w-full" href="/app">Open workspace</Link></div>;
  if (signedIn === null) return <div className="flex flex-col items-center gap-4 py-4"><Mascot mood="thinking" size={96} /><p className="text-sm text-ink-3">Loading…</p></div>;
  if (!signedIn) return (
    <div className="space-y-4 text-center">
      <Scene kind="invite" className="mx-auto w-48" />
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight">You&apos;ve been invited</h1>
      <p className="text-sm text-ink-2">Sign in, or create an account with the email address this invitation was sent to, then come back to this page to accept.</p>
      <div className="flex flex-col gap-2"><Link className="btn btn-primary w-full" href={`/signup?next=${encodeURIComponent(next)}`}>Create account</Link><Link className="btn btn-ghost w-full" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></div>
    </div>
  );
  return (
    <div className="space-y-4 text-center">
      <Scene kind="invite" className="mx-auto w-48" />
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight">Accept invitation</h1>
      <p className="text-sm text-ink-2">You&apos;re signed in as <span className="font-medium text-ink">{email}</span>. The invitation only works for the address it was sent to.</p>
      <ErrorNote error={error} />
      <Button variant="primary" busy={busy} onClick={() => void accept()} className="w-full">Join workspace</Button>
    </div>
  );
}

export default function Invite() {
  return <AuthShell><Suspense fallback={null}><Accept /></Suspense></AuthShell>;
}
