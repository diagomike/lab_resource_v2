import { z } from "zod";
import { RoleKindSchema, UserStatusSchema } from "./enums";
import { ScopeDto } from "./scope";
import { AccessViewSummaryDto } from "./resources/access-view";
import { ScopeModeSchema } from "./resources/enums";

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
  /** True after an administrator set a temporary password — the shell shows only the
   *  change-password screen until it is replaced. */
  mustChangePassword: z.boolean(),
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
  /** ItemScopeService's default resolution for this person — global role →
   *  MY_CUSTODY (a custodian without MANAGER) → ORG_SUBTREE. What the sidebar's scope
   *  panel labels; narrower than `scope` above, which describes org-hierarchy reach,
   *  not resource reach specifically (they usually agree, but MY_CUSTODY has no org
   *  node of its own). */
  scopeMode: ScopeModeSchema,
  /** Access views this person may choose between (lib/domain/views.ts's
   *  `viewsForPerson`), most specific first. Empty until Phase 11 of
   *  ~/.claude/plans/wait-i-want-gentle-haven.md seeds real AccessView rows — the
   *  sidebar's view picker degrades to just the scope label when this is empty. */
  views: z.array(AccessViewSummaryDto),
});
export type MeContextDto = z.infer<typeof MeContextDto>;
