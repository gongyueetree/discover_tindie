import { ToolShell } from "@/components/maker/ToolShell";
import { DiscoverContent } from "@/components/maker/DiscoverContent";

export const dynamic = "force-dynamic";

// Chrome-free entry for iframing; identical to the home page (this app never renders site chrome).
export default function Embed() {
  return (
    <ToolShell>
      <DiscoverContent />
    </ToolShell>
  );
}
