import { z } from "zod";
import { RoleKindSchema, UserStatusSchema } from "./enums";
import { ScopeDto } from "./scope";
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

/** Turning notification emails on or off — for yourself (Profile) or, as an admin or
 *  head, for someone you manage (People & roles). */
export const SetEmailNotificationsInput = z.object({ enabled: z.boolean() });
export type SetEmailNotificationsInput = z.infer<typeof SetEmailNotificationsInput>;

/** A phone number on an account: what an outside requester calls (a custodian holding a
 *  place for them is their contact person). Empty clears it. */
export const SetPhoneInput = z.object({
  phone: z
    .string()
    .trim()
    .max(30, "A phone number is at most 30 characters.")
    .refine((v) => v === "" || (/^\+?[0-9 ()-]+$/.test(v) && v.replace(/\D/g, "").length >= 9), "Give a phone number of at least 9 digits, like +251 911 234 567 or 0911 234 567."),
});
export type SetPhoneInput = z.infer<typeof SetPhoneInput>;

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
  /** EXTERNAL accounts only: the institution or company they ask on behalf of. */
  organisation: z.string().nullable(),
  status: UserStatusSchema,
  roles: z.array(RoleKindSchema),
  /** True after an administrator set a temporary password — the shell shows only the
   *  change-password screen until it is replaced. */
  mustChangePassword: z.boolean(),
  /** Notification emails reach this person (User.emailNotifications). */
  emailNotifications: z.boolean(),
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
/**
 * What this person does, in plain facts — computed server-side from their roles and the
 * posts they occupy (lib/server/auth/capabilities.ts). The sidebar, Home and each screen
 * decide what to show from these; the server re-checks every action regardless.
 */
export const CapabilitiesDto = z.object({
  isAdmin: z.boolean(),
  isPropertyAdmin: z.boolean(),
  isProcurement: z.boolean(),
  isStoreKeeper: z.boolean(),
  isCustodian: z.boolean(),
  isAdaa: z.boolean(),
  /** Departments this person heads (occupies). */
  headOf: z.array(z.string()),
  /** Colleges this person is dean of (occupies). */
  deanOf: z.array(z.string()),
  /** Occupies the university root (the AVP). */
  isAvp: z.boolean(),
  /** Codes of the offices this person occupies ("CMD", "PROP", "PROC", "ICT"). */
  officeCodes: z.array(z.string()),
  /** The college an ADAA answers for. */
  adaaCollegeId: z.string().nullable(),
  /** Units whose labs and stores this person creates and manages (heads, Property
   *  Administration for the university's Main Store, the admin for all). Not deans. */
  managesPlacesIn: z.array(z.string()),
  /** Units whose STORES (only) this person creates and manages, choosing each one's store
   *  keeper — the ADAA, for their college. */
  managesStoresIn: z.array(z.string()),
  /** Units whose labs and stores this person may hand to another custodian ("Change who
   *  runs it"): every unit they manage places in, plus the ADAA's whole college. */
  assignsPeopleIn: z.array(z.string()),
});
export type CapabilitiesDto = z.infer<typeof CapabilitiesDto>;

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
  caps: CapabilitiesDto,
});
export type MeContextDto = z.infer<typeof MeContextDto>;
