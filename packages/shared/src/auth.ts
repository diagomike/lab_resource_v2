import { z } from "zod";
import { RoleKindSchema, UserStatusSchema, WorkspaceKindSchema } from "./enums";
import { ScopeDto } from "./scope";

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const RegisterInput = z.object({
  token: z.string().min(1),
  name: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().optional(),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export const ForgotPasswordInput = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ResetPasswordInput = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

export const SessionUserDto = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  status: UserStatusSchema,
  roles: z.array(RoleKindSchema),
});
export type SessionUserDto = z.infer<typeof SessionUserDto>;

/**
 * Everything the shell needs on first paint: who you are, which unit you are acting for,
 * and whether you may see money.
 *
 * `canSeeCost` is resolved server-side from roles — the client never derives it, because
 * hiding a column is not access control. The API omits cost fields entirely for users
 * who lack it rather than sending them and trusting the UI to hide them.
 */
export const MeContextDto = z.object({
  user: SessionUserDto,
  scope: ScopeDto.nullable(),
  canSeeCost: z.boolean(),
  /** The workspace this session opens into. */
  workspace: WorkspaceKindSchema,
  /** Every workspace this user's role set qualifies for — powers the workspace switcher
   *  for someone who, say, holds both CUSTODIAN and a MANAGER occupancy. Always includes
   *  `workspace`. */
  availableWorkspaces: z.array(WorkspaceKindSchema),
});
export type MeContextDto = z.infer<typeof MeContextDto>;
