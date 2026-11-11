// Pinning a message makes Discord post a "pinned a message" notice (type 6) that points at it.
// The bot deletes that notice to keep the channel quiet (ADR 0047). Pure domain (NFR-007).
const PIN_NOTICE_TYPE = 6;

export function findPinNotice(
  messages: { id: string; type: number; message_reference?: { message_id?: string } | null }[],
  pinnedId: string,
): string | null {
  return messages.find((m) => m.type === PIN_NOTICE_TYPE && m.message_reference?.message_id === pinnedId)?.id ?? null;
}
