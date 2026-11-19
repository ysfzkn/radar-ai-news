import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";

describe("health", () => {
  it("answers /healthz", async () => {
    const res = await app.fetch(new Request("http://localhost/healthz"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("answers 404 elsewhere", async () => {
    const res = await app.fetch(new Request("http://localhost/nope"), env);
    expect(res.status).toBe(404);
  });
});
