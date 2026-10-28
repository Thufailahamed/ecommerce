"use client";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session";
import type { Store } from "@/lib/api";
import { ConnectStore } from "./connect-store";

/** Renders children only when a store is selected; otherwise guides the user to connect one. */
export function NeedStore({ children }: { children: (store: Store) => ReactNode }) {
  const { store } = useSession();
  return store ? <>{children(store)}</> : <ConnectStore />;
}
