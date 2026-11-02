"use client";

import { useEffect } from "react";
import { drainOfflineUploadQueue } from "../lib/offline-upload-queue";

export function PwaLifecycleManager() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Register Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => undefined);

      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "TC_TRIGGER_OFFLINE_QUEUE_DRAIN") {
          void drainOfflineUploadQueue();
        }
      });
    }

    // 2. Drain queued basement uploads whenever 4G reconnects
    const handleOnline = () => {
      void drainOfflineUploadQueue();
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        navigator.serviceWorker.ready
          .then((reg: any) => reg.sync?.register("tc-drain-offline-uploads"))
          .catch(() => undefined);
      }
    };

    window.addEventListener("online", handleOnline);
    if (navigator.onLine) {
      void drainOfflineUploadQueue();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return null;
}
