import { expect, it } from "vitest";
import { GET } from "./route";

it("returns a successful JSON health response", async () => {
  const response = GET();

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
