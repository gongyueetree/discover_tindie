import { getInbox, getAllResourcesAdmin, getSources, getPendingSubmissions, getDashboardStats, getAllRecommendations } from "@/lib/queries";
import { getAnalytics, getReadsByDay, getArticleReads, getResourceClicks, getDailyReads } from "@/lib/analytics";
import { AdminConsole } from "@/components/AdminConsole";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
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

