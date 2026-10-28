"use client";
import { useEffect, useState } from "react";
import { Scene } from "./illustrations";

/** Header for legal pages: a shield scene, the title, and a reading-progress bar that fills as the page is read. */
export function LegalHero({ title }: { title: string }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      setProgress(max > 0 ? Math.min(100, (scrollY / max) * 100) : 0);
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-0.5 bg-white/[0.04]">
        <div className="h-full bg-gradient-to-r from-brand-solid via-brand-glow to-[#5b3bff] shadow-[0_0_12px_rgba(35,80,255,0.9)] transition-[width] duration-150" style={{ width: `${progress}%` }} />
      </div>
      <div className="relative mb-10 grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div>
          <p className="eyebrow">Legal</p>
          <h1 className="display mt-3 text-5xl">{title}</h1>
        </div>
        <Scene kind="shield" className="mx-auto w-40 md:w-48" />
      </div>
    </>
  );
}
