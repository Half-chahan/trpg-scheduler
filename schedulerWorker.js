import { computeNonHoResults, computeHoResults } from "./scheduler.js";

let activeRequestId = null;
let cancelled = false;

self.addEventListener("message", (event) => {
  const msg = event.data || {};

  if (msg.type === "start") {
    activeRequestId = msg.requestId;
    cancelled = false;

    const payload = msg.payload || {};
    const onProgress = (info) => {
      if (cancelled) return;
      self.postMessage({
        type: "progress",
        requestId: activeRequestId,
        steps: info.steps,
        limit: info.limit,
        daySetCount: info.daySetCount,
      });
    };
    const shouldAbort = () => cancelled;

    try {
      const result = payload.isHo
        ? computeHoResults({ ...payload, onProgress, shouldAbort })
        : computeNonHoResults({ ...payload, onProgress, shouldAbort });

      if (cancelled) {
        self.postMessage({
          type: "result",
          requestId: activeRequestId,
          results: [],
          aborted: true,
          cancelled: true,
        });
        return;
      }

      self.postMessage({
        type: "result",
        requestId: activeRequestId,
        results: result.results || [],
        aborted: !!result.aborted,
        cancelled: false,
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        requestId: activeRequestId,
        message: error && error.message ? error.message : String(error),
      });
    }
    return;
  }

  if (msg.type === "cancel" && msg.requestId === activeRequestId) {
    cancelled = true;
  }
});
