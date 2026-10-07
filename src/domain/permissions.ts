const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

export type Actor = {
  userId: string;
  roles: string[];
  permissions?: string;
};

// FR-009: the creator, a member with Manage Server (or Administrator), or a member with the officer role.
export function canManage(
  actor: Actor,
  content: { createdBy: string | null },
  officerRoleId: string | null,
): boolean {
  if (content.createdBy !== null && content.createdBy === actor.userId) return true;
  if (officerRoleId !== null && actor.roles.includes(officerRoleId)) return true;
  return hasManageServer(actor.permissions);
}

export function hasManageServer(permissions: string | undefined): boolean {
  if (!permissions || !/^\d+$/.test(permissions)) return false;
  const bits = BigInt(permissions);
  return (bits & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n;
}
