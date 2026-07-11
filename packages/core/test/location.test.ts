import { describe, expect, it } from "vite-plus/test";
import { classifyLocation } from "../src/index";

describe("classifyLocation", () => {
  it.each([
    ["Remote - US or Canada", "remote", ["ca", "us"]],
    ["Hybrid - London, UK", "hybrid", ["gb"]],
    ["New York, NY (On-site)", "onsite", ["us"]],
    ["Cape Town, South Africa", "unknown", ["za"]],
    ["Remote - EMEA", "remote", ["emea"]],
  ] as const)("classifies %s", (label, remoteScope, regions) => {
    expect(classifyLocation(label)).toEqual({ rawLabel: label, remoteScope, regions });
  });
});
