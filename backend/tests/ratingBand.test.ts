import { describe, expect, it } from "vitest";
import {
  averageElo,
  botDifficultyForElo,
  botOpponentEloForHuman,
  problemHalfBand,
} from "../src/utils/ratingBand";

describe("ratingBand helpers", () => {
  it("averages ratings and rounds to nearest integer", () => {
    expect(averageElo([1200, 1301])).toBe(1251);
    expect(averageElo([])).toBe(1200);
  });

  it("uses the configured problem half-band by mode", () => {
    expect(problemHalfBand("ranked")).toBe(150);
    expect(problemHalfBand("unranked")).toBe(280);
  });

  it("maps bot difficulty bands from human rating", () => {
    expect(botDifficultyForElo(900)).toBe("easy");
    expect(botDifficultyForElo(1300)).toBe("medium");
    expect(botDifficultyForElo(1700)).toBe("hard");
  });

  it("pulls synthetic bot rating toward 1200 and clamps extremes", () => {
    expect(botOpponentEloForHuman(1200)).toBe(1200);
    expect(botOpponentEloForHuman(2400)).toBe(1980);
    expect(botOpponentEloForHuman(100)).toBe(800);
  });
});
