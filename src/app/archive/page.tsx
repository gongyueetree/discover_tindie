import Link from "next/link";
import { redirect } from "next/navigation";
import { TindieHeader, TindieFooter } from "@/components/Chrome";
import { DiscoveryGrid } from "@/components/Discovery";
import { HomeSearchProvider } from "@/components/HomeSearch";
import { ArchiveDateNav } from "@/components/ArchiveDateNav";
import { getPublishDates, getDiscoveriesByDate } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ArchivePage({ searchParams }: { searchParams: { date?: string } }) {
  const dates = await getPublishDates();
  // If the requested date has no edition, jump to the closest one that does.
  if (searchParams.date && dates.length > 0 && !dates.includes(searchParams.date)) {
    const want = new Date(searchParams.date + "T00:00").getTime();
    const nearest = [...dates].sort((a, b) =>
      Math.abs(new Date(a + "T00:00").getTime() - want) - Math.abs(new Date(b + "T00:00").getTime() - want)
    )[0];
    redirect(`/archive?date=${nearest}`);
  }
  const active = searchParams.date && dates.includes(searchParams.date) ? searchParams.date : (dates[0] || new Date().toISOString().slice(0, 10));
  const items = await getDiscoveriesByDate(active);

  return (
    <>
      <TindieHeader />
      <div className="wrap" style={{ paddingTop: 26 }}>
        <div style={{ fontSize: 13, color: "#8a9499", marginBottom: 14 }}><Link href="/" style={{ color: "#1aa0ab" }}>Resources</Link> › Daily Archive</div>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "#2f3438" }}>Daily Hardware Discoveries — Archive</h2>
        <p style={{ color: "#8a9499", fontSize: 14, marginBottom: 18 }}>Each edition is balanced across categories. Browse by day.</p>
        {dates.length === 0
          ? <div style={{ color: "#8a9499", fontSize: 14, marginBottom: 20 }}>No published editions yet.</div>
          : <ArchiveDateNav dates={dates} active={active} />}
        <HomeSearchProvider><DiscoveryGrid items={items as any} /></HomeSearchProvider>
      </div>
      <TindieFooter />
    </>
  );
}

