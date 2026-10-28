"use client";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef } from "react";

/*
 * Original SVG characters and scenes. Everything here is drawn in code (no stock art), so it stays crisp in both
 * themes and costs nothing to load. Motion respects prefers-reduced-motion through the global rule in globals.css.
 */

export type Mood = "happy" | "thinking" | "sleepy" | "ok" | "oops";

/**
 * "Pip", the product's little guide. Its pupils follow the pointer across the whole page (set through CSS variables,
 * so following the cursor never re-renders React). Its face changes with the state it is shown in.
 */
export function Mascot({ mood = "happy", size = 128, className = "", label }: { mood?: Mood; size?: number; className?: string; label?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 360);
      el.style.setProperty("--lx", `${((dx / d) * 4.2 * k).toFixed(2)}px`);
      el.style.setProperty("--ly", `${((dy / d) * 3.2 * k).toFixed(2)}px`);
    };
    addEventListener("pointermove", onMove, { passive: true });
    return () => removeEventListener("pointermove", onMove);
  }, []);

  const sleepy = mood === "sleepy";
  return (
    <svg ref={ref} viewBox="0 0 120 120" width={size} height={size} className={clsx("overflow-visible", className)} role={label ? "img" : undefined} aria-hidden={label ? undefined : true} aria-label={label}>
      <defs>
        <radialGradient id={`${uid}-body`} cx="35%" cy="28%" r="78%">
          <stop offset="0" stopColor="#b4c8ff" />
          <stop offset="0.45" stopColor="#2350ff" />
          <stop offset="1" stopColor="#14309a" />
        </radialGradient>
      </defs>
      <ellipse className="mascot-shadow" cx="60" cy="108" rx="30" ry="4.5" fill="#000" opacity="0.45" />
      <g className="mascot-float">
        <line x1="60" y1="24" x2="60" y2="13" stroke="#8fb0ff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="60" cy="11" r="4.5" fill="#d6e2ff" />
        <circle className="mascot-spark" cx="60" cy="11" r="4.5" fill="#8fb0ff" />
        <circle cx="60" cy="64" r="40" fill={`url(#${uid}-body)`} />
        <ellipse cx="46" cy="36" rx="16" ry="7" fill="#fff" opacity="0.18" transform="rotate(-18 46 36)" />
        <circle cx="32" cy="60" r="4" fill="#ff8fb1" opacity={sleepy ? 0.2 : 0.42} />
        <circle cx="88" cy="60" r="4" fill="#ff8fb1" opacity={sleepy ? 0.2 : 0.42} />
        {sleepy ? (
          <g fill="none" stroke="#05060a" strokeWidth="3" strokeLinecap="round">
            <path d="M40 60 Q46 66 52 60" />
            <path d="M68 60 Q74 66 80 60" />
          </g>
        ) : (
          <>
            <ellipse className="mascot-blink" cx="46" cy="59" rx="7" ry="8" fill="#fff" />
            <ellipse className="mascot-blink" cx="74" cy="59" rx="7" ry="8" fill="#fff" />
            <g style={{ transform: "translate(var(--lx,0px), var(--ly,0px))" }}>
              <circle cx="47.5" cy="60.5" r="3.8" fill="#05060a" />
              <circle cx="75.5" cy="60.5" r="3.8" fill="#05060a" />
              <circle cx="48.8" cy="59" r="1.2" fill="#fff" />
              <circle cx="76.8" cy="59" r="1.2" fill="#fff" />
            </g>
          </>
        )}
        {mood === "happy" && <path d="M50 78 Q60 88 70 78" fill="none" stroke="#05060a" strokeWidth="3" strokeLinecap="round" />}
        {mood === "ok" && <path d="M50 78 Q60 90 70 78" fill="none" stroke="#05060a" strokeWidth="3" strokeLinecap="round" />}
        {mood === "thinking" && <circle cx="60" cy="81" r="2.8" fill="#05060a" />}
        {sleepy && <path d="M53 82 Q60 85 67 82" fill="none" stroke="#05060a" strokeWidth="2.5" strokeLinecap="round" />}
        {mood === "oops" && <path d="M48 84 Q54 77 60 84 T72 84" fill="none" stroke="#05060a" strokeWidth="2.8" strokeLinecap="round" />}
      </g>
      {mood === "thinking" && (
        <g fill="#8fb0ff">
          <circle className="dot-bounce" cx="88" cy="26" r="3" />
          <circle className="dot-bounce" cx="97" cy="26" r="3" />
          <circle className="dot-bounce" cx="106" cy="26" r="3" />
        </g>
      )}
      {sleepy && (
        <g fill="#8fb0ff" fontFamily="var(--font-tech), system-ui" fontWeight="800">
          <text className="mascot-float" x="92" y="30" fontSize="13">z</text>
          <text className="mascot-float" x="102" y="18" fontSize="9" opacity="0.7">z</text>
        </g>
      )}
    </svg>
  );
}

export type SceneKind = "mail" | "key" | "shield" | "invite" | "check" | "lost";

/** Wide scene for status screens. Each kind is a small story: a letter sent, a key turning, a shield holding. */
export function Scene({ kind, className = "" }: { kind: SceneKind; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const grad = (
    <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#8fb0ff" />
      <stop offset="0.5" stopColor="#2350ff" />
      <stop offset="1" stopColor="#14309a" />
    </linearGradient>
  );
  const orbit = <circle className="orbit-spin" cx="100" cy="70" r="62" fill="none" stroke="#8fb0ff" strokeOpacity="0.25" strokeDasharray="2 7" />;
  const pulse = <circle className="pulse-ring" cx="100" cy="70" r="46" fill="none" stroke="#5b82ff" strokeWidth="2" />;

  return (
    <svg viewBox="0 0 200 140" className={clsx("w-full max-w-[18rem] overflow-visible", className)} aria-hidden>
      <defs>{grad}</defs>
      {kind === "mail" && (
        <g className="mascot-float">
          {orbit}
          <path className="trail" d="M14 40 C 30 20, 50 22, 70 34" fill="none" stroke="#8fb0ff" strokeWidth="2" strokeLinecap="round" />
          <rect x="52" y="54" width="96" height="62" rx="12" fill={`url(#${uid}-g)`} />
          <path d="M56 60 L100 92 L144 60" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="146" cy="56" r="14" fill="#5fd99a" />
          <path className="draw-in" d="M139 56 L144 61 L153 51" fill="none" stroke="#05060a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {kind === "key" && (
        <g className="mascot-float">
          {orbit}
          {pulse}
          <circle cx="66" cy="70" r="24" fill="none" stroke={`url(#${uid}-g)`} strokeWidth="9" />
          <rect x="88" y="65" width="74" height="10" rx="5" fill={`url(#${uid}-g)`} />
          <rect x="144" y="75" width="8" height="14" rx="3" fill={`url(#${uid}-g)`} />
          <rect x="128" y="75" width="7" height="10" rx="3" fill={`url(#${uid}-g)`} />
        </g>
      )}
      {kind === "shield" && (
        <g className="mascot-float">
          {orbit}
          {pulse}
          <path d="M100 26 L142 42 V80 Q142 112 100 126 Q58 112 58 80 V42 Z" fill={`url(#${uid}-g)`} />
          <path className="draw-in" d="M80 78 L96 94 L122 64" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {kind === "invite" && (
        <g className="mascot-float">
          {orbit}
          <path className="trail" d="M52 70 H148" fill="none" stroke="#8fb0ff" strokeWidth="2" strokeLinecap="round" />
          <g>
            <circle cx="48" cy="62" r="16" fill={`url(#${uid}-g)`} />
            <circle cx="48" cy="58" r="6" fill="#fff" opacity="0.9" />
            <path d="M36 80 Q48 68 60 80" fill="#fff" opacity="0.9" />
          </g>
          <g>
            <circle cx="152" cy="62" r="16" fill="#5fd99a" />
            <circle cx="152" cy="58" r="6" fill="#05060a" opacity="0.8" />
            <path d="M140 80 Q152 68 164 80" fill="#05060a" opacity="0.8" />
          </g>
          <path d="M92 52 L116 62 L92 72 L96 62 Z" fill="#fff" opacity="0.92" />
        </g>
      )}
      {kind === "check" && (
        <g className="mascot-float">
          {orbit}
          {pulse}
          <circle cx="100" cy="70" r="40" fill={`url(#${uid}-g)`} />
          <path className="draw-in" d="M80 72 L95 87 L122 58" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {kind === "lost" && (
        <g className="mascot-float">
          {orbit}
          <circle cx="92" cy="66" r="34" fill="none" stroke={`url(#${uid}-g)`} strokeWidth="9" />
          <line x1="116" y1="90" x2="146" y2="120" stroke={`url(#${uid}-g)`} strokeWidth="11" strokeLinecap="round" />
          <text x="92" y="80" textAnchor="middle" fontSize="34" fontWeight="800" fill="#8fb0ff" fontFamily="var(--font-tech), system-ui">?</text>
        </g>
      )}
    </svg>
  );
}

/** Rounded gradient tile for a feature icon, with a soft glow and a lift on hover. */
export function IconTile({ icon: Icon, tone = "brand", className = "" }: { icon: LucideIcon; tone?: "brand" | "ok" | "warn" | "violet"; className?: string }) {
  const styles = {
    brand: "from-brand-solid to-[#14309a] shadow-[0_10px_26px_-10px_rgba(35,80,255,1)]",
    ok: "from-[#3fbf86] to-[#137a52] shadow-[0_10px_26px_-10px_rgba(95,217,154,0.9)]",
    warn: "from-[#f5b642] to-[#b86e0c] shadow-[0_10px_26px_-10px_rgba(255,200,96,0.9)]",
    violet: "from-[#7c5cff] to-[#3b1fb0] shadow-[0_10px_26px_-10px_rgba(124,92,255,1)]",
  };
  return (
    <span aria-hidden className={clsx("grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white ring-1 ring-white/20 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105", styles[tone], className)}>
      <Icon className="size-5" />
    </span>
  );
}
