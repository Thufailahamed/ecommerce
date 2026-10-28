import type { CSSProperties } from "react";
import { photoUrl, type PhotoKey } from "./art";

/* ---------- Animated isometric blocks: real CSS 3D cubes, used where a section would otherwise show a flat shape ---------- */

export type BlockTone = "white" | "blue" | "dark";
/** Top, front/back and left/right face colours, so a cube reads as lit from above-left. */
const TONES: Record<BlockTone, [string, string, string]> = {
  white: ["#ffffff", "#dfe4f2", "#a9b2cb"],
  blue: ["#8fa8ff", "#2350ff", "#1636b8"],
  dark: ["#3a3f52", "#20232f", "#12141c"],
};

type Vec = [number, number, number];

/**
 * One cube of side `s` px centred on `at` (x right, y down, z towards the viewer).
 * With `photo`, the four sides show that photo under a shade, and the top keeps the tone colour.
 */
function Box({ s, tone, at = [0, 0, 0], photo, className = "", style }: { s: number; tone: BlockTone; at?: Vec; photo?: PhotoKey; className?: string; style?: CSSProperties }) {
  const [top, front, side] = TONES[tone];
  const img = photo ? `url(${photoUrl(photo, 320)})` : undefined;
  const face = (bg: string, shade: number): CSSProperties => (img ? { backgroundColor: bg, backgroundImage: `linear-gradient(rgba(0,0,0,${shade}),rgba(0,0,0,${shade})), ${img}` } : { backgroundColor: bg });
  return (
    <div className={`box ${className}`} style={{ "--s": `${s}px`, transform: `translate3d(${at[0]}px, ${at[1]}px, ${at[2]}px)`, ...style } as CSSProperties}>
      <i className="box-top" style={{ backgroundColor: top }} />
      <i className="box-bottom" style={{ backgroundColor: side }} />
      <i className="box-front" style={face(front, 0)} />
      <i className="box-back" style={face(front, 0.15)} />
      <i className="box-right" style={face(side, 0.3)} />
      <i className="box-left" style={face(side, 0.3)} />
    </div>
  );
}

export type SceneKind = "spin" | "stack" | "split" | "tumble" | "orbit" | "fall";

/**
 * A small looping 3D scene that fills its box. `size` is one cube's side in px.
 * - spin: one cube turning; tumble: one cube rolling over; orbit: a small cube circling a big one
 * - stack: three cubes drop in and pile up; split: four cubes part and rejoin
 * - fall: photo cubes dropping through the box one after another (pass `photos`)
 * Decorative only; hidden from assistive tech. Reduced motion shows every scene standing still.
 */
export function BlockScene({ kind, tone = "blue", size = 34, photos = [], paused, className = "" }: { kind: SceneKind; tone?: BlockTone; size?: number; photos?: PhotoKey[]; paused?: boolean; className?: string }) {
  const s = size;
  let body;
  if (kind === "stack") {
    // Delays start 2s into the loop, so the first frame (and a paused scene) already shows the finished pile.
    const c = s * 0.7;
    body = [0, 1, 2].map((k) => <Box key={k} s={c} tone={k === 2 ? (tone === "white" ? "blue" : "white") : tone} at={[0, c - k * c, 0]} className="box-drop" style={{ animationDelay: `${k * 0.35 - 2}s` }} />);
  } else if (kind === "split") {
    const c = s * 0.62, g = c / 2;
    body = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([x, z], k) => (
      <Box key={k} s={c} tone={k === 3 ? (tone === "white" ? "blue" : "white") : tone} at={[x * g, 0, z * g]} className="box-split" style={{ "--dx": `${x * c * 0.35}px`, "--dz": `${z * c * 0.35}px` } as CSSProperties} />
    ));
  } else if (kind === "orbit") {
    body = (
      <>
        <Box s={s} tone={tone} />
        <div className="iso-spin" style={{ animationDuration: "3.2s" }}><Box s={s * 0.42} tone={tone === "white" ? "blue" : "white"} at={[s * 0.95, -s * 0.2, 0]} /></div>
      </>
    );
  } else if (kind === "fall") {
    body = photos.map((p, k) => <Box key={p} s={s} tone={tone} photo={p} className="box-fall" style={{ animationDelay: `${(k * 4.8) / photos.length}s` }} />);
  } else {
    body = <Box s={s} tone={tone} />;
  }
  const spin = kind === "spin" ? "iso-spin" : kind === "tumble" ? "iso-tumble" : "";
  return (
    <div aria-hidden className={`iso-scene ${paused ? "iso-paused" : ""} ${className}`}>
      <div className="iso"><div className={spin}>{body}</div></div>
    </div>
  );
}

/**
 * A row of cube towers that build up one cube at a time and then reset, read as a 3D bar chart.
 * Each tower is `[height in cubes, tone]`; towers sit side by side along the scene's x axis.
 */
export function CubeTowers({ towers, size = 30, className = "" }: { towers: [number, BlockTone][]; size?: number; className?: string }) {
  // Towers step along x and z together, which runs straight across the screen in this isometric view.
  const s = size, gap = s * 1.25, x0 = -((towers.length - 1) * gap) / 2;
  const tallest = Math.max(...towers.map(([n]) => n));
  return (
    <div aria-hidden className={`iso-scene ${className}`}>
      <div className="iso">
        <div style={{ transform: `translateY(${((tallest - 1) * s) / 2}px)` }}>
          {towers.flatMap(([n, tone], t) => Array.from({ length: n }, (_, k) => (
            <Box key={`${t}-${k}`} s={s} tone={tone} at={[x0 + t * gap, -k * s, x0 + t * gap]} className="box-rise" style={{ animationDelay: `${t * 0.25 + k * 0.18}s` }} />
          )))}
        </div>
      </div>
    </div>
  );
}
