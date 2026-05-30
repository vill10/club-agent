import { EventEmitter } from "node:events";
import type { RunEvent } from "@/types";

const buses = new Map<string, EventEmitter>();

export function getRunBus(runId: string): EventEmitter {
  let bus = buses.get(runId);
  if (!bus) {
    bus = new EventEmitter();
    bus.setMaxListeners(50); // many SSE viewers per shared run
    buses.set(runId, bus);
  }
  return bus;
}

export function emitRunEvent(runId: string, event: RunEvent): void {
  getRunBus(runId).emit("event", event);
}

// Call when a run reaches a terminal status to free memory.
export function closeRunBus(runId: string): void {
  const bus = buses.get(runId);
  if (bus) { bus.emit("end"); bus.removeAllListeners(); buses.delete(runId); }
}
