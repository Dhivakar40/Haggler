import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { AdminRole, UserRole } from '@haggler/shared';
import type { Request } from 'express';
import { type ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const ADMIN_ROLES_KEY = 'adminRoles';

/** Skips the global user JWT guard (sign-in, health, catalog, and the admin routes which have their own guard). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Requires the caller to hold at least one of these roles (Customer / Worker=Ranger / Employer). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
/** Admin routes: require at least one of these admin roles. SUPER_ADMIN always passes. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  roles: UserRole[];
  deviceRefId: string | null;
}
export interface AuthAdmin {
  id: string;
  email: string;
  roles: AdminRole[];
}

export type AuthedRequest = Request & { user?: AuthUser; admin?: AuthAdmin; id?: string | number };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Error('CurrentUser used on a route without authentication');
  return req.user;
});

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthAdmin => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.admin) throw new Error('CurrentAdmin used on a route without admin authentication');
  return req.admin;
});

export const ClientIp = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    return ctx.switchToHttp().getRequest<Request>().ip;
  },
);

/** Documents a zod-validated request body in OpenAPI (converted from the shared schema). */
export const ApiZodBody = (schema: ZodSchema) =>
  ApiBody({
    schema: zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<
      string,
      unknown
    >,
  });
