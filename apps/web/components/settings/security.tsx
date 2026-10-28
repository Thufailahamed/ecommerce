"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Button, ErrorNote, Field, Input } from "../ui";
import { Section } from "./section";

export function SecuritySection() {
  const { security, reload } = useSession();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!security) return null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong"); } finally { setBusy(null); }
  };

  return (
    <Section id="security" title="Security" sub="Protect your account with a second step at sign-in. Use any authenticator app (1Password, Authy, Google Authenticator).">
      <ErrorNote error={error} />
      <p className="text-sm">Two-step verification: <Badge tone={security.mfaEnabled ? "ok" : "neutral"}>{security.mfaEnabled ? "On" : "Off"}</Badge>
        {security.emailConfigured && <span className="ml-4">Email: <Badge tone={security.emailVerified ? "ok" : "warn"}>{security.emailVerified ? "Confirmed" : "Not confirmed"}</Badge></span>}</p>

      {codes && (
        <div role="alert" className="space-y-3 border border-warn/50 bg-warn/10 p-4 text-sm">
          <p className="font-medium">Save these recovery codes now. They are shown only once.</p>
          <p>Each works a single time if you lose your authenticator. Store them somewhere safe, like a password manager.</p>
          <ul className="num grid grid-cols-2 gap-1.5 text-[13px]" data-testid="recovery-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <Button onClick={() => { setCodes(null); void reload(); }}>I&apos;ve saved them</Button>
        </div>
      )}

      {!security.mfaEnabled && !setup && !codes && (
        <Button busy={busy === "start"} onClick={() => void run("start", async () => setSetup(await api<{ secret: string; otpauthUrl: string }>("/api/v1/auth/mfa/start", { method: "POST", body: {} })))}>Set up two-step verification</Button>
      )}

      {setup && !security.mfaEnabled && (
        <form className="max-w-md space-y-4" onSubmit={(e) => { e.preventDefault(); void run("confirm", async () => { const r = await api<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/confirm", { method: "POST", body: { code } }); setCodes(r.recoveryCodes); setSetup(null); setCode(""); }); }}>
          <p className="text-sm text-ink-2">In your authenticator app, add an account manually and enter this key:</p>
          <code className="num block break-all border border-line bg-surface p-3 text-sm" data-testid="mfa-secret">{setup.secret}</code>
          <details className="text-xs text-ink-3"><summary className="cursor-pointer">Setup link (for apps that accept otpauth links)</summary><code className="num mt-1 block break-all">{setup.otpauthUrl}</code></details>
          <Field label="6-digit code from the app"><Input inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <div className="flex gap-2"><Button type="submit" variant="primary" busy={busy === "confirm"}>Turn on</Button><Button type="button" variant="ghost" onClick={() => setSetup(null)}>Cancel</Button></div>
        </form>
      )}

      {security.mfaEnabled && !codes && (
        <form className="max-w-md space-y-3" onSubmit={(e) => { e.preventDefault(); void run("disable", async () => { await api("/api/v1/auth/mfa/disable", { method: "POST", body: { password, code } }); setPassword(""); setCode(""); await reload(); }); }}>
          <p className="text-sm text-ink-2">{security.recoveryCodesLeft} recovery code{security.recoveryCodesLeft === 1 ? "" : "s"} left. To turn this off, confirm with your password and a current code.</p>
          <Field label="Password"><Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Code or recovery code"><Input required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Button type="submit" variant="danger" busy={busy === "disable"}>Turn off two-step verification</Button>
        </form>
      )}
    </Section>
  );
}
