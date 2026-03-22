import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redisService } from "../src/services/RedisService";

describe("RedisService.getActiveMatchIdForUser", () => {
  const originalClient = (redisService as any).client;

  beforeEach(() => {
    (redisService as any).client = {
      del: vi.fn().mockResolvedValue(1),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (redisService as any).client = originalClient;
  });

  it("returns the match id when the referenced match is active", async () => {
    vi.spyOn(redisService, "getUserMatchId").mockResolvedValue("match-1");
    vi.spyOn(redisService, "getMatch").mockResolvedValue({
      id: "match-1",
      status: "active",
    } as any);

    await expect(redisService.getActiveMatchIdForUser("user-1")).resolves.toBe(
      "match-1",
    );
    expect((redisService as any).client.del).not.toHaveBeenCalled();
  });

  it("clears the pointer when the match is missing", async () => {
    vi.spyOn(redisService, "getUserMatchId").mockResolvedValue("match-2");
    vi.spyOn(redisService, "getMatch").mockResolvedValue(null);

    await expect(redisService.getActiveMatchIdForUser("user-2")).resolves.toBe(
      null,
    );
    expect((redisService as any).client.del).toHaveBeenCalledWith(
      "user:user-2:match",
    );
  });

  it("clears the pointer when the match is no longer active", async () => {
    vi.spyOn(redisService, "getUserMatchId").mockResolvedValue("match-3");
    vi.spyOn(redisService, "getMatch").mockResolvedValue({
      id: "match-3",
      status: "finished",
    } as any);

    await expect(redisService.getActiveMatchIdForUser("user-3")).resolves.toBe(
      null,
    );
    expect((redisService as any).client.del).toHaveBeenCalledWith(
      "user:user-3:match",
    );
  });
});
