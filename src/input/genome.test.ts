import { describe, expect, it } from "vitest";
import { mapFeaturesToGenome, particleCountForFeatures } from "./genome";
import { extractTextFeatures } from "./textFeatures";

describe("mapFeaturesToGenome", () => {
  it("is deterministic for the same input", () => {
    const features = extractTextFeatures("研究研究研究");

    expect(mapFeaturesToGenome(features)).toEqual(mapFeaturesToGenome(features));
  });

  it("normalizes every genome value into 0..1", () => {
    const genome = mapFeaturesToGenome(extractTextFeatures("!!!😀😀😀123研究研究"));

    for (const value of Object.values(genome)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("maps exclamation marks to stronger energy and turbulence", () => {
    const calm = mapFeaturesToGenome(extractTextFeatures("ねむい"));
    const burst = mapFeaturesToGenome(extractTextFeatures("!!!"));

    expect(burst.energy).toBeGreaterThan(calm.energy);
    expect(burst.turbulence).toBeGreaterThan(calm.turbulence);
  });

  it("maps ellipsis to lower energy and higher viscosity", () => {
    const neutral = mapFeaturesToGenome(extractTextFeatures("ことば"));
    const sinking = mapFeaturesToGenome(extractTextFeatures("……"));

    expect(sinking.energy).toBeLessThan(neutral.energy);
    expect(sinking.viscosity).toBeGreaterThan(neutral.viscosity);
  });

  it("maps repeated text to higher fertility and chirp rate", () => {
    const simple = mapFeaturesToGenome(extractTextFeatures("研究"));
    const repeated = mapFeaturesToGenome(extractTextFeatures("研究研究研究"));

    expect(repeated.fertility).toBeGreaterThan(simple.fertility);
    expect(repeated.chirpRate).toBeGreaterThan(simple.chirpRate);
  });

  it("uses the required particle count formula", () => {
    const short = particleCountForFeatures(extractTextFeatures("あ"));
    const repeated = particleCountForFeatures(extractTextFeatures("wwwwww"));

    expect(short).toBeGreaterThanOrEqual(24);
    expect(repeated).toBeGreaterThan(short);
  });
});
