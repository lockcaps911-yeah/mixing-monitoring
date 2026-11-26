import { NextResponse } from 'next/server';
import { authErrorResponse, requireAdmin } from '@/lib/auth';
import { getProductionLines } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ lines: await getProductionLines() });
  } catch (error) {
    return authErrorResponse(error);
  }
}
