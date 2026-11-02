"use client";
import { useState } from "react";
import { TAXONOMY } from "@/lib/taxonomy";

export function SubscribeBox() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  async function go() {
    if (!/.+@.+\..+/.test(email)) { alert("Enter a valid email"); return; }
    const res = await fetch("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    if (res.ok) setDone(true);
  }
  return (
    <div style={{ background: "linear-gradient(135deg,#1c6e7e,#155561)", borderRadius: 12, padding: 17, marginBottom: 16 }}>
      <h3 style={{ fontSize: 14.5, fontWeight: 600, color: "#fff", marginBottom: 13 }}>Weekly digest</h3>
      {done ? <div style={{ color: "#d4eef0", fontSize: 13, textAlign: "center", padding: "10px 0" }}>✓ You&apos;re in. Check your inbox to confirm.</div> : (
        <>
          <p style={{ fontSize: 12.5, color: "#d4eef0", marginBottom: 11 }}>The 12 best finds, once a week. No spam.</p>
          <input value={email} maxLength={254} type="email" onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: "100%", padding: "10px 12px", border: 0, borderRadius: 7, marginBottom: 8, fontSize: 13 }} />
          <button onClick={go} style={{ width: "100%", background: "#22b8c4", color: "#fff", border: 0, padding: 10, borderRadius: 7, fontWeight: 600, cursor: "pointer", fontSize: 13.5 }}>Subscribe</button>
        </>
      )}
    </div>
  );
}

// Three things a visitor can send us. All three POST to the existing
// /api/submit (no backend change). The kind is encoded into the name prefix
// and the category field so editors can tell them apart in the admin queue
// and never accidentally "approve" a bug report into the live directory.
type SuggestKind = "resource" | "bug" | "idea";

const KINDS: { id: SuggestKind; label: string; blurb: string }[] = [
  { id: "resource", label: "Suggest a resource", blurb: "A tool, platform, community or service makers should know about." },
  { id: "bug", label: "Report a problem", blurb: "Something on this page looks wrong or doesn't work." },
  { id: "idea", label: "Suggest a feature", blurb: "An idea for something new you'd like to see here." },
];

export function SubmitButton() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SuggestKind>("resource");

  // Shared fields (reused across kinds; meaning shifts by kind).
  const [name, setName] = useState("");       // resource name  | short title
  const [url, setUrl] = useState("");          // website url     | page url (optional)
  const [cat, setCat] = useState(TAXONOMY[0].name); // resource category
  const [why, setWhy] = useState("");          // why it belongs | details
  const [sent, setSent] = useState(false);

  function reset() {
    setName(""); setUrl(""); setWhy(""); setCat(TAXONOMY[0].name);
  }

  async function submit() {
    if (!name.trim()) {
      alert(kind === "resource" ? "Add a resource name" : "Add a short title");
      return;
    }

    // Build the payload for the existing /api/submit endpoint.
    let payload: { name: string; url?: string; category?: string; why?: string };
    if (kind === "resource") {
      payload = { name, url, category: cat, why };
    } else {
      const prefix = kind === "bug" ? "[BUG]" : "[IDEA]";
      payload = {
        name: `${prefix} ${name}`,
        url,                                   // optional page link
        category: kind === "bug" ? "feedback-bug" : "feedback-idea",
        why,
      };
    }

    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) { setSent(true); reset(); }
    else { alert("Could not send — please try again."); }
  }

  const active = KINDS.find((k) => k.id === kind)!;
  const titleLabel = kind === "resource" ? "Resource name" : "Short title";
  const urlLabel = kind === "resource" ? "Website URL" : "Page URL (optional)";
  const whyLabel = kind === "resource" ? "Why it belongs here" : "Details";

  return (
    <>
      <div onClick={() => setOpen(true)} style={{ textAlign: "center", background: "#eef7f8", color: "#1c6e7e", padding: 11, borderRadius: 8, fontWeight: 600, fontSize: 13, border: "1px dashed #22b8c4", cursor: "pointer" }}>+ Suggest</div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 30 }} />
          <div style={{ position: "fixed", top: 0, right: 0, width: 460, maxWidth: "100vw", height: "100vh", background: "#fff", zIndex: 31, overflowY: "auto" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #ececec", display: "flex", alignItems: "center" }}>
              <h2 style={{ fontSize: 16, flex: 1, color: "#2f3438" }}>Suggest</h2>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: 0, fontSize: 24, color: "#8a9499", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              {sent ? (
                <div>
                  <p style={{ fontSize: 14, color: "#2f9d62", marginBottom: 14 }}>✓ Thanks — we&apos;ve received it and our team will take a look.</p>
                  <button onClick={() => { setSent(false); }} style={{ background: "#eef7f8", color: "#1c6e7e", border: "1px solid #22b8c4", borderRadius: 8, padding: "9px 16px", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Send another</button>
                </div>
              ) : (
                <>
                  {/* Kind selector */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                    {KINDS.map((k) => (
                      <span key={k.id} onClick={() => setKind(k.id)} style={{
                        fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 16, cursor: "pointer",
                        border: "1px solid " + (kind === k.id ? "#1c6e7e" : "#ececec"),
                        background: kind === k.id ? "#1c6e7e" : "#fff",
                        color: kind === k.id ? "#fff" : "#8a9499",
                      }}>{k.label}</span>
                    ))}
                  </div>
                  <p style={{ fontSize: 13, color: "#8a9499", marginBottom: 16 }}>{active.blurb}</p>

                  <Field label={titleLabel}><input value={name} maxLength={130} onChange={(e) => setName(e.target.value)} style={inp} /></Field>
                  <Field label={urlLabel}><input value={url} maxLength={2048} type="url" onChange={(e) => setUrl(e.target.value)} placeholder="https://" style={inp} /></Field>
                  {kind === "resource" && (
                    <Field label="Category"><select value={cat} onChange={(e) => setCat(e.target.value)} style={inp}>{TAXONOMY.map((t) => <option key={t.id}>{t.name}</option>)}</select></Field>
                  )}
                  <Field label={whyLabel}><textarea value={why} maxLength={1000} onChange={(e) => setWhy(e.target.value)} style={{ ...inp, minHeight: 70, resize: "vertical" }} /></Field>
                  <button onClick={submit} style={{ width: "100%", background: "#22b8c4", color: "#fff", border: 0, borderRadius: 8, padding: "11px 16px", fontWeight: 600, cursor: "pointer" }}>
                    {kind === "resource" ? "Submit for review" : "Send feedback"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 13 }}><label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: "#8a9499", fontWeight: 600, display: "block", marginBottom: 5 }}>{label}</label>{children}</div>;
}
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid #ececec", borderRadius: 8, fontSize: 14, outline: "none", fontFamily: "inherit" };

