import { NextResponse } from 'next/server';
import { getTrend } from '@/lib/queries';
import { RANGES, isRangeKey } from '@/lib/ranges';
import { authErrorResponse, requireLineAccess } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/trend/line4/mixingL4?range=week&tags=TT1001,TT1005
export async function GET(req: Request, ctx: { params: Promise<{ line: string; machine: string }> }) {
  try {
    const { line } = await ctx.params;
    await requireLineAccess(line);
  } catch (error) {
    return authErrorResponse(error);
  }
  const { line, machine } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const range = q.get('range') ?? 'hour';
  if (!isRangeKey(range)) return NextResponse.json({ error: 'range tidak valid' }, { status: 400 });

  const tags = (q.get('tags') ?? '').split(',').map((t) => t.trim()).filter((t) => /^[A-Za-z0-9_-]{1,40}$/.test(t)).slice(0, 8);
  if (tags.length === 0) return NextResponse.json({ error: 'tags kosong' }, { status: 400 });

  const series = await getTrend(line, machine, tags, range);
  return NextResponse.json({ range, bucketS: RANGES[range].bucketS, series });
}
