// Single source of user-facing action feedback. Every action (claim, list, trade,
// upgrade) emits one `orbis:activity` event; the ActivityFeed renders them in one
// consistent place instead of three scattered inline message spots.

export type ActivityKind = "ok" | "err" | "info";

export function emitActivity(kind: ActivityKind, text: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("orbis:activity", { detail: { kind, text } }));
}
