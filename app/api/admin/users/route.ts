import { NextResponse } from 'next/server';
import { authErrorResponse, hasSameOrigin, requireAdmin } from '@/lib/auth';
import {
  createUser,
  isEmailConflict,
  listUsers,
  UserInputError,
  validateUserCreate,
} from '@/lib/adminUsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const query = new URL(req.url).searchParams;
    const search = (query.get('search') ?? '').slice(0, 100);
    const page = Math.max(1, Math.min(Number.parseInt(query.get('page') ?? '1', 10) || 1, 1_000_000));
    const pageSize = Math.max(1, Math.min(Number.parseInt(query.get('pageSize') ?? '20', 10) || 20, 100));
    const role = query.get('role') ?? '';
    if (role !== '' && role !== 'ADMIN' && role !== 'USER') {
      return NextResponse.json({ error: 'Role filter is invalid' }, { status: 400 });
    }
    const status = query.get('status') ?? '';
    if (status !== '' && status !== 'active' && status !== 'inactive') {
      return NextResponse.json({ error: 'Status filter is invalid' }, { status: 400 });
    }
    const active = status === '' ? null : status === 'active';
    return NextResponse.json(await listUsers(search, page, pageSize, role, active));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAdmin();
    if (!hasSameOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const input = validateUserCreate(body);
    return NextResponse.json({ user: await createUser(actor.id, input) }, { status: 201 });
  } catch (error) {
    if (error instanceof UserInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (isEmailConflict(error)) return NextResponse.json({ error: 'Email is already in use' }, { status: 409 });
    return authErrorResponse(error);
  }
}
