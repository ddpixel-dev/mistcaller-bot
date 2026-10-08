const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

export type Actor = {
  userId: string;
  roles: string[];
  permissions?: string;
};

// FR-009 (ADR 0020): a bot admin holds one of the server's admin roles, or has Manage Server or Administrator.
export function isAdmin(actor: Actor, adminRoleIds: string[]): boolean {
  return actor.roles.some((r) => adminRoleIds.includes(r)) || hasManageServer(actor.permissions);
}

// The content's creator or a bot admin may manage the content.
export function canManage(actor: Actor, content: { createdBy: string | null }, adminRoleIds: string[]): boolean {
  if (content.createdBy !== null && content.createdBy === actor.userId) return true;
  return isAdmin(actor, adminRoleIds);
}

export function hasManageServer(permissions: string | undefined): boolean {
  if (!permissions || !/^\d+$/.test(permissions)) return false;
  const bits = BigInt(permissions);
  return (bits & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n;
}

// Presets are managed only by bot admins (ADR 0012, widened to admin roles by ADR 0020).
export function canManagePresets(actor: Actor, adminRoleIds: string[]): boolean {
  return isAdmin(actor, adminRoleIds);
}
