"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Laptop } from "lucide-react";
import type { ChatMessageView } from "@convertflow/store-builder";
import { ApiError } from "@/lib/api";
import { builder, type SiteView } from "@/lib/builder";
import { BuilderProvider } from "@/components/builder/state";
import { Editor } from "@/components/builder/editor";

export default function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<{ site: SiteView; messages: ChatMessageView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([builder.get(id), builder.messages(id)])
      .then(([site, messages]) => { if (live) setData({ site, messages }); })
      .catch((e) => { if (live) setError(e instanceof ApiError && e.status === 404 ? "This store doesn't exist, or you don't have access to it." : e instanceof Error ? e.message : "Could not open the store"); });
    return () => { live = false; };
  }, [id]);

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-canvas p-6 text-center">
        <div>
          <p role="alert" className="text-sm text-ink-2">{error}</p>
          <Link href="/app/sites" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">Back to your stores</Link>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex h-dvh flex-col bg-canvas" aria-busy="true">
        <div className="h-14 border-b border-line bg-[#08090d]" />
        <div className="flex min-h-0 flex-1">
          <div className="w-14 border-r border-line bg-[#08090d]" />
          <div className="w-[380px] space-y-3 border-r border-line bg-[#0a0b10] p-4">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
          <div className="flex-1 p-3"><div className="skeleton size-full rounded-xl" /></div>
        </div>
      </main>
    );
  }
  return (
    <BuilderProvider key={data.site.id} initial={data.site} initialMessages={data.messages}>
      <div className="fixed inset-0 z-[100] grid place-items-center bg-canvas p-8 text-center lg:hidden">
        <div className="max-w-xs">
          <Laptop className="mx-auto mb-4 size-8 text-brand" aria-hidden />
          <h1 className="text-lg font-semibold text-ink">Open the builder on a larger screen</h1>
          <p className="mt-2 text-sm text-ink-3">The editor needs room for the chat, the live preview and the settings side by side.</p>
          <Link href="/app/sites" className="mt-5 inline-block text-sm font-semibold text-brand hover:underline">Back to your stores</Link>
        </div>
      </div>
      <Editor />
    </BuilderProvider>
  );
}
