import { test, expect } from "vitest";
import { getRunBus, emitRunEvent, closeRunBus } from "./events";
test("subscriber receives events emitted after subscribe", async () => {
  const bus = getRunBus("run1");
  const received: any[] = [];
  bus.on("event", (e) => received.push(e));
  emitRunEvent("run1", { id: 1, runId: "run1", ts: 0, kind: "message", payload: { kind: "message", text: "hi" } } as any);
  await new Promise((r) => setTimeout(r, 0));
  expect(received).toHaveLength(1);
});

test("closeRunBus emits end, clears listeners, and yields a fresh bus", () => {
  const bus = getRunBus("run2");
  let ended = false;
  bus.on("end", () => { ended = true; });
  closeRunBus("run2");
  expect(ended).toBe(true);
  expect(bus.listenerCount("end")).toBe(0);
  expect(getRunBus("run2")).not.toBe(bus);
});
