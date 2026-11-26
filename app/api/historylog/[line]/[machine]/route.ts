import { NextResponse } from 'next/server';
import { getHistoryLog } from '@/lib/queries';
import { authErrorResponse, requireLineAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ line: string; machine: string }> },
) {
  try {
    const { line, machine } = await params;
    await requireLineAccess(line);
    const { searchParams } = new URL(req.url);
    const tag = searchParams.get('tag');
    if (!tag) {
      return NextResponse.json({ error: 'Missing tag parameter' }, { status: 400 });
    }

    const fromStr = searchParams.get('from');
    const toStr = searchParams.get('to');
    const limitStr = searchParams.get('limit');

    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 500, 1), 2000) : 500;

    const rows = await getHistoryLog(line, machine, tag, from, to, limit);

    return NextResponse.json({
      tag,
      count: rows.length,
      rows: rows.map((r) => ({
        ts: r.ts.toISOString(),
        value: Number(r.value),
      })),
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    });
  } catch (error) {
    if (error instanceof Error && 'status' in error) return authErrorResponse(error);
    console.error('History log request failed', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
