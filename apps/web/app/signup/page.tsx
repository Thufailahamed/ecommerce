import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Create account" };
export default function Page() { return <Suspense fallback={null}><AuthForm mode="signup" /></Suspense>; }
