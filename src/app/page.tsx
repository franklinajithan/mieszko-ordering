import { Suspense } from "react";
import { DashboardOverview } from "@/components/layout/dashboard-overview";
import { HomePageView } from "@/components/layout/home-page";

export default function HomePage() {
  return <HomePageView overview={<Suspense fallback={<p>Loading trading overview…</p>}><DashboardOverview /></Suspense>} />;
}
