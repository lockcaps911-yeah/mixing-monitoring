import { NextResponse } from 'next/server';
import { getHistory } from '@/lib/queries';
import { authErrorResponse, requireLineAccess } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/history/line1/TK1001?minutes=10
export async function GET(
  req: Request,
  ctx: { params: Promise<{ line: string; machine: string }> },
) {
  try {
    const { line } = await ctx.params;
    await requireLineAccess(line);
  } catch (error) {
    return authErrorResponse(error);
  }
  const { line, machine } = await ctx.params;
  const raw = Number(new URL(req.url).searchParams.get('minutes') ?? 10);
  const minutes = Math.min(Math.max(Number.isFinite(raw) ? raw : 10, 1), 120);
  return NextResponse.json(await getHistory(line, machine, minutes));
}
