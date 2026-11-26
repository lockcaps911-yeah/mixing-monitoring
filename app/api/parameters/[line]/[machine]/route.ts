import { NextResponse } from 'next/server';
import { getParameters } from '@/lib/queries';
import { authErrorResponse, requireLineAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ line: string; machine: string }> },
) {
  try {
    const { line, machine } = await params;
    await requireLineAccess(line);
    const parameters = await getParameters(line, machine);
    return NextResponse.json(parameters);
  } catch (error) {
    if (error instanceof Error && 'status' in error) return authErrorResponse(error);
    console.error('Parameter request failed', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
