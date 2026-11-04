import { notFound, redirect } from "next/navigation";
import { ToolShell } from "@/components/maker/ToolShell";
import { ToolClient } from "@/components/maker/ToolClient";

const TOOLS = ["components", "circuits", "bom", "planner"];

export default async function Page(
  props: {
    params: Promise<{ tool: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  if (params.tool === "resources") redirect("/");
  if (params.tool === "viewer") {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams || {})) if (typeof v === "string") q.set(k, v);
    if (!q.has("project") && !q.has("design") && !q.has("example")) q.set("open", "upload");
    redirect("/tools/circuits?" + q);
  }
  if (!TOOLS.includes(params.tool)) notFound();
  return (
    <ToolShell>
      <ToolClient tool={params.tool} />
    </ToolShell>
  );
}
