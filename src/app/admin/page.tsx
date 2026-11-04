import { getInbox, getAllResourcesAdmin, getSources, getPendingSubmissions, getDashboardStats, getAllRecommendations } from "@/lib/queries";
import { getAnalytics, getReadsByDay, getArticleReads, getResourceClicks, getDailyReads } from "@/lib/analytics";
import { AdminConsole } from "@/components/AdminConsole";
import { isEditor } from "@/lib/guard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Checked here too, not only in middleware (defence in depth).
  if (!(await isEditor())) redirect("/login?next=/admin");
  const [inbox, published, resources, sources, submissions, stats, recommendations, analytics, readsByDay, articleReads, resourceClicks, dailyReads] = await Promise.all([
    getInbox("needs_review"),
    getInbox("published"),
    getAllResourcesAdmin(),
    getSources(),
    getPendingSubmissions(),
    getDashboardStats(),
    getAllRecommendations(),
    getAnalytics(),
    getReadsByDay(),
    getArticleReads(),
    getResourceClicks(),
    getDailyReads(),
  ]);
  return <AdminConsole inbox={inbox as any} published={published as any} resources={resources as any} sources={sources as any} submissions={submissions as any} stats={stats} recommendations={recommendations as any} analytics={analytics as any} contentStats={{ readsByDay, articleReads, resourceClicks, dailyReads } as any} />;
}

