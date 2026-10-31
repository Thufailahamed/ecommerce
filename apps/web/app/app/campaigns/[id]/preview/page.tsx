"use client";
import { use, useState } from "react";
import type { CampaignRow, Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { CampaignSteps } from "@/components/campaign-steps";
import { CampaignPreview, type Device } from "@/components/campaign-preview";
import { ErrorNote, PageHeader, Skeleton } from "@/components/ui";

function Preview({ store, id }: { store: Store; id: string }) {
  const campaign = useApi<CampaignRow>(`/api/v1/stores/${store.id}/campaigns/${id}`);
  const [device, setDevice] = useState<Device>("desktop");

  return (
    <>
      <CampaignSteps id={id} current="preview" />
      <PageHeader eyebrow="Campaign" title={campaign.data ? `Preview: ${campaign.data.name}` : "Preview"}
        sub="The draft as it will look on your storefront, rendered with the same code the storefront uses. Shoppers see the published version, so publish from the Builder to change what they see."
        actions={
          <div role="group" aria-label="Device" className="flex gap-1">
            {(["desktop", "mobile"] as const).map((d) => (
              <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium capitalize transition-colors ${device === d ? "bg-ink/[0.08] text-ink" : "text-ink-3 hover:text-ink-2"}`}>{d}</button>
            ))}
          </div>
        } />
      <ErrorNote error={campaign.error} />
      {campaign.loading && <Skeleton className="h-96" />}
      {campaign.data && (
        <div className="h-[640px] overflow-hidden rounded-2xl border border-line">
          <CampaignPreview config={campaign.data.draftConfig} device={device} domain={store.domain} currency={store.currency} fill />
        </div>
      )}
    </>
  );
}

function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <NeedStore>{(s) => <Preview store={s} id={id} />}</NeedStore>;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Inner params={params} />;
}
