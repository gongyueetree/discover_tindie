import { srcColor, ini } from "@/lib/taxonomy";

/**
 * Brand logo placeholder.
 * TODO(real logos): drop image files into /public/logos/<slug>.png and pass
 * `src="/logos/<slug>.png"` — the <img> branch below will render them.
 * Until then we render a colored initial tile so layout/spacing is final.
 */
export function BrandLogo({ name, src, size = 40, radius = 9 }: { name: string; src?: string | null; size?: number; radius?: number }) {
  if (src) {
    return <img src={src} alt={name} width={size} height={size} style={{ width: size, height: size, borderRadius: radius, objectFit: "contain", background: "#fff", border: "1px solid #eee" }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: radius, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: size * 0.32, background: srcColor(name), lineHeight: 1 }}>
      {ini(name)}
    </span>
  );
}

