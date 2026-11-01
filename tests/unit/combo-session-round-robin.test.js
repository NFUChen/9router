import { describe, it, expect, beforeEach, vi } from "vitest";

import { handleComboChat, getStickyComboModel, resetComboRotation } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
const MODELS = ["cc/opus", "ag/astra", "cx/gpt-5"];
const COMBO = "rr-combo";

function okResponse(content = "ok") {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), clone: make, json: async () => json });
  return make();
}

function errResponse(status = 500, message = "error") {
  const json = { error: { message } };
  const make = () => ({ ok: false, status, headers: new Headers({ "content-type": "application/json" }), clone: make, json: async () => json });
  return make();
}

function makeHandler(failing = new Set()) {
  const calls = [];
  const handleSingleModel = vi.fn(async (_body, model) => {
    calls.push(model);
    return failing.has(model) ? errResponse(503, "Service Unavailable") : okResponse(`from ${model}`);
  });
  return { calls, handleSingleModel };
}

function send(handleSingleModel, sessionId) {
  return handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models: MODELS,
    handleSingleModel,
    log,
    comboName: COMBO,
    comboStrategy: "session-round-robin",
    sessionId,
  });
}

describe("session-round-robin combo strategy", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("assigns each new session the next model in the combo list", async () => {
    const { calls, handleSingleModel } = makeHandler();

    await send(handleSingleModel, "s1");
    await send(handleSingleModel, "s2");
    await send(handleSingleModel, "s3");
    await send(handleSingleModel, "s4");

    expect(calls).toEqual(["cc/opus", "ag/astra", "cx/gpt-5", "cc/opus"]);
  });

  it("keeps every turn of a session on its assigned model", async () => {
    const { calls, handleSingleModel } = makeHandler();

    await send(handleSingleModel, "s1");
    await send(handleSingleModel, "s2");
    await send(handleSingleModel, "s1");
    await send(handleSingleModel, "s2");

    expect(calls).toEqual(["cc/opus", "ag/astra", "cc/opus", "ag/astra"]);
  });

  it("does not advance the rotation for follow-up turns of an existing session", async () => {
    const { calls, handleSingleModel } = makeHandler();

    await send(handleSingleModel, "s1");
    await send(handleSingleModel, "s1");
    await send(handleSingleModel, "s1");
    await send(handleSingleModel, "s2");

    expect(calls.at(-1)).toBe("ag/astra");
  });

  it("falls back to the next model and releases the session when the assigned model fails", async () => {
    const { calls, handleSingleModel } = makeHandler(new Set(["cc/opus"]));

    const res = await send(handleSingleModel, "s1");

    expect(res.ok).toBe(true);
    expect(calls).toEqual(["cc/opus", "ag/astra"]);
    expect(getStickyComboModel(COMBO, "s1", MODELS)).toBeNull();
  });

  it("rotates per request when no session id is available", async () => {
    const { calls, handleSingleModel } = makeHandler();

    await send(handleSingleModel, null);
    await send(handleSingleModel, null);

    expect(calls).toEqual(["cc/opus", "ag/astra"]);
  });
});
