"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { TindieHeader } from "@/components/Chrome";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) { setErr("Invalid email or password."); return; }
    // Only allow same-site relative paths — never an absolute/protocol-relative
    // URL — so ?next=https://evil.com can't turn login into an open redirect.
    const raw = new URLSearchParams(location.search).get("next") || "/admin";
    const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/admin";
    location.href = next;
  }

  return (
    <>
      <TindieHeader />
      <div style={{ maxWidth: 380, margin: "60px auto", padding: "0 24px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "#2f3438", marginBottom: 6 }}>Sign in</h1>
        <p style={{ fontSize: 13.5, color: "#8a9499", marginBottom: 20 }}>Editorial &amp; admin access to the Resources console.</p>
        <form onSubmit={submit}>
          <label style={lbl}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" style={inp} />
          <label style={lbl}>Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" style={inp} />
          {err && <div style={{ color: "#b0364f", fontSize: 13, marginBottom: 12 }}>{err}</div>}
          <button disabled={loading} style={{ width: "100%", background: "#22b8c4", color: "#fff", border: 0, borderRadius: 8, padding: "12px", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>{loading ? "Signing in…" : "Sign in"}</button>
        </form>
        <p style={{ fontSize: 12, color: "#8a9499", marginTop: 16 }}>Editorial &amp; admin accounts are provisioned by the site owner.</p>
      </div>
    </>
  );
}
const lbl: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: "#8a9499", fontWeight: 600, display: "block", marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "11px 12px", border: "1px solid #ececec", borderRadius: 8, fontSize: 14, outline: "none", marginBottom: 14, fontFamily: "inherit" };

