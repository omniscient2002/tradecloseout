"use client";

import { useEffect } from "react";
import { drainOfflineUploadQueue } from "../lib/offline-upload-queue";

export function PwaLifecycleManager() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let removeServiceWorkerListener = () => {};
    const drainQueue = () => {
      void drainOfflineUploadQueue().catch((error) => {
        console.warn("Offline upload queue could not be opened; drafts remain stored.", error);
      });
    };

    // 1. Register Service Worker
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/", updateViaCache: "none" })
          .catch(() => undefined);
      } else {
        // Update an existing worker too: it may control an already cached app shell.
        void navigator.serviceWorker.getRegistrations().then((registrations) =>
          Promise.all(registrations.filter((registration) =>
            new URL(registration.active?.scriptURL || registration.installing?.scriptURL || registration.waiting?.scriptURL || location.href).pathname === "/sw.js"
          ).map((registration) => registration.update().catch(() => undefined)))
        ).catch(() => undefined);
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === "TC_TRIGGER_OFFLINE_QUEUE_DRAIN") {
          drainQueue();
        }
      };
      navigator.serviceWorker.addEventListener("message", handleMessage);
      removeServiceWorkerListener = () => navigator.serviceWorker.removeEventListener("message", handleMessage);
    }

    // 2. Drain queued basement uploads whenever 4G reconnects
    const handleOnline = () => {
      drainQueue();
      if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator && "SyncManager" in window) {
        navigator.serviceWorker.ready
          .then((reg: any) => reg.sync?.register("tc-drain-offline-uploads"))
          .catch(() => undefined);
      }
    };

    window.addEventListener("online", handleOnline);
    if (navigator.onLine) {
      drainQueue();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      removeServiceWorkerListener();
    };
  }, []);

  return null;
}
