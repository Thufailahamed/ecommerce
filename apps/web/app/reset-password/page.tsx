"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { Mascot, Scene } from "@/components/illustrations";

function Form() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (password !== confirm) { setError("The passwords don't match."); return; }
    setBusy(true);
    try { await api("/api/v1/auth/reset-password", { method: "POST", body: { token, password } }); setDone(true); }
    catch (err) { setError(err instanceof ApiError ? (err.code === "validation_failed" ? "Use at least 10 characters." : err.message) : "Could not reach the server."); }
    finally { setBusy(false); }
  }

  if (!token) return <><Scene kind="lost" className="mx-auto w-40" /><h1 className="text-center font-display text-2xl font-extrabold uppercase">Link not valid</h1><p className="text-sm text-ink-2">This reset link is incomplete. <Link className="text-brand underline" href="/forgot-password">Request a new one</Link>.</p></>;
  if (done) return <div role="status" className="space-y-3 text-center"><Scene kind="shield" className="mx-auto w-40" /><h1 className="font-display text-2xl font-extrabold uppercase">Password updated</h1><p className="text-sm text-ink-2">You&apos;ve been signed out everywhere. Sign in with your new password.</p><Link className="btn btn-primary w-full" href="/login">Sign in</Link></div>;
  return (
    <form onSubmit={submit} className="space-y-5">
      <Scene kind="shield" className="mx-auto -mb-2 w-40" />
      <h1 className="text-center font-display text-2xl font-extrabold uppercase tracking-tight">Choose a new password</h1>
      <ErrorNote error={error} />
      <Field label="New password" hint="At least 10 characters."><Input type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Field label="Confirm new password"><Input type="password" required minLength={10} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      <Button type="submit" variant="primary" busy={busy} className="w-full">Update password</Button>
    </form>
  );
}

export default function ResetPassword() {
  return <AuthShell><Suspense fallback={null}><Form /></Suspense></AuthShell>;
}
