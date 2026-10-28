"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { api, ApiError, type Store } from "@/lib/api";
import { buildGenerateBody, emptyStudioForm, fieldsFor, studioToolOptions, type StudioForm, type StudioTool } from "@/lib/studio";
import { NeedStore } from "@/components/need-store";
import { StudioReview, type StudioResult } from "@/components/studio-review";
import { Button, Empty, ErrorNote, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";

function Studio({ store }: { store: Store }) {
  const [form, setForm] = useState<StudioForm>(emptyStudioForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [result, setResult] = useState<StudioResult | null>(null);
  const set = <K extends keyof StudioForm>(k: K, v: StudioForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const use = fieldsFor(form.tool);

  async function generate(withFeedback = false) {
    setError(null); setIssues([]);
    const built = buildGenerateBody(form, withFeedback);
    if (!built.ok) { setError(built.error); return; }
    setBusy(true);
    try {
      setResult(await api<StudioResult>(`/api/v1/stores/${store.id}/campaigns/ai-generate`, { method: "POST", body: built.body }));
      set("feedback", "");
    } catch (e) {
      if (e instanceof ApiError) { setError(e.message); setIssues(Array.isArray(e.details) ? e.details.filter((d): d is string => typeof d === "string") : []); }
      else setError("Could not reach the server.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader eyebrow="Generate" title="AI campaign studio" sub="Pick a tool, or let the AI choose, and describe what you want to achieve. It drafts the campaign from your real catalog. It never publishes anything: you review, edit and approve." />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <form className="card space-y-5 p-6 md:p-7" onSubmit={(e) => { e.preventDefault(); void generate(false); }}>
          <Field label="What should it build?" hint="Tools that are not available yet cannot be picked.">
            <Select value={form.tool} onChange={(e) => set("tool", e.target.value as StudioTool)}>
              {studioToolOptions().map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="What do you want to achieve?" hint="For example: increase sales of running shoes without discounting everything.">
            <Textarea required minLength={10} maxLength={500} rows={4} value={form.objective} onChange={(e) => set("objective", e.target.value)} />
          </Field>
          {use.format && <Field label="Format (optional)"><Select value={form.format} onChange={(e) => set("format", e.target.value)}><option value="">Let AI choose</option><option value="popup">Popup</option><option value="slide_in">Slide-in</option></Select></Field>}
          <Field label="Constraints (optional)"><Input maxLength={500} value={form.constraints} onChange={(e) => set("constraints", e.target.value)} placeholder="Only on mobile, friendly tone…" /></Field>
          <Field label="Promotion you authorise (optional)" hint="Leave empty and the AI may not mention any discount.">
            <Input maxLength={200} value={form.promo} onChange={(e) => set("promo", e.target.value)} placeholder="e.g. 10% off your first order" />
          </Field>
          {use.threshold && (
            <Field label="Free-shipping threshold (optional)" hint={`In ${store.currency}. Needed for shipping-incentive toasts and shipping-gap recommendations. Without it the AI may not mention a shipping amount.`}>
              <Input inputMode="decimal" value={form.threshold} onChange={(e) => set("threshold", e.target.value)} placeholder="e.g. 75" />
            </Field>
          )}
          {use.consent && (
            <>
              <Field label="Consent wording (optional)" hint="The AI never writes consent text. Leave empty for a standard template, and have a lawyer review whichever wording you use.">
                <Textarea maxLength={600} rows={3} value={form.consentText} onChange={(e) => set("consentText", e.target.value)} placeholder="I agree to receive marketing emails from… I can unsubscribe at any time." />
              </Field>
              <Field label="Privacy policy link (optional)" hint="https:// address or a path. Without it the form links to /privacy-policy, which you must check exists.">
                <Input value={form.privacyUrl} onChange={(e) => set("privacyUrl", e.target.value)} placeholder="https://yourstore.com/privacy" />
              </Field>
            </>
          )}
          <ErrorNote error={error} />
          {issues.length > 0 && <ul className="list-disc pl-5 text-sm text-ink-2">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          <Button type="submit" variant="primary" busy={busy}><Sparkles className="size-4" />Generate draft</Button>
        </form>

        <div aria-live="polite" className="min-w-0">
          {!result && <Empty icon={Sparkles} title="Your draft will appear here" body="You will see a live preview, the audience, and what to check before you approve anything." />}
          {result && (
            <div className="card space-y-6 p-6 md:p-7">
              <StudioReview result={result} domain={store.domain} currency={store.currency} />
              <div className="card-flat flex flex-col gap-3 rounded-2xl border border-line bg-canvas/50 p-3 sm:flex-row">
                <Input aria-label="Feedback for regeneration" placeholder="Tell the AI what to change…" value={form.feedback} onChange={(e) => set("feedback", e.target.value)} />
                <Button onClick={() => void generate(true)} busy={busy} disabled={!form.feedback.trim()}>Regenerate</Button>
              </div>
              <p className="text-xs text-ink-3">Regenerating creates another draft and uses another generation.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function Page() { return <NeedStore>{(s) => <Studio store={s} />}</NeedStore>; }
