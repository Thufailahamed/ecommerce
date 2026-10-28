"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Button, ErrorNote, Field, Input } from "../ui";
import { Section } from "./section";

/** Agencies run one workspace per client: each has its own stores, team and plan. */
export function WorkspacesSection() {
  const { me, reload } = useSession();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("/api/v1/organizations", { method: "POST", body: { name } }); setName(""); await reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not create workspace"); } finally { setBusy(false); }
  }

  return (
    <Section id="workspaces" title="Workspaces" sub="Each workspace has its own stores, team and plan. Create one per client if you manage stores for others.">
      <ErrorNote error={error} />
      <ul className="divide-y divide-line border-y border-line text-sm">
        {me.organizations.map((o) => <li key={o.id} className="flex items-center justify-between py-2.5"><span>{o.name}</span><Badge>{o.role}</Badge></li>)}
      </ul>
      <form className="flex max-w-md items-end gap-3" onSubmit={create}>
        <div className="flex-1"><Field label="New workspace name"><Input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Client name" /></Field></div>
        <Button type="submit" busy={busy}>Create</Button>
      </form>
    </Section>
  );
}
