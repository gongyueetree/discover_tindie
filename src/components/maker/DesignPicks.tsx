"use client";
/**
 * "Fresh open hardware" at the top of the Open hardware tab: the designs Claude picked from the day's
 * sources (daily cron, see src/lib/design-picks.ts). Each card opens the design in the online viewer
 * and links to its Resources article for the full write-up.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CircuitBoard, Github, Sparkles, Star } from "lucide-react";

export type Pick = {
  id: number;
  repoUrl: string;
  discoveryId: number | null;
  title: string;
  intro: string;
  highlights: string[];
  caveat: string | null;
  license: string | null;
  edaTool: string | null;
  stars: number | null;
  imageUrl: string | null;
  pickDate: string;
};

const shortDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function DesignPicks({ onOpen }: { onOpen: (repoUrl: string) => void }) {
  const [items, setItems] = useState<Pick[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/maker/picks")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!items?.length) return null;
  const shown = all ? items : items.slice(0, 3);
  return (
    <section className="picks" aria-labelledby="picks-title">
      <div className="picks-head">
        <h2 id="picks-title">
          <Sparkles size={17} aria-hidden /> Fresh open hardware
        </h2>
        <span>New designs from the sources we follow, picked and summarised by AI · updated daily</span>
      </div>
      <ul className="picks-grid">
        {shown.map((p) => (
          <li key={p.id} className="pick-card">
            <button className="pick-pic" onClick={() => onOpen(p.repoUrl)} tabIndex={-1} aria-hidden>
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
              ) : null}
              <CircuitBoard size={26} aria-hidden />
            </button>
            <div className="pick-body">
              <div className="pick-meta">
                <span>{shortDate(p.pickDate)}</span>
                {p.license && <span>{p.license}</span>}
                {p.edaTool && <span>{p.edaTool}</span>}
                {p.stars ? (
                  <span>
                    <Star size={11} aria-hidden /> {p.stars}
                  </span>
                ) : null}
              </div>
              <button className="pick-title" onClick={() => onOpen(p.repoUrl)}>
                {p.title}
              </button>
              <p className="pick-intro" title={p.intro}>{p.intro}</p>
              {p.highlights.length > 0 && (
                <ul className="pick-points">
                  {p.highlights.slice(0, 2).map((h) => (
                    <li key={h} title={h}>
                      <span className="pick-point-text">{h}</span>
                    </li>
                  ))}
                </ul>
              )}
              {p.caveat && (
                <p className="pick-caveat" title={p.caveat}>
                  <AlertTriangle size={13} aria-hidden /> <span className="pick-caveat-text">{p.caveat}</span>
                </p>
              )}
              <div className="pick-actions">
                <button className="btn primary small" onClick={() => onOpen(p.repoUrl)}>
                  <CircuitBoard size={14} aria-hidden /> View design files
                </button>
                {p.discoveryId ? (
                  <Link className="text-link" href={`/?d=${p.discoveryId}`}>
                    Read more <ArrowRight size={13} aria-hidden />
                  </Link>
                ) : null}
                <a className="pick-gh" href={p.repoUrl} target="_blank" rel="noopener noreferrer" title="Open on GitHub">
                  <Github size={14} aria-label="GitHub" />
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {items.length > 3 && (
        <button className="text-link picks-more" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${items.length} from the last two weeks`}
        </button>
      )}
      <p className="picks-note">
        Summaries are written by AI from the project&apos;s article and README and have not been checked by hand; the design files have
        not been built or tested by Tindie.
      </p>
    </section>
  );
}
