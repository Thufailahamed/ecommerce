import "@/components/storefront/storefront.css";

/** Published stores. The root layout's body is the dashboard's dark canvas; every store paints over it in its own theme. */
export default function StoresLayout({ children }: { children: React.ReactNode }) {
  return <div className="sf-host">{children}</div>;
}
