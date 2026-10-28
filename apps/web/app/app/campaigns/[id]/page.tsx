"use client";
import { Suspense, use, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { type CampaignRow, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { CampaignEditor } from "@/components/campaign-editor";
import { TemplateGallery } from "@/components/template-gallery";
import { ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { TOOLS } from "@/lib/tools";
import { editorToolOf, templateById } from "@/lib/templates";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** The page the editor opens on: a saved campaign, or a fresh draft from a template, an existing campaign, or a tool's blank form. */
function Edit({ store, id }: { store: Store; id: string }) {
  const isNew = id === "new";
  const search = useSearchParams();
  // Only shipped tools can be created. An unknown or unshipped ?tool= falls back to the classic editor.
  const asked = search.get("tool");
  const tool = isNew && (asked === "toast" || asked === "feed" || asked === "email" || asked === "upsell") && TOOLS[asked].shipped ? asked : undefined;
  const template = isNew ? templateById(search.get("template")) : undefined;
  const fromId = isNew ? search.get("from") : null;
  // A new campaign with nothing chosen yet starts at the template gallery.
  const gallery = isNew && !tool && !template && !fromId && search.get("start") !== "blank";

  const loadId = isNew ? fromId : id;
  const { data, error, loading } = useApi<CampaignRow>(loadId ? `/api/v1/stores/${store.id}/campaigns/${loadId}` : null);
  const initial = useMemo(() => {
    if (template) return template.config();
    if (isNew && fromId && data) return { ...(data.draftConfig as object), name: `Copy of ${data.name}`.slice(0, 80) };
    return undefined;
  }, [template, isNew, fromId, data]);

  if (gallery) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-ink-3">
          <Link href="/app/campaigns" className="hover:text-ink">Campaigns</Link><ChevronRight className="size-3.5" aria-hidden /><span aria-current="page" className="text-ink-2">Templates</span>
        </nav>
        <PageHeader title="Get the right template for your next campaign" sub="Start from a ready-made campaign, build from scratch, or describe a goal and let AI draft it. Nothing goes live until you review and approve it." />
        <TemplateGallery store={store} />
      </>
    );
  }

  const waiting = loadId && loading;
  const ready = isNew ? !fromId || !!data : !!data;
  return (
    <>
      {(!ready || error) && <PageHeader eyebrow="Campaign editor" title={isNew ? "New campaign" : "Edit campaign"} />}
      <ErrorNote error={error} />
      {waiting && <Skeleton className="h-96" />}
      {ready && !error && (
        <CampaignEditor key={isNew ? `new-${template?.id ?? fromId ?? tool ?? "blank"}` : data?.id} store={store}
          {...(!isNew && data ? { campaign: data } : {})} {...(initial ? { initial } : {})}
          {...(initial ? { tool: editorToolOf(initial as Parameters<typeof editorToolOf>[0]) ?? undefined } : tool ? { tool } : {})} />
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
