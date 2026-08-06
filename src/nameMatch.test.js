import { describe, it, expect } from "vitest";
import {
  normalizeName,
  tokenSim,
  findMatch,
  findPersonMatch,
  basisToClientType,
  dominantClientType,
  multiFolderMatchesFor,
  isInternalFolder,
} from "./nameMatch.js";

describe("findMatch", () => {
  it("exact match wins", () => {
    const m = findMatch("Aus3C", ["Aus3C", "Aus3C Cyber Battle"]);
    expect(m).toEqual({ name: "Aus3C", confidence: 1, method: "exact" });
  });

  it("substring match", () => {
    const m = findMatch("Aus3C Cyber Battle", ["Aus3C"]);
    expect(m).toEqual({ name: "Aus3C", confidence: 0.85, method: "substring" });
  });

  it("token-similarity match at or above threshold", () => {
    const m = findMatch("Wills Group", ["Wills and Co"]);
    expect(m).not.toBeNull();
    expect(m.method).toBe("tokens");
    expect(m.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("returns null below the token-similarity threshold", () => {
    const m = findMatch("Zephyr Nova", ["Wills and Co"]);
    expect(m).toBeNull();
  });

  it("a name that normalizes to empty string returns null, never matches the first candidate", () => {
    const m = findMatch("(No folder)", ["Wills and Co", "Toto and Co"]);
    expect(m).toBeNull();
  });

  it("returns null for null/empty inputs", () => {
    expect(findMatch(null, ["Wills and Co"])).toBeNull();
    expect(findMatch("", ["Wills and Co"])).toBeNull();
    expect(findMatch(undefined, ["Wills and Co"])).toBeNull();
  });
});

describe("tokenSim", () => {
  it("stopword filtering does not let unrelated names sharing only stopwords score highly", () => {
    // Documented example in nameMatch.js: "Wills and Co" vs "Toto and Co" only share
    // the stopwords "and"/"co", which are filtered out before comparison.
    const sim = tokenSim("Wills and Co", "Toto and Co");
    expect(sim).toBeLessThan(0.5);
  });

  it("a name that is entirely stopwords still matches itself", () => {
    expect(tokenSim("and the co", "and the co")).toBe(1);
  });

  it("identical strings score 1", () => {
    expect(tokenSim("Purple Giraffe", "Purple Giraffe")).toBe(1);
  });

  it("fully disjoint strings score 0", () => {
    expect(tokenSim("Purple Giraffe", "Zephyr Nova")).toBe(0);
  });
});

describe("basisToClientType", () => {
  it("maps each known basis string to its documented target", () => {
    expect(basisToClientType("MAP")).toBe("map");
    expect(basisToClientType("Package")).toBe("package");
    expect(basisToClientType("Strategy")).toBe("strategy");
    expect(basisToClientType("Quoted")).toBe("quoted");
    expect(basisToClientType("Project")).toBe("project");
    expect(basisToClientType("Ad hoc")).toBe("ad_hoc");
  });

  it("falls back to hourly for unrecognised or empty basis (current behavior)", () => {
    expect(basisToClientType("Hourly")).toBe("hourly");
    expect(basisToClientType("")).toBe("hourly");
    expect(basisToClientType(undefined)).toBe("hourly");
    expect(basisToClientType("Something Else")).toBe("hourly");
  });
});

describe("dominantClientType", () => {
  it("returns the uniform type for single-basis rows", () => {
    expect(dominantClientType([{ basis: "Package", agreed: 20 }])).toBe("package");
    expect(dominantClientType([{ basis: "Hourly", agreed: 10 }, { basis: "Hourly", agreed: 5 }])).toBe("hourly");
  });

  it("a Combined multi-row group: the larger-agreed-hours fixed-basis row wins", () => {
    const rows = [
      { basis: "Package", agreed: 10 },
      { basis: "Project", agreed: 30 },
    ];
    expect(dominantClientType(rows)).toBe("project");
  });

  it("all-variable-basis rows fall back to hourly", () => {
    const rows = [
      { basis: "Hourly", agreed: 10 },
      { basis: "Ad hoc", agreed: 5 },
    ];
    expect(dominantClientType(rows)).toBe("hourly");
  });
});

describe("multiFolderMatchesFor", () => {
  it("matches all prefixed folders for a multi-folder client (Aus3C)", () => {
    const folders = [
      "Aus3C Cyber Battle",
      "Aus3C IRAP",
      "Unrelated Folder",
    ];
    const matches = multiFolderMatchesFor("Aus3C", folders);
    expect(matches).toEqual(["Aus3C Cyber Battle", "Aus3C IRAP"]);
  });

  it("returns null for a non-multi-folder name", () => {
    expect(multiFolderMatchesFor("Purple Giraffe", ["Purple Giraffe", "Aus3C Cyber Battle"])).toBeNull();
  });
});

describe("isInternalFolder", () => {
  it("matches each internal keyword case-insensitively as a substring", () => {
    expect(isInternalFolder("Julia Onboarding & Induction")).toBe(true);
    expect(isInternalFolder("ONBOARDING")).toBe(true);
    expect(isInternalFolder("Offboarding Checklist")).toBe(true);
    expect(isInternalFolder("Handover Notes")).toBe(true);
    expect(isInternalFolder("WIP Tracker")).toBe(true);
  });

  it("confirms the explicitly-called-out non-match: Purple Giraffe is not internal", () => {
    expect(isInternalFolder("Purple Giraffe")).toBe(false);
  });

  it("returns false for empty/null input", () => {
    expect(isInternalFolder("")).toBe(false);
    expect(isInternalFolder(null)).toBe(false);
    expect(isInternalFolder(undefined)).toBe(false);
  });
});

describe("findPersonMatch", () => {
  const people = [
    { name: "Jane Smith", alias: "" },
    { name: "Bob Jones", alias: "bobbyj" },
  ];

  it("matches by primary name", () => {
    const m = findPersonMatch("Jane Smith", people);
    expect(m).toEqual(people[0]);
  });

  it("matches by alias when the name doesn't fuzzy-match", () => {
    const m = findPersonMatch("bobbyj", people);
    expect(m).toEqual(people[1]);
  });

  it("first-wins behavior on alias/name collision matches current code", () => {
    // Two people where one's alias equals another's name: the owner map keeps
    // whichever candidate key was registered first, per current findPersonMatch code.
    const collidingPeople = [
      { name: "Alex Brown", alias: "" },
      { name: "Chris Lee", alias: "Alex Brown" },
    ];
    const m = findPersonMatch("Alex Brown", collidingPeople);
    expect(m).toEqual(collidingPeople[0]);
  });
});
