import type { Metadata } from "next";
import { ProjectImportAgentV2 } from "@/components/project-import/ProjectImportAgentV2";

export const metadata: Metadata = {
  title: "Import a Project | Tindie Seller",
  description: "Connect project accounts and turn hardware projects into Tindie listings with AI.",
};

export default function ImportProjectPage() {
  return <ProjectImportAgentV2 />;
}

