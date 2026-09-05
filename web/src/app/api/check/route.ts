import { NextResponse } from "next/server";
import { checkClaim } from "@/lib/gonka";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const claim = body && typeof body === "object" && "claim" in body ? body.claim : undefined;
  if (typeof claim !== "string" || claim.trim().length < 10 || claim.trim().length > 4_000) {
    return NextResponse.json({ error: "Claim must be between 10 and 4,000 characters" }, { status: 400 });
  }

  try {
    return NextResponse.json(await checkClaim(claim.trim()));
  } catch (error) {
    console.error("claim check failed", error instanceof Error ? error.message : "unknown error");
    const configured = Boolean(process.env.GONKA_API_KEY);
    return NextResponse.json(
      { error: configured ? "Gonka could not verify this claim" : "Gonka is not configured on the server" },
      { status: configured ? 502 : 503 },
    );
  }
}
