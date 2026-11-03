import { ToolShell } from "@/components/maker/ToolShell";
import { DiscoverContent } from "@/components/maker/DiscoverContent";
import { canSeeTools } from "@/lib/maker/visibility-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Default tab: the existing Discover page, so the current tindie.com/discover iframe keeps its landing view.
export default async function HomePage() {
  return (
    <ToolShell tools={await canSeeTools()}>
      <DiscoverContent />
    </ToolShell>
  );
}
