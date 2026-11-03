import { ToolShell } from "@/components/maker/ToolShell";
import { DiscoverContent } from "@/components/maker/DiscoverContent";
import { canSeeTools } from "@/lib/maker/visibility-server";

export const dynamic = "force-dynamic";

// Chrome-free entry for iframing; identical to the home page (this app never renders site chrome).
export default async function Embed() {
  return (
    <ToolShell tools={await canSeeTools()}>
      <DiscoverContent />
    </ToolShell>
  );
}
