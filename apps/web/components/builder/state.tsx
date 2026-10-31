"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  applyOps, findSectionById, resolveRoute, type ApplyResult, type ChatEvent, type ChatMessageView, type SiteDocument,
} from "@convertflow/store-builder";
import { roleHolds } from "@/lib/modules";
import { ApiError } from "@/lib/api";
import { builder, streamChat, type SiteView } from "@/lib/builder";

export type Device = "desktop" | "tablet" | "mobile";
export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
export type Tab = "chat" | "design" | "pages" | "products" | "settings";
export interface StepView { key: string; label: string; state: "active" | "done" | "error" | "skipped"; detail?: string }
export interface Toast { id: number; text: string; tone: "ok" | "error" | "info" }

interface Streaming { userText: string; steps: StepView[]; text: string; mode: "build" | "edit" | null }

interface Ctx {
  site: SiteView;
  doc: SiteDocument;
  saveState: SaveState;
  saveError: string | null;
  canEdit: boolean;
  canPublish: boolean;
  /** Applies editor operations. `coalesce` merges rapid edits of one field into one undo step. */
  apply(ops: unknown[], coalesce?: string): ApplyResult;
  replaceDoc(doc: SiteDocument, revision: number): void;
  undo(): void; redo(): void; canUndo: boolean; canRedo: boolean;
  flush(): Promise<boolean>;
  path: string; setPath(p: string): void;
  selectedId: string | null; select(id: string | null): void;
  device: Device; setDevice(d: Device): void;
  previewMode: "edit" | "preview"; setPreviewMode(m: "edit" | "preview"): void;
  tab: Tab; setTab(t: Tab): void;
  messages: ChatMessageView[];
  streaming: Streaming | null;
  send(message: string, opts?: { mode?: "auto" | "build" | "edit"; withSelection?: boolean }): Promise<void>;
  stop(): void;
  updateSite(patch: Partial<SiteView>): void;
  reload(): Promise<void>;
  toasts: Toast[];
  toast(text: string, tone?: Toast["tone"]): void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}

const BuilderCtx = createContext<Ctx | null>(null);
export const useBuilder = () => {
  const c = useContext(BuilderCtx);
  if (!c) throw new Error("useBuilder outside BuilderProvider");
  return c;
};

const SAVE_DELAY = 900;
const MAX_UNDO = 80;

export function BuilderProvider({ initial, initialMessages, children }: { initial: SiteView; initialMessages: ChatMessageView[]; children: ReactNode }) {
  const [site, setSite] = useState(initial);
  const [doc, setDocState] = useState(initial.draft);
  const docRef = useRef(initial.draft);
  const revisionRef = useRef(initial.revision);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const savedDoc = useRef(initial.draft);

  // Undo history lives in refs (updaters with side effects run twice under StrictMode); `histTick` re-renders.
  const past = useRef<SiteDocument[]>([]);
  const future = useRef<SiteDocument[]>([]);
  const [, setHistTick] = useState(0);
  const bump = () => setHistTick((n) => n + 1);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);

  const [path, setPathState] = useState("/");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [previewMode, setPreviewMode] = useState<"edit" | "preview">("edit");
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState(initialMessages);
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const canEdit = roleHolds(site.role, "sites.write") && !streaming;
  const canPublish = roleHolds(site.role, "sites.publish");

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);

  const setDoc = useCallback((next: SiteDocument) => { docRef.current = next; setDocState(next); }, []);

  /* ---------- saving ---------- */

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (saving.current) await saving.current;
    if (docRef.current === savedDoc.current) return true;
    const sending = docRef.current;
    setSaveState("saving");
    const p = builder.save(site.id, sending, revisionRef.current).then((r) => {
      revisionRef.current = r.revision;
      savedDoc.current = sending;
      setSaveError(null);
      setSaveState(docRef.current === sending ? "saved" : "dirty");
      return true;
    }).catch((e: unknown) => {
      if (e instanceof ApiError && e.code === "stale_revision") { setSaveState("conflict"); setSaveError("This store was changed in another tab or by a teammate."); }
      else { setSaveState("error"); setSaveError(e instanceof Error ? e.message : "Could not save"); }
      return false;
    }).finally(() => { saving.current = null; });
    saving.current = p;
    const ok = await p;
    if (ok && docRef.current !== savedDoc.current) scheduleSave();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  const scheduleSave = useCallback(() => {
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY);
  }, [flush]);

  // Leaving the editor (client navigation) saves what is pending now instead of from a timer on a dead editor.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; void flush(); }
  }, [flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (docRef.current !== savedDoc.current || abortRef.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  /* ---------- editing ---------- */

  const pushUndo = useCallback((prev: SiteDocument, coalesce?: string) => {
    const now = Date.now();
    const same = coalesce && lastCoalesce.current?.key === coalesce && now - lastCoalesce.current.at < 1200;
    lastCoalesce.current = coalesce ? { key: coalesce, at: now } : null;
    if (same) return;
    past.current = [...past.current.slice(-MAX_UNDO + 1), prev];
    future.current = [];
    bump();
  }, []);

  const apply = useCallback((ops: unknown[], coalesce?: string): ApplyResult => {
    const prev = docRef.current;
    const r = applyOps(prev, ops);
    if (r.applied.length) {
      pushUndo(prev, coalesce);
      setDoc(r.doc);
      scheduleSave();
    }
    if (r.failed.length && !coalesce) toast(r.failed[0]!.error, "error");
    return r;
  }, [pushUndo, setDoc, scheduleSave, toast]);

  const replaceDoc = useCallback((next: SiteDocument, revision: number) => {
    pushUndo(docRef.current);
    revisionRef.current = revision;
    savedDoc.current = next;
    setDoc(next);
    setSaveState("saved");
  }, [pushUndo, setDoc]);

  const undo = useCallback(() => {
    const prev = past.current.at(-1);
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [docRef.current, ...future.current];
    lastCoalesce.current = null;
    setDoc(prev);
    scheduleSave();
    bump();
  }, [setDoc, scheduleSave]);
  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, docRef.current];
    setDoc(next);
    scheduleSave();
    bump();
  }, [setDoc, scheduleSave]);

  // A selection or page that no longer exists (deleted, or rebuilt by the AI) is dropped.
  useEffect(() => {
    if (selectedId && !findSectionById(doc, selectedId)) setSelectedId(null);
    if (resolveRoute(doc, path).kind === "not_found") setPathState("/");
  }, [doc, selectedId, path]);

  const setPath = useCallback((p: string) => { setPathState(p || "/"); }, []);
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Selecting a section from a list shows the page it lives on.
    const found = id ? findSectionById(docRef.current, id) : null;
    const page = found ? docRef.current.pages.find((p) => p.id === found.pageId) : null;
    if (page) setPathState((cur) => {
      const r = resolveRoute(docRef.current, cur);
      return r.kind === "page" && r.page.id === page.id ? cur : page.slug ? `/${page.slug}` : "/";
    });
  }, []);

  /* ---------- chat ---------- */

  const reload = useCallback(async () => {
    const [s, m] = await Promise.all([builder.get(site.id), builder.messages(site.id)]);
    setSite(s);
    revisionRef.current = s.revision;
    savedDoc.current = s.draft;
    setDoc(s.draft);
    setMessages(m);
    setSaveState("saved");
    setSaveError(null);
  }, [site.id, setDoc]);

  const send = useCallback(async (message: string, opts: { mode?: "auto" | "build" | "edit"; withSelection?: boolean } = {}) => {
    const text = message.trim();
    if (!text || abortRef.current) return;
    if (!(await flush())) { toast("Save your changes before asking the AI (see the save status at the top).", "error"); return; }
    const before = docRef.current;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setStreaming({ userText: text, steps: [], text: "", mode: null });
    const selection = opts.withSelection !== false && selectedId ? { sectionId: selectedId } : null;
    let finished = false;
    const onEvent = (e: ChatEvent) => {
      switch (e.type) {
        case "start":
          setMessages((m) => [...m, e.userMessage]);
          setStreaming((s) => s && { ...s, mode: e.mode });
          break;
        case "status":
          setStreaming((s) => {
            if (!s) return s;
            const steps = [...s.steps];
            const i = steps.findIndex((x) => x.key === e.step);
            const v: StepView = { key: e.step, label: e.label, state: e.state, ...(e.detail ? { detail: e.detail } : {}) };
            if (i >= 0) steps[i] = v; else steps.push(v);
            return { ...s, steps };
          });
          break;
        case "delta":
          setStreaming((s) => s && { ...s, text: s.text + e.text });
          break;
        case "doc":
          revisionRef.current = e.revision;
          savedDoc.current = e.doc;
          setDoc(e.doc);
          break;
        case "done":
          finished = true;
          setMessages((m) => [...m, e.message]);
          setSite((s) => ({ ...s, revision: e.revision, usage: { ...s.usage, messages: e.usage } }));
          // One undo step reverts the whole AI turn.
          if (e.message.changes?.length) { past.current = [...past.current.slice(-MAX_UNDO + 1), before]; future.current = []; bump(); }
          break;
        case "error":
          finished = true;
          if (e.message_) setMessages((m) => [...m, e.message_!]);
          else toast(e.message, "error");
          break;
        case "ops":
          break;
      }
    };
    try {
      await streamChat(site.id, { message: text, selection, path, mode: opts.mode ?? "auto" }, onEvent, ctl.signal);
    } catch (e) {
      if (!ctl.signal.aborted) {
        const msg = e instanceof Error ? e.message : "The AI could not be reached";
        setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "assistant", content: msg, createdAt: new Date().toISOString(), status: "error" }]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(null);
      // A stopped or broken stream may have missed the final events: resync with the server.
      if (!finished) await reload().catch(() => undefined);
      else builder.get(site.id).then((s) => setSite((cur) => ({ ...cur, usage: s.usage, name: s.name, slug: s.slug, busy: false }))).catch(() => undefined);
    }
  }, [flush, selectedId, path, site.id, setDoc, toast, reload]);

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);
  const updateSite = useCallback((patch: Partial<SiteView>) => setSite((s) => ({ ...s, ...patch })), []);

  // Keyboard: undo/redo, Escape to deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable=true]") !== null);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing && canEdit) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y" && !typing && canEdit) { e.preventDefault(); redo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void flush(); }
      if (e.key === "Escape" && !typing && !document.querySelector("[role=dialog]")) setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, flush, canEdit]);

  const value = useMemo<Ctx>(() => ({
    site, doc, saveState, saveError, canEdit, canPublish, apply, replaceDoc, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, flush,
    path, setPath, selectedId, select, device, setDevice, previewMode, setPreviewMode, tab, setTab, messages, streaming, send, stop,
    updateSite, reload, toasts, toast, composerRef,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [site, doc, saveState, saveError, canEdit, canPublish, apply, replaceDoc, undo, redo, past.current.length, future.current.length, flush, path, setPath, selectedId, select, device, previewMode, tab, messages, streaming, send, stop, updateSite, reload, toasts, toast]);

  return <BuilderCtx.Provider value={value}>{children}</BuilderCtx.Provider>;
}
