export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getComments } from "@/lib/queries";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!id) return NextResponse.json([], { status: 400 });
  const rows = await getComments(id);
  return NextResponse.json(rows.map((c) => ({ authorName: c.authorName, tag: c.tag, body: c.body })));
}

