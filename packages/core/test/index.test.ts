import { describe, expect, it } from "vite-plus/test";
import { isSupportedAtsType, SUPPORTED_ATS_TYPES } from "../src/index";

describe("ATS type support", () => {
  it("recognizes the first-build ATS platforms", () => {
    expect(SUPPORTED_ATS_TYPES).toEqual(["greenhouse", "lever", "ashby"]);
    expect(isSupportedAtsType("greenhouse")).toBe(true);
    expect(isSupportedAtsType("workday")).toBe(false);
  });
});
