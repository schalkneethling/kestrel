import type { LocationClassification, RemoteScope } from "./domain";

const REGION_PATTERNS: readonly [string, RegExp][] = [
  ["us", /\b(?:us|usa|united states|new york|ny|san francisco|california|ca|texas|tx)\b/i],
  ["ca", /\b(?:canada|canadian|toronto|vancouver)\b/i],
  ["gb", /\b(?:uk|united kingdom|london|england|scotland)\b/i],
  ["za", /\b(?:south africa|cape town|johannesburg)\b/i],
  ["emea", /\bemea\b/i],
  ["eu", /\b(?:eu|europe|european union)\b/i],
  ["apac", /\bapac\b/i],
];

export function classifyLocation(rawLabel: string): LocationClassification {
  let remoteScope: RemoteScope = "unknown";
  if (/\b(?:hybrid|flexible)\b/i.test(rawLabel)) remoteScope = "hybrid";
  else if (/\b(?:remote|distributed|work from home|wfh)\b/i.test(rawLabel)) remoteScope = "remote";
  else if (/\b(?:on[ -]?site|in[ -]?office|office based)\b/i.test(rawLabel)) remoteScope = "onsite";
  const regions = REGION_PATTERNS.filter(([, pattern]) => pattern.test(rawLabel))
    .map(([region]) => region)
    .sort();
  return { rawLabel, remoteScope, regions: [...new Set(regions)] };
}
