import Link from "next/link";
import { Mascot, Scene } from "@/components/illustrations";
import { Logo } from "@/components/logo";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6 py-16 text-center">
      <div aria-hidden className="app-glow pointer-events-none absolute inset-0" />
      <div aria-hidden className="grid-lines pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative w-full max-w-md">
        <Link href="/" className="mx-auto mb-10 block w-fit"><Logo /></Link>
        <div className="mx-auto mb-2 w-fit"><Mascot mood="oops" size={124} /></div>
        <p className="font-display text-7xl font-extrabold text-grad">404</p>
        <h1 className="mt-3 font-display text-2xl font-extrabold uppercase tracking-tight">This page wandered off</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-2">The link may be old, or the page has moved. Let&apos;s get you back to your campaigns.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/app" className="btn btn-primary">Open dashboard</Link>
          <Link href="/" className="btn btn-ghost">Home</Link>
        </div>
        <Scene kind="lost" className="mx-auto mt-10 w-32 opacity-60" />
      </div>
    </main>
  );
}
