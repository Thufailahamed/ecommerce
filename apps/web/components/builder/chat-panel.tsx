"use client";
import clsx from "clsx";
import { ArrowUp, Check, CircleAlert, Crosshair, History, Loader2, MinusCircle, RotateCcw, Sparkles, Square, Wand2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { findSectionById, sectionLabel, type ChatMessageView } from "@convertflow/store-builder";
import { builder } from "@/lib/builder";
import { ApiError } from "@/lib/api";
import { useBuilder, type StepView } from "./state";

const STARTERS = [
  { title: "Handmade ceramics", prompt: "A minimalist ceramics studio called Kiln & Co selling handmade mugs, bowls and vases. Calm, earthy, Japandi feel." },
  { title: "Specialty coffee", prompt: "An independent coffee roaster selling single-origin beans, brewing gear and subscriptions. Warm, artisanal, a little playful." },
  { title: "Clean skincare", prompt: "A clean skincare brand with serums, cleansers and moisturisers for sensitive skin. Soft, clinical but friendly, lots of white space." },
  { title: "Streetwear", prompt: "A bold streetwear label selling oversized tees, hoodies and caps in limited drops. Dark, high contrast, uppercase type." },
];

const EDIT_IDEAS = ["Make the hero more dramatic", "Add a FAQ about shipping and returns", "Use a warmer colour palette", "Write punchier product descriptions"];

function StepList({ steps, live }: { steps: StepView[]; live?: boolean }) {
  if (!steps.length) return null;
  return (
    <ol className="mt-3 space-y-1.5 rounded-xl border border-line bg-ink/[0.02] p-3">
      {steps.map((s) => (
        <li key={s.key} className="flex items-center gap-2.5 text-[12px]">
          <span className="grid size-4 shrink-0 place-items-center">
            {s.state === "active" && live ? <Loader2 className="size-3.5 animate-spin text-brand" aria-hidden />
              : s.state === "done" ? <Check className="size-3.5 text-ok" aria-hidden />
              : s.state === "skipped" ? <MinusCircle className="size-3.5 text-ink-3" aria-hidden />
              : s.state === "error" ? <CircleAlert className="size-3.5 text-warn" aria-hidden />
              : <span className="size-1.5 rounded-full bg-ink-3" />}
          </span>
          <span className={clsx(s.state === "active" ? "text-ink" : "text-ink-2")}>{s.label}</span>
          {s.detail && <span className="ml-auto truncate text-[11px] text-ink-3">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

function Prose({ text }: { text: string }) {
  return <div className="space-y-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>;
}

function AssistantAvatar({ busy }: { busy?: boolean }) {
  return (
    <span aria-hidden className={clsx("grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-solid to-brand-glow text-white shadow-[0_6px_18px_-6px_rgba(35,80,255,1)]", busy && "animate-pulse")}>
      <Sparkles className="size-3.5" />
    </span>
  );
}

function Message({ m, last, onRestore, onSuggest }: { m: ChatMessageView; last: boolean; onRestore: (versionId: string) => void; onSuggest: (s: string) => void }) {
  if (m.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {m.selection && <span className="inline-flex max-w-[85%] items-center gap-1 truncate rounded-full bg-ink/[0.05] px-2 py-0.5 text-[11px] text-ink-3"><Crosshair className="size-3" aria-hidden />{m.selection.label}</span>}
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink/[0.08] px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">{m.content}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className={clsx(m.status === "error" && "text-danger")}><Prose text={m.content} /></div>
        {m.steps && m.steps.length > 1 && <StepList steps={m.steps} />}
        {m.changes && m.changes.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {m.changes.slice(0, 8).map((c, i) => <span key={i} className="inline-flex items-center gap-1 rounded-md bg-ok/10 px-2 py-0.5 text-[11px] text-ok"><Check className="size-3" aria-hidden />{c.summary}</span>)}
            {m.changes.length > 8 && <span className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-[11px] text-ink-3">+{m.changes.length - 8} more</span>}
          </div>
        )}
        {m.failed && m.failed.length > 0 && m.changes && m.changes.length > 0 && (
          <p className="mt-2 text-[11px] text-warn">{m.failed.length} change{m.failed.length === 1 ? "" : "s"} couldn&apos;t be applied and {m.failed.length === 1 ? "was" : "were"} skipped.</p>
        )}
        <div className="mt-2 flex items-center gap-3">
          {m.versionId && (
            <button type="button" onClick={() => onRestore(m.versionId!)} className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-3 transition-colors hover:text-ink">
              <RotateCcw className="size-3" aria-hidden />Restore this version
            </button>
          )}
        </div>
        {last && m.suggestions && m.suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.suggestions.map((s) => (
              <button key={s} type="button" onClick={() => onSuggest(s)} className="rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink-2 transition-colors hover:border-brand-tint hover:bg-brand-soft hover:text-ink">{s}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const { site, doc, messages, streaming, send, stop, selectedId, select, canEdit, replaceDoc, flush, toast, composerRef } = useBuilder();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const autoStarted = useRef(false);

  const selected = selectedId ? findSectionById(doc, selectedId) : null;
  const quota = site.usage.messages;
  const out = quota.limit > 0 && quota.used >= quota.limit;
  const disabledReason = !site.ai.chat ? "The AI builder isn't configured on this server yet." : out ? `You've used all ${quota.limit} AI messages this month.` : null;
  const busy = Boolean(streaming);
  const empty = messages.length === 0 && !streaming;

  // A store created from the dashboard prompt starts building as soon as the editor opens.
  useEffect(() => {
    if (autoStarted.current || !empty || !site.prompt || disabledReason) return;
    autoStarted.current = true;
    const key = `sb:autostart:${site.id}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* storage unavailable: still start once per mount */ }
    void send(site.prompt, { mode: "build" });
  }, [empty, site.prompt, site.id, disabledReason, send]);

  // Follow new content unless the merchant scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [text, composerRef]);

  const submit = (value = text) => {
    if (!value.trim() || busy || disabledReason) return;
    void send(value);
    setText("");
    stick.current = true;
  };

  const restore = async (versionId: string) => {
    if (!canEdit) return;
    if (!(await flush())) return;
    try {
      const r = await builder.restore(site.id, versionId, site.revision);
      replaceDoc(r.draft, r.revision);
      toast("Version restored. Undo brings back what you had.", "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not restore that version", "error");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
        {empty ? (
          <div className="flex min-h-full flex-col justify-center py-6">
            <div className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-solid to-brand-glow text-white shadow-[0_14px_40px_-12px_rgba(35,80,255,1)]"><Wand2 className="size-5" aria-hidden /></div>
            <h2 className="text-center text-lg font-semibold text-ink">What are you selling?</h2>
            <p className="mx-auto mt-1.5 max-w-xs text-center text-[13px] leading-relaxed text-ink-3">Describe your brand, products and the feel you want. I&apos;ll design the store, write the copy, draft products and create images.</p>
            <div className="mt-6 grid gap-2">
              {STARTERS.map((s) => (
                <button key={s.title} type="button" disabled={Boolean(disabledReason)} onClick={() => { setText(s.prompt); composerRef.current?.focus(); }}
                  className="group rounded-xl border border-line bg-ink/[0.02] p-3 text-left transition-all hover:border-brand-tint hover:bg-brand-soft disabled:opacity-50">
                  <div className="text-[13px] font-semibold text-ink">{s.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3 group-hover:text-ink-2">{s.prompt}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((m, i) => <Message key={m.id} m={m} last={i === messages.length - 1 && !streaming} onRestore={(v) => void restore(v)} onSuggest={submit} />)}
            {streaming && (
              <>
                {/* Until the server echoes the message (the start event), show it optimistically. */}
                {streaming.mode === null && (
                  <div className="flex justify-end"><div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink/[0.08] px-3.5 py-2.5 text-[13px] leading-relaxed text-ink opacity-70">{streaming.userText}</div></div>
                )}
                <div className="flex gap-2.5">
                  <AssistantAvatar busy />
                  <div className="min-w-0 flex-1 pt-0.5">
                    {streaming.text ? <div className="text-[13px] leading-relaxed text-ink"><Prose text={streaming.text} /><span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand align-middle" /></div>
                      : <div className="flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="size-3.5 animate-spin" aria-hidden />{streaming.mode === "build" ? "Designing your store…" : "Thinking…"}</div>}
                    <StepList steps={streaming.steps} live />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {disabledReason && <p role="status" className="mb-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-ink">{disabledReason}{out ? " Upgrade in Settings → Billing for more." : " Ask your administrator to set the AI Gateway variables."}</p>}
        {!empty && !busy && !disabledReason && messages.at(-1)?.role === "assistant" && !messages.at(-1)?.suggestions?.length && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
            {EDIT_IDEAS.map((s) => <button key={s} type="button" onClick={() => submit(s)} className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:border-brand-tint hover:text-ink">{s}</button>)}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}
          className={clsx("rounded-2xl border bg-ink/[0.03] transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-soft", busy ? "border-brand-tint" : "border-line-strong")}>
          {selected && (
            <div className="flex items-center gap-1.5 px-3 pt-2.5">
              <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md bg-brand-soft px-2 py-1 text-[11px] font-medium text-brand">
                <Crosshair className="size-3 shrink-0" aria-hidden /><span className="truncate">Editing: {sectionLabel(selected.section)}</span>
              </span>
              <button type="button" aria-label="Clear selection" onClick={() => select(null)} className="grid size-5 place-items-center rounded text-ink-3 hover:bg-ink/[0.08] hover:text-ink"><X className="size-3" /></button>
            </div>
          )}
          <label htmlFor="builder-composer" className="sr-only">Message the AI designer</label>
          <textarea id="builder-composer" ref={composerRef} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} rows={1}
            disabled={Boolean(disabledReason)}
            placeholder={empty ? "Describe the store you want…" : selected ? "Describe a change to this section…" : "Ask for a change, or describe something new…"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            className="block max-h-[220px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[13px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none disabled:cursor-not-allowed" />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <span className="flex items-center gap-1 pl-1.5 text-[11px] text-ink-3" title="AI messages used this month">
              <History className="size-3" aria-hidden />{quota.used}/{quota.limit}
            </span>
            {busy ? (
              <button type="button" onClick={stop} aria-label="Stop" className="grid size-8 place-items-center rounded-full bg-white text-black transition-transform hover:scale-105"><Square className="size-3 fill-current" /></button>
            ) : (
              <button type="submit" aria-label="Send" disabled={!text.trim() || Boolean(disabledReason)}
                className="grid size-8 place-items-center rounded-full bg-brand-solid text-white shadow-[0_6px_20px_-6px_rgba(35,80,255,1)] transition-all hover:bg-brand-solid-hover disabled:bg-ink/[0.08] disabled:text-ink-3 disabled:shadow-none"><ArrowUp className="size-4" /></button>
            )}
          </div>
        </form>
        <p className="mt-1.5 text-center text-[10px] text-ink-3">AI can make mistakes. Review prices, claims and policies before publishing.</p>
      </div>
    </div>
  );
}
