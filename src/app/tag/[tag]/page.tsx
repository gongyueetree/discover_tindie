import Link from "next/link";
import { DiscoveryGrid } from "@/components/Discovery";
import { HomeSearchProvider } from "@/components/HomeSearch";
import { getDiscoveriesByTag } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { tag: string } }) {
  const tag = decodeURIComponent(params.tag);
  return {
    title: `#${tag} — Hardware Discovery`,
    description: `Hardware discoveries tagged "${tag}" — products, tools and open-source projects for hardware creators.`,
  };
}

export default async function TagPage({ params }: { params: { tag: string } }) {
  const tag = decodeURIComponent(params.tag);
  const items = await getDiscoveriesByTag(tag);

  return (
    <>
      <div style={{ background: "#fafdfd" }}>
        <div className="wrap" style={{ padding: "30px 24px 18px" }}>
          <Link href="/" style={{ fontSize: 13.5, fontWeight: 600, color: "#1aa0ab", textDecoration: "none" }}>← Back to discoveries</Link>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.5px", color: "#2f3438", marginTop: 12 }}>
            <span style={{ color: "#22b8c4" }}>#</span>{tag}
          </h1>
          <p style={{ fontSize: 14.5, color: "#6a7176", marginTop: 6 }}>
            {items.length} {items.length === 1 ? "discovery" : "discoveries"} tagged “{tag}”.
          </p>
        </div>
      </div>
      <div className="wrap" style={{ padding: "22px 0 40px" }}>
        {items.length === 0 ? (
          <div style={{ color: "#8a9499", padding: 40, textAlign: "center", border: "1px dashed #ececec", borderRadius: 10 }}>
            No discoveries with this tag yet.
          </div>
        ) : (
          <HomeSearchProvider>
            <DiscoveryGrid items={items as any} />
          </HomeSearchProvider>
        )}
      </div>
    </>
  );
}

