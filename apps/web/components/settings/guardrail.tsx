"use client";
import { useState } from "react";
import { api, ApiError, type Store } from "@/lib/api";
import { Badge, Button, ErrorNote, Field, Input } from "../ui";
import { Section } from "./section";
import { Percent } from "lucide-react";

/** Margin guardrail: promotions are off until a store sets the highest discount it can afford. */
export function DiscountGuardrail({ store, current, canEdit, onChanged }: { store: Store; current: number | null | undefined; canEdit: boolean; onChanged: () => void | Promise<void> }) {
  const [value, setValue] = useState(current ? String(current) : "20");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: number | null) {
    setBusy(true); setError(null);
    try { await api(`/api/v1/stores/${store.id}/settings`, { method: "PATCH", body: { maxDiscountPercent: next } }); await onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not save"); } finally { setBusy(false); }
  }

  const on = typeof current === "number";
  return (
    <Section id="promotions" icon={Percent} title="Promotions guardrail" sub="Campaigns can show a discount code you create. To protect margin, promotions stay off until you set the biggest discount this store can afford. Anything higher is blocked at publish. AI never creates promotions.">
      <ErrorNote error={error} />
      <p className="text-sm">Promotions: <Badge tone={on ? "ok" : "neutral"}>{on ? `On, up to ${current}% off` : "Off"}</Badge></p>
      {canEdit && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void save(Number(value)); }}>
          <Field label="Maximum discount (%)"><Input type="number" min={1} max={90} required className="w-28" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Button type="submit" busy={busy}>{on ? "Update limit" : "Allow promotions"}</Button>
          {on && <Button type="button" variant="ghost" onClick={() => void save(null)}>Turn off</Button>}
        </form>
      )}
    </Section>
  );
}
