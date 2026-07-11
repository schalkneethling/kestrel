import { describe, expect, it } from "vite-plus/test";
import { createSourceKey, createStableKey } from "../src/index";

describe("job identity", () => {
  it("identifies an observed provider posting", () => {
    expect(createSourceKey("company-acme", "greenhouse", "123/45")).toBe(
      "company-acme:greenhouse:123%2F45",
    );
  });

  it("matches the ADR equivalent stable-key vectors", () => {
    const first = createStableKey({
      companyId: "company-acme",
      title: "Senior Software Engineer",
      location: { remoteScope: "remote", regions: ["US", "ZA"], rawLabel: "Remote" },
      department: "Engineering",
      employmentType: "Full Time",
    });
    const second = createStableKey({
      companyId: "company-acme",
      title: "senior   software engineer",
      location: { remoteScope: "remote", regions: ["za", "us"], rawLabel: "Anywhere" },
      department: "engineering",
      employmentType: "full-time",
    });
    const expected =
      "v1|company=company-acme|title=senior%20software%20engineer|location=remote%3Aus%2Cza|department=engineering|employment=full%20time";
    expect(first).toBe(expected);
    expect(second).toBe(expected);
  });

  it("uses the raw location label and missing marker as specified by the ADR", () => {
    expect(
      createStableKey({
        companyId: "company-acme",
        title: "Senior Software Engineer",
        location: { remoteScope: "unknown", regions: [], rawLabel: "London" },
        employmentType: "Full Time",
      }),
    ).toBe(
      "v1|company=company-acme|title=senior%20software%20engineer|location=unknown%3Alondon|department=~|employment=full%20time",
    );
  });

  it("rejects jobs missing required identity input", () => {
    expect(
      createStableKey({
        companyId: "",
        title: "Engineer",
        location: { remoteScope: "unknown", regions: [], rawLabel: "" },
      }),
    ).toBeNull();
    expect(
      createStableKey({
        companyId: "acme",
        title: " ",
        location: { remoteScope: "unknown", regions: [], rawLabel: "" },
      }),
    ).toBeNull();
  });

  it("sorts conflicting candidates instead of silently choosing a provider value", () => {
    expect(
      createStableKey({
        companyId: "acme",
        title: ["Developer", "Engineer"],
        location: {
          remoteScope: ["remote", "hybrid"],
          regions: [],
          rawLabel: ["Worldwide", "Anywhere"],
        },
        department: ["Product", "Engineering"],
      }),
    ).toBe(
      "v1|company=acme|title=developer%2Cengineer|location=conflict%3Ahybrid%2Cremote%3Aanywhere%2Cworldwide|department=engineering%2Cproduct|employment=~",
    );
  });
});
