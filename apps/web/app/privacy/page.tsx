import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <div>
      <SiteHeader />
      <main className="wrap max-w-3xl pb-16 pt-32">
        <p className="eyebrow">Legal</p>
        <h1 className="display mt-3 text-5xl">Privacy</h1>
        <p className="mt-5 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">Draft template. Have counsel review and complete it (legal entity, contact, processors, retention) before launch.</p>
        <div className="mt-8 space-y-5 text-ink-2">
          <p><strong className="text-ink">Merchants.</strong> We store your account email, store configuration, campaigns and catalog data you provide.</p>
          <p><strong className="text-ink">Shoppers.</strong> The storefront script records campaign events (impression, click, dismissal, purchase) only after the merchant&apos;s site signals analytics consent. Raw events are reduced to daily aggregates; short-lived de-duplication identifiers are deleted after a few days. We do not collect payment details.</p>
          <p><strong className="text-ink">Back-in-stock alerts.</strong> If a shopper asks to be told when a product returns, we store their email address, the product, and the time of the request. We email them once to confirm, and once when the product is available. Unconfirmed requests are deleted after 7 days, and alerted or unsubscribed records after 30 days. After an unsubscribe we keep only a one-way hash of the address so it cannot be re-subscribed by mistake.</p>
          <p><strong className="text-ink">Experiments.</strong> When a merchant runs a holdout experiment, consenting visitors are assigned a random identifier, stored in their browser, to keep them in the same group. Visitors who have not consented are never assigned or recorded.</p>
          <p><strong className="text-ink">Security.</strong> Passwords are hashed. Two-step verification secrets and platform credentials are encrypted at rest. Sessions and one-time tokens are stored only as hashes.</p>
          <p><strong className="text-ink">AI.</strong> Campaign drafts are generated from your objective and the minimum catalog context needed (product titles, links and availability). No shopper data is sent to the AI provider.</p>
          <p><strong className="text-ink">Deletion.</strong> Disconnecting a store stops delivery and removes stored platform credentials. You can delete your account and all associated data from Settings.</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
