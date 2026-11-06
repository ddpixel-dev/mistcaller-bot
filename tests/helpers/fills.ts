import type { FillPref } from "../../src/domain/fillmatch.ts";

// Choices that match no position on a test roster, so a fill who picks them waits instead of being seated (FR-057).
export const WAITING: FillPref = { any: false, roles: ["Nobody"], slotIds: [] };
