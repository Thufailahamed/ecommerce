"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";
import { Mascot, Scene } from "@/components/illustrations";

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "bad">(token ? "working" : "bad");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!token) return;
    api("/api/v1/auth/verify-email", { method: "POST", body: { token } })
      .then(() => setState("ok"))
      .catch((e) => { setMsg(e instanceof ApiError ? e.message : "Could not reach the server."); setState("bad"); });
  }, [token]);

  if (state === "working") return <div role="status" className="flex flex-col items-center gap-4 py-4 text-center"><Mascot mood="thinking" size={96} /><p className="text-sm text-ink-2">Confirming your email…</p></div>;
  if (state === "ok") return <div role="status" className="space-y-4 text-center"><Scene kind="check" className="mx-auto w-40" /><h1 className="font-display text-2xl font-extrabold uppercase">Email confirmed</h1><p className="text-sm text-ink-2">You can now publish campaigns and use AI drafts.</p><Link className="btn btn-primary w-full" href="/app">Go to your workspace</Link></div>;
  return <div className="space-y-4 text-center"><Scene kind="lost" className="mx-auto w-40" /><h1 className="font-display text-2xl font-extrabold uppercase">Link not valid</h1><p className="text-sm text-ink-2">{msg || "This confirmation link is incomplete."} Sign in and use “Resend confirmation” to get a new one.</p><Link className="btn btn-ghost w-full" href="/login">Sign in</Link></div>;
}

export default function VerifyEmail() {
  return <AuthShell><Suspense fallback={null}><Verify /></Suspense></AuthShell>;
}
