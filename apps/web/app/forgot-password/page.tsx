"use client";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { Mascot, Scene } from "@/components/illustrations";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("/api/v1/auth/forgot-password", { method: "POST", body: { email } }); setDone(true); }
    catch (err) { setError(err instanceof ApiError ? (err.code === "email_not_configured" ? "Password reset by email isn't available on this deployment. Contact your administrator." : err.message) : "Could not reach the server."); }
    finally { setBusy(false); }
  }

  return (
    <AuthShell>
      <Scene kind="key" className="mx-auto -mb-2 w-44" />
      <h1 className="text-center font-display text-2xl font-extrabold uppercase tracking-tight">Reset your password</h1>
      {done ? (
        <div role="status" className="space-y-4 text-center">
          <div className="mx-auto w-fit"><Mascot mood="ok" size={84} /></div>
          <p className="text-sm text-ink-2">If an account exists for <span className="font-medium text-ink">{email}</span>, we&apos;ve sent a link that works once and expires in an hour. Check your spam folder if it doesn&apos;t arrive.</p>
          <Link className="text-sm text-brand underline underline-offset-2" href="/login">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <p className="-mt-2 text-center text-sm text-ink-2">Enter your email and we&apos;ll send you a reset link.</p>
          <ErrorNote error={error} />
          <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" variant="primary" busy={busy} className="w-full">Send reset link</Button>
          <p className="text-center text-sm"><Link className="text-brand underline underline-offset-2" href="/login">Back to sign in</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
