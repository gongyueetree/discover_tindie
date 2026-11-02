export function circuitMetadata(p: any) {
  const raw = p.githubStars ?? p.stars ?? p.stargazers_count ?? p.github?.stars;
  const stars =
    typeof raw === "number" && Number.isFinite(raw) && raw >= 0
      ? Math.floor(raw)
      : null;
  const license =
    typeof p.license === "string"
      ? p.license
      : p.license?.spdx_id ||
        p.license?.declared ||
        p.license?.name ||
        p.github?.license?.spdx_id;
  return {
    ...p,
    githubStars: stars,
    license: {
      ...(typeof p.license === "object" ? p.license : {}),
      declared:
        typeof license === "string" &&
        license.trim() &&
        license !== "NOASSERTION"
          ? license
          : null,
    },
  };
}
export function byStars(a: any, b: any) {
  return (
    (b.githubStars ?? -1) - (a.githubStars ?? -1) ||
    String(a.id).localeCompare(String(b.id))
  );
}
