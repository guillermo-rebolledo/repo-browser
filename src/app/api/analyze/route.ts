import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeRepository } from "@/lib/analysis/analyze";
import { fetchRepositorySnapshot, GitHubError } from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  repositoryUrl: z.string().trim().min(1).max(500),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "A GitHub repository URL is required." } },
      { status: 400 },
    );
  }

  try {
    const snapshot = await fetchRepositorySnapshot(parsed.data.repositoryUrl);
    return NextResponse.json({ data: analyzeRepository(snapshot) });
  } catch (error) {
    if (error instanceof GitHubError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    console.error("Repository analysis failed", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "The repository could not be analyzed." } },
      { status: 500 },
    );
  }
}
