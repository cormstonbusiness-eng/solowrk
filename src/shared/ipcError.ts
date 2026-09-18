/**
 * Taking Electron's envelope off an error before anybody reads it.
 *
 * `ipcRenderer.invoke` rejects with the main process's message wrapped in its
 * own plumbing:
 *
 *     Error invoking remote method 'auth:signIn': Error: That email and
 *     password do not match.
 *
 * The useful half is at the end. The half a customer sees first names an
 * internal channel and a mechanism they have no reason to know exists — so a
 * perfectly clear sentence ("that email and password do not match") arrives
 * looking like the app has broken rather than like they mistyped something.
 * Somebody who sees that reasonably stops trusting the next message too.
 *
 * Stripped once, in the preload bridge, so every channel benefits rather than
 * each screen remembering to tidy up after itself.
 *
 * **This must not damage the sentinel errors.** `LimitReachedError` and
 * `FeatureLockedError` carry their payload in the message and are found with
 * `indexOf`, anywhere in the string — removing a prefix leaves them exactly as
 * findable as before. That is why they were written to search rather than to
 * match from the start.
 */

/** `Error invoking remote method 'some:channel': ` */
const ENVELOPE = /^Error invoking remote method '[^']*':\s*/

/**
 * A single leading `Error: `, and only one.
 *
 * Electron writes the class name here, and for everything thrown across this
 * boundary that is `Error`. Only one is removed: a message that genuinely
 * contains "Error: " later on is a message that meant to.
 */
const LEADING_NAME = /^Error:\s*/

export function unwrapIpcError(message: string): string {
  const withoutEnvelope = message.replace(ENVELOPE, "");

  // Only strip the class name if an envelope was actually there. A message
  // that legitimately begins "Error: ..." and never crossed IPC keeps its
  // wording — this function should be invisible to anything it does not apply
  // to.
  if (withoutEnvelope === message) return message;

  return withoutEnvelope.replace(LEADING_NAME, "").trim();
}

/**
 * The same, for whatever a `catch` actually handed you.
 *
 * Returns a plain string rather than an Error because every caller is about to
 * put it on screen, and the one thing none of them wants is another object to
 * unwrap.
 */
export function messageFrom(error: unknown, fallback = "Something went wrong."): string {
  const raw =
    error instanceof Error ? error.message
    : typeof error === "string" ? error
    : "";

  const cleaned = unwrapIpcError(raw).trim();
  return cleaned === "" ? fallback : cleaned;
}
