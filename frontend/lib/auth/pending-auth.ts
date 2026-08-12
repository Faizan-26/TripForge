import { notifySessionStorageChange } from "@/lib/browser/use-session-storage";

export const EMAIL_KEY = "tripforge.auth.email";
export const TRIP_DRAFT_KEY = "tripforge.trip.draft";

export function saveAuthEmail(email: string) {
  sessionStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
  notifySessionStorageChange();
}

export function getAuthEmail() {
  return sessionStorage.getItem(EMAIL_KEY) ?? "";
}

export function clearAuthEmail() {
  sessionStorage.removeItem(EMAIL_KEY);
  notifySessionStorageChange();
}

export function saveTripDraft(draft: string) {
  const value = draft.trim();
  if (value) sessionStorage.setItem(TRIP_DRAFT_KEY, value);
  notifySessionStorageChange();
}

export function getTripDraft() {
  return sessionStorage.getItem(TRIP_DRAFT_KEY) ?? "";
}

export function clearTripDraft() {
  sessionStorage.removeItem(TRIP_DRAFT_KEY);
  notifySessionStorageChange();
}
