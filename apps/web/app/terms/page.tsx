import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";

export const metadata = { title: "Terms" };

export default function Terms() {
  return (
    <div>
      <SiteHeader />
      <main className="wrap max-w-3xl pb-16 pt-32">
        <p className="eyebrow">Legal</p>
        <h1 className="display mt-3 text-5xl">Terms of service</h1>
        <p className="mt-5 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">Draft template. Have counsel review and complete it before launch.</p>
        <div className="mt-8 space-y-5 text-ink-2">
          <p>You are responsible for the campaigns you approve and publish, including their accuracy and compliance with consumer-protection and advertising law in your markets.</p>
          <p>AI output is a suggestion. We validate drafts against policy checks, but you must review every campaign before approving it. We do not guarantee revenue or conversion improvements.</p>
          <p>Plans and limits are described on the pricing page and may change with notice.</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
