import { HomeBody } from "@/components/HomeBody";
import { SEED_RESOURCES } from "@/lib/seed-data";
export async function DiscoverContent({
  compact = false,
}: {
  compact?: boolean;
}) {
  let resources: any[] = SEED_RESOURCES.map((r, i) => ({
      ...r,
      id: i + 1,
      status: "active",
    })),
    discoveries: any[] = [],
    blogPosts: any[] = [],
    recommendation: any = null,
    unavailable = false;
  if (
    process.env.APP_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL
  ) {
    try {
      const q = await import("@/lib/queries");
      [resources, discoveries, blogPosts, recommendation] = await Promise.all([
        q.getResources(),
        q.getPublishedDiscoveries(6),
        q.getRecentBlogPosts(12),
        q.getActiveRecommendation(),
      ]);
    } catch {
      unavailable = true;
    }
  } else unavailable = true;
  return (
    <div
      className={compact ? "discover-preserved compact" : "discover-preserved"}
    >
      {unavailable && (
        <div className="local-note">
          Local preview · Resource directory loaded from the repository. Connect
          the existing Discover database to show published discoveries and blog
          posts.
        </div>
      )}
      <HomeBody
        resources={resources}
        topDiscoveries={discoveries}
        savedIds={[]}
        signedIn={false}
        recommendation={recommendation}
        blogPosts={blogPosts}
        chrome={false}
      />
    </div>
  );
}
