// One-party views whose rendered message was captured from the code before parties existed (FR-070 guarantee:
// normal and one-party content render exactly as before). The expected output is in oneParty.snapshot.json.
import type { RosterSlot, RosterView } from "../../../src/domain/types.ts";

const base: RosterView = {
  id: "c1", guildId: "g1", threadId: "t1", messageId: "m1", rosterChannelId: null, bombers: null, bomberIds: [], type: "pvp", kind: "other", partyCount: 1,
  title: "Ava roam", notes: "Bring food", startsAt: new Date("2026-10-07T18:00:00Z"), tier: "T5.3–T7.0",
  hasLoot: true, status: "open", ownerId: "900",
  slots: [], votes: { split: 1, regear: 2 }, voteClosed: false, voteResult: null,
};
const slot = (n: number, role: string, weapon: string, userId: string | null, extra: Partial<RosterSlot> = {}): RosterSlot =>
  ({ id: `s${n}`, position: n, party: 1, role, weapon, userId, ...extra });
const seats: RosterSlot[] = [
  slot(1, "Tank", "Broadsword", "111"),
  slot(2, "Healer", "Great Holy Staff", null),
  slot(3, "DPS", "Bow", "113", { duty: "caller" }),
  slot(4, "Support", "", "114", { chosenWeapon: "Cursed Staff" }),
  slot(5, "DPS", "Bow", null),
];
const crowded: Partial<RosterView> = {
  slots: seats,
  waitlist: [{ userId: "201", role: "Tank" }, { userId: "202", role: "Healer" }],
  fills: ["301", "302"], fillWants: { "301": "Any", "302": "Healer, #7" },
  applicants: [{ userId: "401", wants: "Tank" }],
  tentative: ["113", "301"], pingLeft: 2, buildRef: null,
};

export const ONE_PARTY_VIEWS: Record<string, RosterView> = {
  open: { ...base, slots: seats },
  crowded: { ...base, ...crowded },
  locked: { ...base, ...crowded, status: "locked" },
  done: { ...base, ...crowded, status: "done", voteClosed: true, voteResult: "regear" },
  cancelled: { ...base, ...crowded, status: "cancelled" },
  selection: { ...base, ...crowded, selection: true },
  cta: { ...base, ...crowded, cta: true, kind: "zvz" },
  fullRoles: { ...base, slots: [slot(1, "Tank", "Mace", "111"), slot(2, "Healer", "Holy", "112")], waitlist: [{ userId: "201", role: "Tank" }] },
  noLoot: { ...base, hasLoot: false, slots: seats },
  blank: { ...base, blank: true, slots: [] },
};
