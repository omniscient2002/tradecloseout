"use client";

import { useEffect } from "react";
import { drainOfflineUploadQueue } from "../lib/offline-upload-queue";

export function PwaLifecycleManager() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // A mounted, foreground window reconciles durable PROCESSING receipts.
    // Service workers do not have authority to upload files from a closed tab.
    const reconcile = () => {
      if (!navigator.onLine || document.visibilityState === "hidden") return;
      void drainOfflineUploadQueue().catch(() => {
        // The queue retains failures for explicit user inspection/retry; never
        // label a failed drain as a successfully uploaded document.
      });
    };
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "TC_TRIGGER_OFFLINE_QUEUE_DRAIN") reconcile();
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
      navigator.serviceWorker.addEventListener("message", onWorkerMessage);
    }
    const handleOnline = () => {
      reconcile();
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        navigator.serviceWorker.ready
          .then((reg: any) => reg.sync?.register("tc-drain-offline-uploads"))
          .catch(() => undefined);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    // Bounded foreground status reconciliation, even without a new upload.
    const interval = window.setInterval(reconcile, 30_000);
    reconcile();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onWorkerMessage);
      }
    };
  }, []);

  return null;
}
