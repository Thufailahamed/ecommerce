"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Badge, Button, ErrorNote, Field, Input, Select } from "../ui";
import { Section } from "./section";

interface Team {
  members: { userId: string; email: string; role: string; joinedAt: string }[];
  invites: { id: string; email: string; role: string; expiresAt: string }[];
}
interface Invited { email: string; role: string; emailed: boolean; inviteUrl: string | null }

export function TeamSection({ orgId, myRole, myUserId }: { orgId: string; myRole: string; myUserId: string }) {
  const base = `/api/v1/organizations/${orgId}`;
  const { data, error: loadError, reload } = useApi<Team>(`${base}/team`);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<Invited | null>(null);
  const [copied, setCopied] = useState(false);
  const canInvite = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); await reload(); } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong"); } finally { setBusy(null); }
  };

  return (
    <Section id="team" title="Team" sub="Owners and admins can invite people. Viewers can look but not change anything; editors can build campaigns; admins can publish.">
      <ErrorNote error={error ?? loadError} />
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="py-2 font-medium">Member</th><th className="font-medium">Role</th><th /></tr></thead>
        <tbody>
          {data?.members.map((m) => (
            <tr key={m.userId} className="border-b border-line">
              <td className="py-2.5">{m.email}{m.userId === myUserId && <span className="ml-2 text-xs text-ink-3">(you)</span>}</td>
              <td className="w-40">
                {isOwner && m.role !== "owner" ? (
                  <Select aria-label={`Role for ${m.email}`} value={m.role} onChange={(e) => void run(`role-${m.userId}`, () => api(`${base}/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } }))}>
                    <option value="admin">admin</option><option value="editor">editor</option><option value="viewer">viewer</option>
                  </Select>
                ) : <Badge tone={m.role === "owner" ? "ok" : "neutral"}>{m.role}</Badge>}
              </td>
              <td className="text-right">
                {m.role !== "owner" && (m.userId === myUserId || canInvite) && (
                  <Button variant="ghost" busy={busy === `rm-${m.userId}`} onClick={() => { if (window.confirm(m.userId === myUserId ? "Leave this workspace?" : `Remove ${m.email}?`)) void run(`rm-${m.userId}`, async () => { await api(`${base}/members/${m.userId}`, { method: "DELETE" }); if (m.userId === myUserId) window.location.href = "/app"; }); }}>
                    {m.userId === myUserId ? "Leave" : "Remove"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {data?.invites.map((i) => (
            <tr key={i.id} className="border-b border-line text-ink-2">
              <td className="py-2.5">{i.email} <span className="text-xs text-ink-3">(invited, expires {new Date(i.expiresAt).toLocaleDateString()})</span></td>
              <td><Badge tone="warn">{i.role} · pending</Badge></td>
              <td className="text-right">{canInvite && <Button variant="ghost" busy={busy === `rev-${i.id}`} onClick={() => void run(`rev-${i.id}`, () => api(`${base}/invites/${i.id}`, { method: "DELETE" }))}>Revoke</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {canInvite && (
        <form className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void run("invite", async () => { setInvited(await api<Invited>(`${base}/invites`, { method: "POST", body: { email, role } })); setEmail(""); }); }}>
          <Field label="Invite by email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" /></Field>
          <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)}>{isOwner && <option value="admin">admin</option>}<option value="editor">editor</option><option value="viewer">viewer</option></Select></Field>
          <Button type="submit" variant="primary" busy={busy === "invite"}>Send invite</Button>
        </form>
      )}
      {invited && (
        <div role="status" className="space-y-2 border-l-2 border-ok bg-ok/10 px-3 py-2.5 text-sm">
          <p>{invited.emailed ? `We emailed ${invited.email}.` : `Email delivery isn't configured, so share this link with ${invited.email} yourself.`} The link works for that address only and expires in 7 days.</p>
          {invited.inviteUrl && (
            <div className="flex items-center gap-2">
              <code className="num min-w-0 flex-1 truncate text-xs" data-testid="invite-url">{invited.inviteUrl}</code>
              <Button onClick={async () => { await navigator.clipboard.writeText(invited.inviteUrl!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}</Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
