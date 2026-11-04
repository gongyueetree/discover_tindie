import Link from "next/link";
import { TindieHeader, TindieFooter } from "@/components/Chrome";
import { SubmitButton } from "@/components/PublicWidgets";
import { BrandLogo } from "@/components/BrandLogo";
import { getResources } from "@/lib/queries";
import { TAXONOMY } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

export default async function DirectoryPage(props: { searchParams: Promise<{ cat?: string; q?: string }> }) {
  const searchParams = await props.searchParams;
  const all = await getResources();
  const cat = searchParams.cat || "";
  const q = (searchParams.q || "").toLowerCase();
  let items = all.filter((r) => {
    if (cat && r.category !== cat) return false;
    if (q && !(r.name + r.description + (r.capLabel || "") + r.category).toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <>
      <TindieHeader />
      <div className="wrap" style={{ paddingTop: 26 }}>
        <div style={{ fontSize: 13, color: "#8a9499", marginBottom: 14 }}><Link href="/" style={{ color: "#1aa0ab" }}>Resources</Link> › Full Directory</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 24, fontWeight: 600, color: "#2f3438" }}>Curated Resource Directory</h2>
          <SubmitButton />
        </div>
        <p style={{ color: "#8a9499", fontSize: 14, marginBottom: 18 }}>{all.length} trusted platforms, tools, communities and services — competitors included, labeled by true capability.</p>

        {/* filter form (GET, server-rendered) */}
        <form style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          <input name="q" defaultValue={searchParams.q || ""} placeholder="Search resources…" style={{ flex: 1, minWidth: 180, padding: "9px 12px", border: "1px solid #ececec", borderRadius: 7, fontSize: 13.5 }} />
          <select name="cat" defaultValue={cat} style={{ padding: "9px 12px", border: "1px solid #ececec", borderRadius: 7, fontSize: 13.5 }}>
            <option value="">All categories</option>
            {TAXONOMY.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button style={{ background: "#22b8c4", color: "#fff", border: 0, borderRadius: 7, padding: "9px 18px", fontWeight: 600, cursor: "pointer" }}>Filter</button>
        </form>

        {items.length === 0 ? <div style={{ color: "#8a9499", padding: 30, textAlign: "center", border: "1px dashed #ececec", borderRadius: 10 }}>No resources match these filters.</div> :
          (cat ? <Grid items={items} /> :
            TAXONOMY.map((t) => {
              const group = items.filter((r) => r.category === t.id);
              if (!group.length) return null;
              return (
                <div key={t.id}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "#2f3438", margin: "24px 0 12px", display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", background: t.col }}>{t.ic}</span>
                    {t.name} <span style={{ fontSize: 12, color: "#8a9499", fontWeight: 400 }}>({group.length})</span>
                  </h3>
                  <Grid items={group} />
                </div>
              );
            }))}
      </div>
      <TindieFooter />
    </>
  );
}

function Grid({ items }: { items: any[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 15 }}>
      {items.map((r) => {
        const labels = [r.isPick && ["★ Pick", "#fff0e0", "#c25a14"], r.isPartner && ["Partner", "#e7f5ee", "#268a52"], r.isVerified && ["Verified", "#e4f3f5", "#1c8290"]].filter(Boolean) as [string, string, string][];
        return (
          <div key={r.id} style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 11, padding: 15, display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
              <BrandLogo name={r.name} src={r.logo} size={40} />
              <div style={{ flex: 1 }}>
                <h4 style={{ fontSize: 14, color: "#2f3438", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{r.name}
                  {labels.map(([t, bg, fg]) => <span key={t} style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 5, background: bg, color: fg }}>{t}</span>)}
                </h4>
                <div style={{ fontSize: 12.5, color: "#8a9499" }}>{r.description}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 10, background: "#f0f5f6", color: "#1c6e7e", padding: "2px 7px", borderRadius: 5 }}>{r.capLabel}</span>
              <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600, color: "#22b8c4", border: "1px solid #22b8c4", borderRadius: 6, padding: "5px 12px" }}>Visit ↗</a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

