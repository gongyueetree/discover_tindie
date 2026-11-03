import { HomeBody } from "@/components/HomeBody";
import { SEED_LOGOS, SEED_RESOURCES } from "@/lib/seed-data";
import { canSeeTools } from "@/lib/maker/visibility-server";

function hasDatabaseConfig() {
  return Boolean(process.env.APP_DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL);
}

/**
 * The existing Discover page (Resources tab), unchanged in content and behaviour: same queries,
 * same signed-in saves and recommendation banner as the live app. Without a database (local
 * preview) the repository's resource directory is shown and nothing else is invented.
 */
export async function DiscoverContent() {
  let resources: any[] = SEED_RESOURCES.map((r, i) => ({ ...r, logo: SEED_LOGOS[r.slug] ?? null, id: i + 1, status: "active" })),
    discoveries: any[] = [],
    blogPosts: any[] = [],
    recommendation: any = null,
    savedIds: number[] = [],
    signedIn = false,
    unavailable = !hasDatabaseConfig();
  if (!unavailable) {
    try {
      const [q, { auth }] = await Promise.all([import("@/lib/queries"), import("@/lib/auth")]);
      const session = await auth().catch(() => null);
      const userId = (session?.user as any)?.id as string | undefined;
      signedIn = !!userId;
      [resources, discoveries, savedIds, recommendation, blogPosts] = await Promise.all([
        q.getResources(),
        q.getPublishedDiscoveries(6),
        userId ? q.getUserSaves(userId) : Promise.resolve([] as number[]),
        q.getActiveRecommendation(),
        q.getRecentBlogPosts(12),
      ]);
    } catch (e) {
      console.error("[discover] database unavailable", e instanceof Error ? e.message : e);
      unavailable = true;
    }
  }
  return (
    <div className="discover-preserved">
      {unavailable && (
        <div className="wrap">
          <div className="local-note">
            Local preview · Resource directory loaded from the repository. Connect the Discover database to show
            published discoveries and blog posts.
          </div>
        </div>
      )}
      <HomeBody
        resources={resources}
        topDiscoveries={(discoveries as any[]).slice(0, 6)}
        savedIds={savedIds}
        signedIn={signedIn}
        recommendation={recommendation}
        blogPosts={blogPosts}
        chrome={false}
        designViewer={await canSeeTools()}
      />
    </div>
  );
}
