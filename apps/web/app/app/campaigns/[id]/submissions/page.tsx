"use client";
import Link from "next/link";
import { use, useState } from "react";
import { Inbox } from "lucide-react";
import type { CampaignRow, Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useRange, type Analytics } from "@/lib/analytics";
import { FormResults } from "@/components/form-results";
import { NeedStore } from "@/components/need-store";
import { CampaignSteps } from "@/components/campaign-steps";
import { Empty, ErrorNote, PageHeader, Select, Skeleton } from "@/components/ui";

function Submissions({ store, id }: { store: Store; id: string }) {
  const [days, setDays] = useState(30);
  const range = useRange(days);
  const campaign = useApi<CampaignRow>(`/api/v1/stores/${store.id}/campaigns/${id}`);
  const analytics = useApi<Analytics>(`/api/v1/stores/${store.id}/analytics?${range}`);
  const forms = analytics.data?.forms?.filter((f) => f.campaignId === id) ?? [];

  return (
    <>
      <CampaignSteps id={id} current="submissions" />
      <PageHeader eyebrow="Campaign" title="Submissions" sub="Sign-ups that came through this campaign's form."
        actions={<Select aria-label="Date range" className="w-44" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select>} />
      <ErrorNote error={analytics.error ?? campaign.error} />
      {analytics.loading && <Skeleton className="h-40" />}
      {analytics.data && forms.length === 0 && (
        <Empty icon={Inbox} title="No submissions in this period" body="Submissions appear once a shopper asks to sign up through this campaign's form. Each sign-up counts as confirmed only after the shopper clicks the link in their inbox." />
      )}
      {forms.length > 0 && <FormResults forms={forms} nameOf={() => campaign.data?.name ?? id} />}
      <p className="mt-8 text-sm text-ink-3">Every contact across campaigns is on the <Link className="underline underline-offset-4 hover:text-ink-2" href="/app/subscribers">Subscribers</Link> page.</p>
    </>
  );
}

function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <NeedStore>{(s) => <Submissions store={s} id={id} />}</NeedStore>;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Inner params={params} />;
}
