"use client";
import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { type CampaignRow, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { CampaignEditor } from "@/components/campaign-editor";
import { ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { VersionHistory } from "@/components/version-history";
import { TOOLS } from "@/lib/tools";

function Edit({ store, id }: { store: Store; id: string }) {
  const isNew = id === "new";
  const search = useSearchParams();
  // Only shipped tools can be created. An unknown or unshipped ?tool= falls back to the classic editor.
  const asked = search.get("tool");
  const tool = isNew && (asked === "toast" || asked === "feed" || asked === "email" || asked === "upsell") && TOOLS[asked].shipped ? asked : undefined;
  const { data, error, loading } = useApi<CampaignRow>(isNew ? null : `/api/v1/stores/${store.id}/campaigns/${id}`);
  const title = isNew ? (tool ? `New ${TOOLS[tool].name.toLowerCase()} campaign` : "New campaign") : "Edit campaign";
  return (
    <>
      <PageHeader eyebrow="Campaign editor" title={title} sub="Changes stay in draft until you approve and publish." />
      <ErrorNote error={error} />
      {!isNew && loading && <Skeleton className="h-96" />}
      {(isNew || data) && (
        <>
          <CampaignEditor key={data?.id ?? "new"} store={store} {...(data ? { campaign: data } : {})} {...(tool ? { tool } : {})} />
          {data && <VersionHistory store={store} campaignId={data.id} />}
        </>
      )}
    </>
  );
}

function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <NeedStore>{(s) => <Edit store={s} id={id} />}</NeedStore>;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  // useSearchParams needs a Suspense boundary.
  return <Suspense fallback={<Skeleton className="h-96" />}><Inner params={params} /></Suspense>;
}
