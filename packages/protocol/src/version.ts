/**
 * Wire-protocol version for the CONTROL/AI/FILESYNC/EVENTS channels.
 *
 * Bump this integer whenever a message shape changes in a way that would
 * confuse an older peer — added required fields on existing messages,
 * repurposed field meanings, or changed channel semantics. Additive fields
 * on optional/backwards-compatible messages do NOT require a bump.
 *
 * The server advertises its version in `auth_ok.protocolVersion`. The client
 * compares against its own compiled constant and warns on mismatch. Older
 * servers that predate this handshake omit the field entirely, which the
 * client treats as "unversioned / very old".
 *
 * History:
 *   1 (2026-04-23) — first versioned release; project records carry
 *                     `workspacePath`, Files view requires it.
 */
export const PROTOCOL_VERSION = 1 as const
