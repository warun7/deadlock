import { describe, expect, it } from "vitest";
import {
  difficultyRatingAsInt,
  normalizeProblemRating,
} from "../src/utils/problemRating";

describe("ProblemService helpers", () => {
  it("normalizes integer and string difficulty values", () => {
    expect(normalizeProblemRating(1234)).toBe("1234");
    expect(normalizeProblemRating(" 1500 ")).toBe("1500");
    expect(normalizeProblemRating("")).toBe("1000");
    expect(normalizeProblemRating(null)).toBe("1000");
  });

  it("parses numeric text safely for band filtering", () => {
    expect(difficultyRatingAsInt(1800)).toBe(1800);
    expect(difficultyRatingAsInt(" 2100 ")).toBe(2100);
    expect(difficultyRatingAsInt("not-a-rating")).toBeNull();
    expect(difficultyRatingAsInt(undefined)).toBeNull();
  });
});
