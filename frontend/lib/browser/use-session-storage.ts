"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("tripforge:session-storage", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("tripforge:session-storage", callback);
  };
}

export function useSessionStorage(key: string) {
  return useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(key) ?? "",
    () => "",
  );
}

export function notifySessionStorageChange() {
  window.dispatchEvent(new Event("tripforge:session-storage"));
}
