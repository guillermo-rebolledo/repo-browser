export type FindingCategory =
  | "guidance"
  | "implementation"
  | "skills"
  | "safety";

export type FindingKind = "strength" | "opportunity";
export type Confidence = "high" | "medium" | "low";

export interface Evidence {
  path: string;
  line?: number;
  excerpt: string;
}

export interface Finding {
  id: string;
  category: FindingCategory;
  kind: FindingKind;
  title: string;
  description: string;
  recommendation?: string;
  confidence: Confidence;
  impact: "high" | "medium" | "low";
  evidence: Evidence[];
  points: number;
}

export interface CategoryScore {
  category: FindingCategory;
  label: string;
  score: number;
  summary: string;
}

export type ProjectType = "web" | "cli" | "agent" | "library" | "mixed" | "unknown";

export interface RepositoryMetadata {
  owner: string;
  name: string;
  url: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  language: string | null;
  updatedAt: string;
}

export interface RepositoryFile {
  path: string;
  content: string;
  size: number;
}

export interface ScanLimitations {
  filesInTree: number;
  filesScanned: number;
  bytesScanned: number;
  skippedFiles: number;
  truncatedTree: boolean;
  notes: string[];
}

export interface RepositorySnapshot {
  repository: RepositoryMetadata;
  files: RepositoryFile[];
  limitations: ScanLimitations;
}

export interface AnalysisResult {
  repository: RepositoryMetadata;
  projectType: ProjectType;
  overallScore: number;
  categories: CategoryScore[];
  findings: Finding[];
  limitations: ScanLimitations;
  analyzedAt: string;
  methodology: string;
}
