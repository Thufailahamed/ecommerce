"use client";
import { useState } from "react";
import { Inbox } from "lucide-react";
import type { CampaignRow, Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useRange, type Analytics } from "@/lib/analytics";
import { FormResults } from "@/components/form-results";
import { NeedStore } from "@/components/need-store";
import { Empty, ErrorNote, PageHeader, Select, Skeleton } from "@/components/ui";

/** Sign-ups from every campaign's form, newest period first. Per-campaign detail lives under each campaign's Submissions step. */
function Submissions({ store }: { store: Store }) {
  const [days, setDays] = useState(30);
  const range = useRange(days);
  const analytics = useApi<Analytics>(`/api/v1/stores/${store.id}/analytics?${range}`);
  const campaigns = useApi<CampaignRow[]>(`/api/v1/stores/${store.id}/campaigns`);
  const nameOf = (cid: string) => campaigns.data?.find((c) => c.id === cid)?.name ?? cid;
  const forms = analytics.data?.forms ?? [];

  return (
    <>
      <PageHeader eyebrow="Inbox" title="Submissions" sub="Sign-ups from every campaign form. Requests and confirmations are counted on our server."
        actions={<Select aria-label="Date range" className="w-44" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select>} />
      <ErrorNote error={analytics.error} />
      {analytics.loading && <Skeleton className="h-40" />}
      {analytics.data && forms.length === 0 && (
        <Empty icon={Inbox} title="No submissions yet" body="When a shopper signs up through a campaign form and confirms by email, the submission appears here." />
      )}
      {forms.length > 0 && <FormResults forms={forms} nameOf={nameOf} />}
    </>
  );
}

export default function Page() {
  return <NeedStore>{(s) => <Submissions store={s} />}</NeedStore>;
}
