import { NextResponse } from 'next/server';
import { authErrorResponse, hasSameOrigin, requireAdmin } from '@/lib/auth';
import {
  deleteUser,
  getUser,
  isEmailConflict,
  UserInputError,
  UserNotFoundError,
  updateUser,
  validUserId,
  validateUserUpdate,
} from '@/lib/adminUsers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  try {
    await requireAdmin();
    const { id } = await params;
    if (!validUserId(id)) return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    const user = await getUser(id);
    return user
      ? NextResponse.json({ user })
      : NextResponse.json({ error: 'User not found' }, { status: 404 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(req: Request, { params }: Context) {
  try {
    const actor = await requireAdmin();
    if (!hasSameOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
    const { id } = await params;
    if (!validUserId(id)) return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const result = await updateUser(actor.id, id, validateUserUpdate(body));
    const response = NextResponse.json({ user: result.user, reauthenticate: actor.id === id && result.sessionRevoked });
    if (actor.id === id && result.sessionRevoked) response.cookies.delete('mixing_session');
    return response;
  } catch (error) {
    if (error instanceof UserInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UserNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (isEmailConflict(error)) return NextResponse.json({ error: 'Email is already in use' }, { status: 409 });
    return authErrorResponse(error);
  }
}

export async function DELETE(req: Request, { params }: Context) {
  try {
    const actor = await requireAdmin();
    if (!hasSameOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
    const { id } = await params;
    if (!validUserId(id)) return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    await deleteUser(actor.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UserNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    return authErrorResponse(error);
  }
}
