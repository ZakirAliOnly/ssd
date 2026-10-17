import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";

import { validateModules, DEFAULT_MODULES } from "@/lib/moduleAccess";

const MAX_SUB_USERS = 5;

async function requireSuperAdmin(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return { error: "Unauthorized", status: 401 as const };
  const payload = await verifyToken(token);
  if (!payload) return { error: "Unauthorized", status: 401 as const };
  const currentUser = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!currentUser?.is_active) return { error: "Unauthorized", status: 401 as const };
  const role = currentUser.role;
  if (role !== "super_admin") return { error: "Forbidden", status: 403 as const };
  return { payload } as const;
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const users = await prisma.user.findMany({
    where: { role: "sub_user" },
    select: {
      id: true,
      email: true,
      full_name: true,
      is_active: true,
      modules: true,
      created_at: true,
    },
    orderBy: { created_at: "asc" },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      user_id: u.id,
      email: u.email,
      full_name: u.full_name,
      is_active: u.is_active,
      modules: u.modules,
      created_at: u.created_at.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const count = await prisma.user.count({ where: { role: "sub_user" } });
  if (count >= MAX_SUB_USERS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_SUB_USERS} sub-users allowed` },
      { status: 400 }
    );
  }

  const body = (await req.json()) as { email?: string; password?: string; fullName?: string; modules?: unknown };
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const fullName = body.fullName?.trim() ?? "";

  if (!email || !password || !fullName) {
    return NextResponse.json(
      { error: "Email, password and full name are required" },
      { status: 400 }
    );
  }
  if (!email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 400 });
  }

  let modules: string[];
  try { modules = validateModules(body.modules === undefined ? DEFAULT_MODULES : body.modules); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }

  const hash = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      email,
      password_hash: hash,
      full_name: fullName,
      role: "sub_user",
      modules,
      is_admin: false,
      is_active: true,
    },
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  // CR-15: admin can directly edit a sub-user's name and/or password without
  // having to know or enter the sub-user's current password.
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json()) as { userId?: string; fullName?: string; password?: string; modules?: unknown };
  const userId = body.userId?.trim() ?? "";
  const fullName = body.fullName !== undefined ? String(body.fullName).trim() : undefined;
  const password = body.password !== undefined ? String(body.password) : undefined;

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  if (fullName === undefined && password === undefined && body.modules === undefined) {
    return NextResponse.json({ error: "Provide fullName, password or modules to update" }, { status: 400 });
  }
  if (fullName !== undefined && fullName.length === 0) {
    return NextResponse.json({ error: "Full name cannot be empty" }, { status: 400 });
  }
  if (password !== undefined && password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.role !== "sub_user") {
    return NextResponse.json(
      { error: "Only sub-users can be edited from this endpoint" },
      { status: 400 }
    );
  }

  const data: { full_name?: string; password_hash?: string; modules?: string[] } = {};
  if (body.modules !== undefined) {
    try { data.modules = validateModules(body.modules); }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  }
  if (fullName !== undefined) data.full_name = fullName;
  if (password !== undefined) data.password_hash = await bcrypt.hash(password, 12);

  await prisma.user.update({ where: { id: userId }, data });

  return NextResponse.json({
    success: true,
    updated: {
      fullName: fullName !== undefined,
      password: password !== undefined,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId } = (await req.json()) as { userId?: string };
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.role !== "sub_user") {
    return NextResponse.json(
      { error: "Only sub-users can be deleted from this endpoint" },
      { status: 400 }
    );
  }

  await prisma.$transaction(async tx => {
    await tx.user.delete({ where: { id: userId } });
    await tx.activityLog.create({ data: { action: "delete", entity_type: "user", entity_id: userId,
      title: "Sub-user Deleted", subtitle: target.full_name || target.email,
      user_id: auth.payload.sub, user_email: auth.payload.email, user_name: auth.payload.full_name } });
  });
  return NextResponse.json({ success: true });
}
