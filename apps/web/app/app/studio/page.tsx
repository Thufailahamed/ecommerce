"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowUpRight, Check, CornerDownLeft, MessageSquare, Monitor, PenLine, RotateCcw,
  ScanSearch, ShieldCheck, Smartphone, Sparkles, X,
} from "lucide-react";
import { CampaignConfig } from "@convertflow/contracts";
import { api, ApiError, type Store } from "@/lib/api";
import { buildGenerateBody, emptyStudioForm, fieldsFor, studioToolOptions, type StudioForm, type StudioTool } from "@/lib/studio";
import { NeedStore } from "@/components/need-store";
import { StudioReview, type StudioResult } from "@/components/studio-review";
import type { Device, PreviewField } from "@/components/campaign-preview";
import { AgentOrb, ChangeCard, RunTimeline, type DraftChange } from "@/components/studio-agent";
import { Badge, Button, ErrorNote, Field, Input, Select, Textarea, LiveDot } from "@/components/ui";

const FIELD_LABEL: Record<PreviewField, string> = { headline: "Headline", body: "Body", cta: "Button", form: "Signup form" };
const SUGGESTIONS: Record<PreviewField | "general", string[]> = {
  headline: ["Make it shorter", "Make it more specific", "Lead with the benefit"],
  body: ["Make it one sentence", "Use a friendlier tone", "Mention the product"],
  cta: ["Use a stronger verb", "Make it about the shopper", "Shorten it"],
  form: ["Explain what they will get", "Make the value clearer"],
  general: ["Make it shorter", "Use a friendlier tone", "Strengthen the call to action", "Make the offer clearer"],
};

const TOOL_HINT: Record<StudioTool, string> = {
  auto: "The agent picks the format that fits the goal.",
  toast: "A small, non-blocking message that never covers the page.",
  feed: "A notification bell shoppers can reopen whenever they want.",
  upsell: "Relevant, in-stock products with add-to-cart in place.",
  email: "A consent-aware email capture form with double opt-in.",
  sms: "Not available yet.",
};

const QUICK_BRIEFS: Array<{ title: string; objective: string; tool: StudioTool }> = [
  { title: "Recover carts", tool: "toast", objective: "Recover shoppers who added items to their cart but did not buy, without discounting everything." },
  { title: "Grow email list", tool: "email", objective: "Grow my email list with a welcome popup that explains the value of subscribing." },
  { title: "Announce a launch", tool: "toast", objective: "Announce our new collection to returning shoppers on the home page." },
  { title: "Recommend products", tool: "upsell", objective: "Recommend relevant in-stock products in the cart to raise order value." },
];

const PLAN = [
  { icon: ScanSearch, title: "Reads your catalog", body: "Real products, prices and stock. No guessed inventory." },
  { icon: PenLine, title: "Drafts the campaign", body: "Copy, layout, trigger, audience and frequency." },
  { icon: ShieldCheck, title: "Checks every claim", body: "Policy, consent and the facts you supplied." },
];

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  changes?: DraftChange[];
  meta?: { model?: string; gateway?: boolean; tokens?: number };
}

function fieldValue(c: CampaignConfig, field: PreviewField): string {
  return field === "headline" ? c.creative.headline : field === "body" ? c.creative.body : field === "cta" ? c.creative.ctaLabel : "Signup form";
}

/** Compare the saved draft before and after a refinement, so the thread can show a real before/after edit. */
function diffConfig(before: CampaignConfig, after: CampaignConfig, only: PreviewField | null): DraftChange[] {
  if (only === "form") {
    return JSON.stringify(before.form) === JSON.stringify(after.form) ? [] : [{ label: "Signup form", from: "", to: "The form copy and consent details were updated." }];
  }
  const fields: PreviewField[] = only ? [only] : ["headline", "body", "cta"];
  return fields.flatMap((field) => {
    const from = fieldValue(before, field);
    const to = fieldValue(after, field);
    return from === to ? [] : [{ label: FIELD_LABEL[field], from, to }];
  });
}

const shortModel = (m: string) => m.split("/").pop() ?? m;

function Studio({ store }: { store: Store }) {
  const [form, setForm] = useState<StudioForm>(emptyStudioForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [result, setResult] = useState<StudioResult | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [selected, setSelected] = useState<PreviewField | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [runStep, setRunStep] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const objectiveId = useId();
  const set = <K extends keyof StudioForm>(k: K, v: StudioForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const use = fieldsFor(form.tool);
  const parsed = useMemo(() => result ? CampaignConfig.safeParse(result.campaign.draftConfig) : null, [result]);
  const selectedValue = useMemo(() => {
    if (!selected || !parsed?.success) return "";
    return fieldValue(parsed.data, selected);
  }, [selected, parsed]);

  // A simple, honest representation of the phases the server runs synchronously. It resets as soon as the request ends.
  useEffect(() => {
    if (!busy) { setRunStep(0); return; }
    const timers = [
      setTimeout(() => setRunStep(1), 650),
      setTimeout(() => setRunStep(2), 1800),
      setTimeout(() => setRunStep(3), 3400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [busy]);

  async function generate(withFeedback = false) {
    if (busy) return;
    setError(null); setIssues([]);
    const raw = form.feedback.trim();
    if (withFeedback && !result) return;
    if (withFeedback && !raw) { setError("Tell the AI what to change first."); return; }
    const instruction = withFeedback && selected ? `Change the ${FIELD_LABEL[selected].toLowerCase()} in the current draft. ${raw}` : raw;
    const bodyForm = withFeedback ? { ...form, feedback: instruction } : form;
    const built = buildGenerateBody(bodyForm, withFeedback, withFeedback ? result?.campaign.id : undefined);
    if (!built.ok) { setError(built.error); return; }
    const before = result ? CampaignConfig.safeParse(result.campaign.draftConfig) : null;
    if (withFeedback) setHistory((h) => [...h, { role: "user", text: instruction }]);
    setBusy(true);
    try {
      const res = await api<StudioResult>(`/api/v1/stores/${store.id}/campaigns/ai-generate`, { method: "POST", body: built.body });
      setResult(res);
      const after = CampaignConfig.safeParse(res.campaign.draftConfig);
      const changes = withFeedback && before?.success && after.success ? diffConfig(before.data, after.data, selected) : [];
      const tokens = (res.usage?.inputTokens ?? 0) + (res.usage?.outputTokens ?? 0);
      const assistant: ChatMessage = {
        role: "assistant",
        text: res.explanation,
        ...(changes.length ? { changes } : {}),
        ...(res.model || res.gateway !== undefined || tokens ? {
          meta: {
            ...(res.model ? { model: res.model } : {}),
            ...(res.gateway !== undefined ? { gateway: res.gateway } : {}),
            ...(tokens ? { tokens } : {}),
          },
        } : {}),
      };
      setHistory((h) => withFeedback ? [...h, assistant] : [{ role: "user", text: bodyForm.objective.trim() }, assistant]);
      set("feedback", "");
      if (!withFeedback) setSelected(null);
    } catch (e) {
      if (e instanceof ApiError) { setError(e.message); setIssues(Array.isArray(e.details) ? e.details.filter((d): d is string => typeof d === "string") : []); }
      else setError("Could not reach the server.");
    } finally { setBusy(false); }
  }

  // Keep the newest turn in view as the thread grows.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, busy]);

  function startOver() {
    setResult(null); setHistory([]); setSelected(null); setError(null); setIssues([]); setDevice("desktop"); set("feedback", "");
  }

  const onObjectiveKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
  };

  return (
    <div className="pb-8">
      <header className="relative mb-6 overflow-hidden rounded-[1.75rem] border border-line bg-surface/60 p-6 md:p-7">
        <div aria-hidden className="agent-grid pointer-events-none absolute inset-0 opacity-60" />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-brand-solid/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="eyebrow mb-3">Agent workspace</div>
            <h1 className="font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tight md:text-5xl">AI campaign <span className="text-grad">studio</span></h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">Describe the outcome. The agent reads your catalog, drafts the campaign and checks every claim. It never publishes: you review, edit and approve.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-canvas/60 px-3 py-1.5 text-xs text-ink-2">
              <AgentOrb size={18} state={busy ? "working" : result ? "done" : "idle"} />
              {busy ? "Agent working" : result ? "Draft ready" : "Agent ready"}
            </span>
            <Badge tone="neutral">Drafts only</Badge>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <aside className={clsx("min-w-0", result && "xl:sticky xl:top-6")}>
          {!result ? (
            <form className="card overflow-hidden" onSubmit={(e) => { e.preventDefault(); void generate(false); }}>
              <div className="flex items-center justify-between border-b border-line bg-ink/[0.02] px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="grid size-6 place-items-center rounded-lg bg-brand-solid text-[10px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(35,80,255,1)]">1</span>
                  <h2 className="font-display text-[11px] font-bold uppercase tracking-[0.16em]">Brief the agent</h2>
                </div>
                <span className="text-[11px] text-ink-3">~10 seconds</span>
              </div>

              <div className="space-y-5 p-5">
                <Field label="What should it build?" hint={TOOL_HINT[form.tool]}>
                  <Select value={form.tool} onChange={(e) => set("tool", e.target.value as StudioTool)}>
                    {studioToolOptions().map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
                  </Select>
                </Field>

                <div>
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <label htmlFor={objectiveId} className="text-[13px] font-medium text-ink-2">What do you want to achieve?</label>
                    <span className="num text-[10px] text-ink-3">{form.objective.length}/500</span>
                  </div>
                  <Textarea id={objectiveId} required minLength={10} maxLength={500} rows={4} value={form.objective}
                    onChange={(e) => set("objective", e.target.value)} onKeyDown={onObjectiveKeyDown}
                    placeholder="e.g. Increase sales of running shoes without discounting everything."
                    className="min-h-[112px] resize-none rounded-2xl bg-canvas/70 px-4 py-3.5 text-[15px] leading-relaxed" />
                  <p className="mt-1.5 text-xs text-ink-3">The more specific the outcome, the better the draft. <span aria-hidden className="num ml-1 rounded border border-line px-1 text-[10px]">⌘↵</span></p>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3"><Sparkles className="size-3 text-brand" aria-hidden />Start from a brief</div>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_BRIEFS.map((b) => (
                      <button key={b.title} type="button" onClick={() => { set("objective", b.objective); set("tool", b.tool); }}
                        className="group inline-flex items-center gap-1 rounded-full border border-line bg-ink/[0.02] px-2.5 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:border-brand-tint hover:bg-brand-soft hover:text-ink">
                        {b.title}<ArrowUpRight className="size-3 text-ink-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                      </button>
                    ))}
                  </div>
                </div>

                {use.format && <Field label="Format (optional)"><Select value={form.format} onChange={(e) => set("format", e.target.value)}><option value="">Let AI choose</option><option value="popup">Popup</option><option value="slide_in">Slide-in</option></Select></Field>}

                <div className="overflow-hidden rounded-2xl border border-line bg-canvas/40">
                  <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand" aria-hidden /><span className="text-xs font-semibold">Guardrails</span></div>
                    <span className="rounded-full bg-ink/[0.05] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-3">Optional</span>
                  </div>
                  <div className="space-y-4 p-4">
                    <p className="text-[11px] leading-relaxed text-ink-3">Facts the agent must not invent. Blank means it will avoid the claim.</p>
                    <Field label="Constraints (optional)"><Input maxLength={500} value={form.constraints} onChange={(e) => set("constraints", e.target.value)} placeholder="Only on mobile, friendly tone…" /></Field>
                    <Field label="Promotion you authorise (optional)" hint="Leave empty and the AI may not mention any discount.">
                      <Input maxLength={200} value={form.promo} onChange={(e) => set("promo", e.target.value)} placeholder="e.g. 10% off your first order" />
                    </Field>
                    {use.threshold && (
                      <Field label="Free-shipping threshold (optional)" hint={`In ${store.currency}. Needed for shipping-incentive toasts and shipping-gap recommendations.`}>
                        <Input inputMode="decimal" value={form.threshold} onChange={(e) => set("threshold", e.target.value)} placeholder="e.g. 75" />
                      </Field>
                    )}
                    {use.consent && (
                      <>
                        <Field label="Consent wording (optional)" hint="The AI never writes consent text. Leave empty for standard wording; have a lawyer review it.">
                          <Textarea maxLength={600} rows={3} value={form.consentText} onChange={(e) => set("consentText", e.target.value)} placeholder="I agree to receive marketing emails from… I can unsubscribe at any time." />
                        </Field>
                        <Field label="Privacy policy link (optional)" hint="https:// address or a path. Without it, the form links to /privacy-policy.">
                          <Input value={form.privacyUrl} onChange={(e) => set("privacyUrl", e.target.value)} placeholder="https://yourstore.com/privacy" />
                        </Field>
                      </>
                    )}
                  </div>
                </div>

                <ErrorNote error={error} />
                {issues.length > 0 && <ul className="list-disc pl-5 text-sm text-ink-2">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}

                <Button type="submit" variant="primary" busy={busy} className="h-12 w-full rounded-2xl text-[15px]">
                  <Sparkles className="size-4" aria-hidden />
                  Generate draft
                  <span aria-hidden className="ml-auto hidden items-center gap-0.5 rounded-md border border-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/70 sm:inline-flex"><CornerDownLeft className="size-3" />⌘</span>
                </Button>
                <p className="text-center text-[11px] text-ink-3">One generation. Nothing is published until you approve it.</p>
              </div>
            </form>
          ) : (
            <section className="card overflow-hidden" aria-label="Agent thread">
              <div className="flex items-center justify-between gap-3 border-b border-line bg-ink/[0.02] px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <AgentOrb size={26} state="done" />
                  <div className="min-w-0">
                    <h2 className="font-display text-[11px] font-bold uppercase tracking-[0.16em]">Agent thread</h2>
                    <p className="truncate text-[10px] text-ink-3">{result.updated ? "Draft updated" : "Draft created"} · {history.length} {history.length === 1 ? "message" : "messages"}</p>
                  </div>
                </div>
                <button type="button" onClick={startOver} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-ink-3 transition-colors hover:bg-ink/[0.06] hover:text-ink">
                  <RotateCcw className="size-3" aria-hidden />New brief
                </button>
              </div>

              <div ref={logRef} role="log" aria-label="AI conversation" className="max-h-[420px] space-y-4 overflow-y-auto p-4">
                {history.map((m, i) => m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[92%] rounded-2xl rounded-br-md bg-brand-solid px-3.5 py-2.5 text-sm text-white shadow-[0_10px_24px_-14px_rgba(35,80,255,1)]">
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/60">You</div>
                      <p className="leading-relaxed">{m.text}</p>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex gap-2.5">
                    <AgentOrb size={26} state="idle" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">Campaign agent</span>
                        {m.meta?.gateway && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ok"><Check className="size-3" aria-hidden />via gateway</span>}
                      </div>
                      <p className="text-sm leading-relaxed text-ink-2">{m.text}</p>
                      {m.changes && m.changes.length > 0 && <ChangeCard changes={m.changes} />}
                      {m.meta && (m.meta.model || m.meta.tokens) && (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-ink-3">
                          {m.meta.model && <span className="rounded-full border border-line px-2 py-0.5" title={m.meta.model}>{shortModel(m.meta.model)}</span>}
                          {m.meta.tokens ? <span className="num rounded-full border border-line px-2 py-0.5">{m.meta.tokens} tokens</span> : null}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-line bg-canvas/40 p-4">
                {selected ? (
                  <div className="mb-2.5 flex items-start justify-between gap-2 rounded-xl border border-brand-tint bg-brand-soft px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">Editing: {FIELD_LABEL[selected]}</div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{selectedValue}</p>
                    </div>
                    <button type="button" onClick={() => setSelected(null)} aria-label="Clear selection" className="grid size-6 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-ink/[0.08] hover:text-ink"><X className="size-3.5" aria-hidden /></button>
                  </div>
                ) : (
                  <p className="mb-2.5 text-[11px] leading-relaxed text-ink-3">Tip: click the headline, body, button or form in the preview to edit just that part.</p>
                )}

                <div className="flex gap-2">
                  <Input aria-label={selected ? `Instruction for ${FIELD_LABEL[selected].toLowerCase()}` : "Feedback for regeneration"}
                    placeholder={selected ? `Change the ${FIELD_LABEL[selected].toLowerCase()}…` : "Tell the AI what to change…"}
                    value={form.feedback} onChange={(e) => set("feedback", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void generate(true); } }}
                    className="h-11 rounded-xl" />
                  <Button variant="primary" onClick={() => void generate(true)} busy={busy} disabled={!form.feedback.trim()} className="h-11 shrink-0 rounded-xl px-4">Regenerate</Button>
                </div>

                <div role="group" aria-label="Suggested changes" className="mt-2.5 flex flex-wrap gap-1.5">
                  {(selected ? SUGGESTIONS[selected] : SUGGESTIONS.general).map((s) => (
                    <button key={s} type="button" onClick={() => set("feedback", s)} className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:border-brand-tint hover:bg-brand-soft hover:text-ink">{s}</button>
                  ))}
                </div>

                {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
                {issues.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-danger">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
              </div>
            </section>
          )}
        </aside>

        <section aria-live="polite" className={clsx("min-w-0", !result && "xl:sticky xl:top-6")}>
          {!result && (busy ? (
            <div className="relative overflow-hidden rounded-[1.75rem] border border-line bg-surface-2" aria-busy="true">
              <div aria-hidden className="agent-grid pointer-events-none absolute inset-0 opacity-50" />
              <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <AgentOrb size={26} state="working" />
                  <span className="text-sm font-medium">Agent is on it</span>
                  <span className="hidden text-xs text-ink-3 sm:inline">This takes a few seconds</span>
                </div>
                <Badge tone="warn" dot>Not published</Badge>
              </div>
              <div className="relative grid gap-8 p-6 md:p-8 lg:grid-cols-[minmax(0,290px)_1fr]">
                <div>
                  <RunTimeline step={runStep} />
                  <p className="mt-5 rounded-xl border border-line bg-canvas/50 px-3 py-2.5 text-[11px] leading-relaxed text-ink-3">The agent only uses facts from your store. If it cannot verify a claim, it leaves it out.</p>
                </div>
                <div className="relative overflow-hidden rounded-2xl border border-line bg-surface/50 p-5">
                  <div aria-hidden className="agent-scan pointer-events-none" />
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-line" /><span className="size-2 rounded-full bg-line" /><span className="size-2 rounded-full bg-line" />
                    <span className="num ml-2 truncate text-[11px] text-ink-3">{store.domain}</span>
                  </div>
                  <div className="mt-6 space-y-3">
                    <div className="agent-shimmer h-5 w-2/3 rounded-lg" />
                    <div className="agent-shimmer h-3 w-full rounded-full" />
                    <div className="agent-shimmer h-3 w-4/5 rounded-full" />
                    <div className="mt-6 grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="agent-shimmer h-24 rounded-xl" />)}</div>
                    <div className="mt-6 flex justify-end"><div className="agent-shimmer h-9 w-28 rounded-full" /></div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative min-h-[560px] overflow-hidden rounded-[1.75rem] border border-line bg-surface-2">
              <div aria-hidden className="agent-grid pointer-events-none absolute inset-0 opacity-70" />
              <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand-solid/20 blur-3xl" />
              <div className="relative flex min-h-[560px] flex-col items-center justify-center px-6 py-12 text-center">
                <div className="relative mb-8">
                  <div aria-hidden className="absolute inset-0 -z-10 scale-150 rounded-full bg-brand-solid/20 blur-2xl" />
                  <AgentOrb size={72} />
                </div>
                <Badge tone="neutral">Waiting for a brief</Badge>
                <h2 className="mt-4 max-w-lg font-display text-2xl font-extrabold uppercase leading-tight tracking-tight md:text-3xl">Tell the agent the outcome</h2>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-2">It will read your real catalog, build the campaign and check every claim before saving a draft. Nothing publishes without you.</p>
                <ol className="mt-9 grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
                  {PLAN.map((p, i) => (
                    <li key={p.title} className="rounded-2xl border border-line bg-surface/60 p-4">
                      <div className="flex items-center justify-between">
                        <span aria-hidden className="grid size-8 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-brand-tint"><p.icon className="size-4" /></span>
                        <span className="num text-[10px] text-ink-3">0{i + 1}</span>
                      </div>
                      <div className="mt-3 text-xs font-semibold">{p.title}</div>
                      <div className="mt-1 text-[11px] leading-relaxed text-ink-3">{p.body}</div>
                    </li>
                  ))}
                </ol>
                <p className="mt-8 inline-flex items-center gap-2 text-[11px] text-ink-3"><ShieldCheck className="size-3.5 text-ok" aria-hidden />Policy gate on every draft</p>
              </div>
            </div>
          ))}

          {result && (
            <div className="reveal space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-ok/25 bg-ok/10 px-3 py-1 text-xs font-medium text-ok"><LiveDot />Live preview</span>
                  <span className="text-xs text-ink-3">Draft only. Nothing is live until you approve it.</span>
                </div>
                <div role="group" aria-label="Preview device" className="flex gap-1 rounded-full border border-line bg-ink/[0.02] p-0.5">
                  <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={clsx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all", device === "desktop" ? "seg-active" : "text-ink-2 hover:text-ink")}><Monitor className="size-4" aria-hidden />Desktop</button>
                  <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={clsx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all", device === "mobile" ? "seg-active" : "text-ink-2 hover:text-ink")}><Smartphone className="size-4" aria-hidden />Mobile</button>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[1.75rem] border border-line bg-surface-2 p-3 md:p-4">
                <div aria-hidden className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-brand/70 to-transparent" />
                <div aria-hidden className="pointer-events-none absolute inset-0 agent-grid opacity-25" />
                <div className="relative">
                  <StudioReview result={result} domain={store.domain} currency={store.currency} device={device} busy={busy} hideExplanation onSelectField={setSelected} selectedField={selected} />
                </div>
              </div>
              <p className="flex flex-wrap items-center justify-center gap-1.5 text-center text-[11px] text-ink-3"><MessageSquare className="size-3.5" aria-hidden />Click any headline, body, button or form in the preview to tell the agent what to change.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function Page() { return <NeedStore>{(s) => <Studio store={s} />}</NeedStore>; }
