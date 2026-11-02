export type FieldStatus =
  | "USER_CONFIRMED"
  | "SOURCE_EXTRACTED"
  | "AI_INFERRED"
  | "AI_GENERATED"
  | "MISSING"
  | "CONFLICT";

export interface ListingField<T> {
  value: T | null;
  status: FieldStatus;
  confidence?: number;
  evidence?: string[];
}

export interface RepositorySummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string;
  htmlUrl: string;
  defaultBranch: string;
  updatedAt: string;
  language: string | null;
  stars: number;
  private: boolean;
}

export interface GithubConnection {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  avatarUrl: string | null;
  repositorySelection: "all" | "selected" | "unknown";
  repositoryCount?: number;
  connectedAt: string;
}

export interface ConnectedAccountsResponse {
  githubAppConfigured: boolean;
  githubConnections: GithubConnection[];
  publicGithubFallback: boolean;
}

export interface ProjectSourceIR {
  provider: "github" | "hackaday" | "hackster" | "url" | "ezplm" | "upload";
  accountId?: string | null;
  projectId?: string | number | null;
  projectUrl: string;
  projectName: string;
  version?: string | null;
  visibility?: "public" | "private" | "unknown";
  metadata?: Record<string, unknown>;
}

export interface ArtifactManifest {
  totalFiles: number;
  readme: boolean;
  schematic: number;
  pcb: number;
  bom: number;
  gerber: number;
  firmware: number;
  cad: number;
  images: number;
  docs: number;
  examples: number;
  evidenceFiles: string[];
}

export interface HardwareFacts {
  processors: string[];
  interfaces: string[];
  dimensions: string | null;
  coreParts: string[];
}

export interface ListingDraft {
  title: ListingField<string>;
  category: ListingField<string>;
  shortDescription: ListingField<string>;
  modelNumber: ListingField<string>;
  whatIsIt: ListingField<string>;
  whyMadeIt: ListingField<string>;
  whatMakesSpecial: ListingField<string>;
  features: ListingField<string[]>;
  documentationUrl: ListingField<string>;
  sourceCodeUrl: ListingField<string>;
  designFilesUrl: ListingField<string>;
  price: ListingField<number>;
  inventory: ListingField<number>;
  weight: ListingField<number>;
  shipsFrom: ListingField<string>;
  shippingProfile: ListingField<string>;
  handlingDays: ListingField<number>;
}

export interface ProjectImportResult {
  id: string;
  sourceType: "github" | "hackaday" | "hackster" | "url" | "ezplm" | "upload";
  sourceLabel: string;
  sourceUrl: string;
  projectName: string;
  projectDescription: string;
  sourceIR?: ProjectSourceIR;
  manifest: ArtifactManifest;
  hardware: HardwareFacts;
  listing: ListingDraft;
  readiness: {
    completeness: number;
    evidenceCoverage: number;
    sellerConfirmation: number;
  };
  warnings: string[];
  sellerRequired: string[];
  aiEnhanced: boolean;
  generatedAt: string;
}

export interface AnalyzeGithubInput {
  sourceType: "github";
  owner: string;
  repo: string;
  installationId?: number;
}

export interface AnalyzeUrlInput {
  sourceType: "hackaday" | "hackster" | "url" | "ezplm";
  url: string;
}

export type AnalyzeInput = AnalyzeGithubInput | AnalyzeUrlInput;

export interface ImportHistoryItem {
  id: string;
  sourceType: ProjectImportResult["sourceType"];
  sourceLabel: string;
  sourceUrl: string;
  projectName: string;
  status: "ANALYZED" | "DRAFT" | "PUBLISHED";
  updatedAt: string;
  result: ProjectImportResult;
  seller?: {
    price?: string;
    inventory?: string;
    modelNumber?: string;
    shipsFrom?: string;
    shippingProfile?: string;
    handlingDays?: string;
    weight?: string;
    included?: string[];
  };
}

