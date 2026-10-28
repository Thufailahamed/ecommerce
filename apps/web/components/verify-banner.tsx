"use client";
import { useState } from "react";
import { MailWarning } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "./ui";

/** Shown only when this deployment can send email and the account is not yet confirmed. */
export function VerifyBanner() {
  const { security, me } = useSession();
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  if (!security || !security.emailConfigured || security.emailVerified) return null;

  async function resend() {
    setState("busy");
    try { await api("/api/v1/auth/resend-verification", { method: "POST", body: {} }); setState("sent"); }
    catch (e) { setState(e instanceof ApiError && e.status === 429 ? "sent" : "error"); }
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-5 py-2.5 text-sm md:px-10">
      <MailWarning className="size-4 shrink-0 text-warn" aria-hidden />
      <span className="flex-1">Confirm <span className="font-medium">{me.email}</span> to publish campaigns and use AI drafts.</span>
      {state === "sent" ? <span className="text-ok">Sent. Check your inbox.</span> : state === "error" ? <span className="text-danger">Couldn&apos;t send. Try again.</span> : null}
      {state !== "sent" && <Button busy={state === "busy"} onClick={() => void resend()}>Resend confirmation</Button>}
    </div>
  );
}
