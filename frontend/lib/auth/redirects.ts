const ALLOWED_AUTH_DESTINATIONS = new Set(["/chat/new"]);

export function getSafeAuthDestination(value: string | null | undefined) {
  return value && ALLOWED_AUTH_DESTINATIONS.has(value) ? value : "/chat/new";
}
