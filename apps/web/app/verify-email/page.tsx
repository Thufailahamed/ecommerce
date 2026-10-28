"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";

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

  if (state === "working") return <p role="status" className="text-sm text-ink-2">Confirming your email…</p>;
  if (state === "ok") return <div role="status" className="space-y-3"><h1 className="font-display text-3xl font-extrabold">Email confirmed</h1><p className="text-sm text-ink-2">You can now publish campaigns and use AI drafts.</p><Link className="btn btn-primary" href="/app">Go to your workspace</Link></div>;
  return <div className="space-y-3"><h1 className="font-display text-3xl font-extrabold">Link not valid</h1><p className="text-sm text-ink-2">{msg || "This confirmation link is incomplete."} Sign in and use “Resend confirmation” to get a new one.</p><Link className="btn btn-ghost" href="/login">Sign in</Link></div>;
}

export default function VerifyEmail() {
  return <AuthShell><Suspense fallback={null}><Verify /></Suspense></AuthShell>;
}
