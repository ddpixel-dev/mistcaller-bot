// FR-040: a fill has no position but holds a seat, so a fill who signed up early is never left without a place.
// `total` is the number of positions, `seated` the players in a position, `fills` the fill players.
export type SeatCounts = { seated: number; open: number; reserved: number; party: number; available: number };

export function seatCounts(total: number, seated: number, fills: number): SeatCounts {
  const open = Math.max(0, total - seated);
  const reserved = Math.min(fills, open);
  // `available` goes below zero when there are more fills than free positions: the extra fills are standby.
  return { seated, open, reserved, party: seated + reserved, available: open - fills };
}

// Whether someone who holds no position may take one: after they do, the free positions must still cover the fills.
// A fill taking a position for themselves stops being a fill, so their own reservation is released.
export function canTakePosition(open: number, fills: number, takerIsFill: boolean): boolean {
  return open - 1 >= fills - (takerIsFill ? 1 : 0);
}
