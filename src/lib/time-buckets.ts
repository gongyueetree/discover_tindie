// Client-safe helpers to bucket a 'YYYY-MM-DD' daily series into
// day / week / month buckets. All UTC to match the stored days.
export type Gran = "day" | "week" | "month";
export type Bucket = { key: string; label: string };

const MS_DAY = 86400_000;
const toUTC = (s: string) => new Date(s + "T00:00:00Z");
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function mondayOf(s: string): string {
  const d = toUTC(s);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return fmt(d);
}

// Ordered oldest -> newest buckets ending today, for the chosen granularity.
export function buildBuckets(gran: Gran): Bucket[] {
  const now = new Date();
  const today = fmt(now);
  const out: Bucket[] = [];
  if (gran === "day") {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(toUTC(today).getTime() - i * MS_DAY);
      out.push({ key: fmt(d), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` });
    }
  } else if (gran === "week") {
    const thisMon = toUTC(mondayOf(today));
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisMon.getTime() - i * 7 * MS_DAY);
      out.push({ key: fmt(d), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` });
    }
  } else {
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - i, 1));
      out.push({ key: fmt(d).slice(0, 7), label: MON[d.getUTCMonth()] });
    }
  }
  return out;
}

export function bucketKeyFor(day: string, gran: Gran): string {
  if (gran === "day") return day;
  if (gran === "week") return mondayOf(day);
  return day.slice(0, 7);
}

