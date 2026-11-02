import { DiscoverContent } from "@/components/maker/DiscoverContent";
import { notFound, redirect } from "next/navigation";
import { ToolShell } from "@/components/maker/ToolShell";
import { ToolClient } from "@/components/maker/ToolClient";
export default function Page({
  params,
  searchParams,
}: {
  params: { tool: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (params.tool === "viewer") {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams || {}))
      if (typeof v === "string") q.set(k, v);
    if (!q.has("project") && !q.has("example")) q.set("open", "upload");
    redirect("/tools/circuits?" + q);
  }
  if (params.tool === "resources")
    return (
      <ToolShell>
        <DiscoverContent />
      </ToolShell>
    );

  if (
    !["components", "circuits", "viewer", "bom", "planner"].includes(
      params.tool,
    )
  )
    notFound();
  return (
    <ToolShell>
      <ToolClient tool={params.tool} />
    </ToolShell>
  );
}
