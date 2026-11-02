import GraphEmbed from "./GraphEmbed";
import Link from "next/link";
import {
  ArrowRight,
  Upload,
  Search,
  Cpu,
  CircuitBoard,
  BookOpen,
  LayoutGrid,
  FileSpreadsheet,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
const cards = [
  {
    slug: "components",
    icon: Cpu,
    title: "Find the right part",
    text: "Search components, datasheets and CAD files.",
    tag: "COMPONENTS",
  },
  {
    slug: "circuits",
    icon: CircuitBoard,
    title: "Explore real circuits",
    text: "Open a design. See how it comes together.",
    tag: "OPEN HARDWARE",
  },
  {
    slug: "planner",
    icon: LayoutGrid,
    title: "Make room for your idea",
    text: "Choose parts and plan your board layout.",
    tag: "PCB PLANNER",
  },
  {
    slug: "resources",
    icon: BookOpen,
    title: "Find useful resources",
    text: "Discover tools, guides and hardware inspiration.",
    tag: "RESOURCES",
  },
];
export function MakerHome() {
  return (
    <>
      <section className="maker-hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span /> THE HARDWARE MAKER’S TOOLBOX
          </div>
          <h1>
            Good ideas start
            <br />
            with a little <em>tinkering.</em>
          </h1>
          <p>
            Find a part. Explore a circuit. Open your design.
            <br />
            Free engineering tools for whatever you’re building next.
          </p>
          <form action="/tools/components" className="hero-search">
            <Search size={21} />
            <input
              name="q"
              placeholder="Search a part number, e.g. AD9102"
              aria-label="Search components"
            />
            <button className="btn primary">
              Find parts <ArrowRight size={17} />
            </button>
          </form>
          <div className="hero-note">
            <ShieldCheck size={15} /> No sign-up. Just useful tools for your
            next build.
          </div>
        </div>
        <div className="hero-visual">
          <GraphEmbed />
        </div>
      </section>
      <section className="maker-content">
        <div className="section-top">
          <h2>A tool for every starting point</h2>
          <span>Pick something. Make something.</span>
        </div>
        <div className="tool-card-grid">
          {cards.map((c) => (
            <Link key={c.slug} href={`/tools/${c.slug}`} className="tool-card">
              <div className="tool-card-icon">
                <c.icon size={25} />
              </div>
              <small>{c.tag}</small>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
              <span className="card-arrow">
                <ArrowRight size={19} />
              </span>
            </Link>
          ))}
        </div>
        <div className="upload-strip">
          <div className="upload-icon">
            <Upload size={25} />
          </div>
          <div>
            <h3>Already have a design? Let’s open it.</h3>
            <p>
              KiCad, Eagle XML and ZIP projects. Parse and view files locally.
            </p>
          </div>
          <Link className="btn primary" href="/tools/circuits?open=upload">
            Open your project <ArrowUpRight size={16} />
          </Link>
          <Link className="btn" href="/tools/circuits?example=eagle">
            Try an example
          </Link>
        </div>
      </section>
    </>
  );
}
