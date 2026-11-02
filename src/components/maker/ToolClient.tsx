"use client";
import dynamic from "next/dynamic";
const loading = () => <div className="loading-tool">Opening workspace…</div>;
const Components = dynamic(() => import("./Components"), {
  ssr: false,
  loading,
});
const Circuits = dynamic(() => import("./Circuits"), { ssr: false, loading });
const Viewer = dynamic(() => import("./Viewer"), { ssr: false, loading });
const Bom = dynamic(() => import("./Bom"), { ssr: false, loading });
const Planner = dynamic(() => import("./Planner"), { ssr: false, loading });
export function ToolClient({ tool }: { tool: string }) {
  return (
    <main className="tool-content">
      {tool === "components" ? (
        <Components />
      ) : tool === "circuits" ? (
        <Circuits />
      ) : tool === "viewer" ? (
        <Viewer />
      ) : tool === "bom" ? (
        <Bom />
      ) : (
        <Planner />
      )}
    </main>
  );
}
