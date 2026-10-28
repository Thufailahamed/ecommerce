import { BRAND } from "@/lib/brand";

/** Isometric projection of a box at grid (x, y, z) sized (w, d, h): returns the three visible faces as point lists. */
function isoBox(x: number, y: number, z: number, w: number, d: number, h: number, u = 4) {
  const p = (a: number, b: number, c: number) => `${(16.7 + (a - b) * 0.866 * u).toFixed(2)},${(15.6 + (a + b) * 0.5 * u - c * u).toFixed(2)}`;
  return {
    top: [p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)].join(" "),
    left: [p(x, y + d, z + h), p(x + w, y + d, z + h), p(x + w, y + d, z), p(x, y + d, z)].join(" "),
    right: [p(x + w, y, z + h), p(x + w, y + d, z + h), p(x + w, y + d, z), p(x + w, y, z)].join(" "),
  };
}

/** Original mark: three isometric slabs that step down, like a flow of decisions. Blue faces, shaded sides. */
const SLABS = [isoBox(0, 0, 2, 4, 1.2, 1), isoBox(0, 1.6, 1, 3, 1.2, 1), isoBox(0, 3.2, 0, 2, 1.2, 1)];

export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      {SLABS.map((s, i) => (
        <g key={i}>
          <polygon points={s.left} fill="#2350ff" />
          <polygon points={s.right} fill="#1636b8" />
          <polygon points={s.top} fill="#7c9cff" />
        </g>
      ))}
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap font-display text-[13px] sm:text-[15px] font-extrabold uppercase tracking-tight ${className}`}>
      <LogoMark />
      <span>{BRAND.name}{BRAND.suffix && <span className="text-brand"> {BRAND.suffix}</span>}</span>
    </span>
  );
}
