import { describe, expect, it } from "vitest";
import { extractTextFeatures } from "./textFeatures";

describe("extractTextFeatures", () => {
  it("counts Unicode code points without splitting surrogate pairs", () => {
    const features = extractTextFeatures("あ😀b");

    expect(features.length).toBe(3);
    expect(features.emojiRatio).toBeCloseTo(1 / 3);
    expect(features.hiraganaRatio).toBeCloseTo(1 / 3);
    expect(features.latinRatio).toBeCloseTo(1 / 3);
  });

  it("detects adjacent repetition and repeated short patterns", () => {
    const shout = extractTextFeatures("うわあああああ");
    const study = extractTextFeatures("研究研究研究");

    expect(shout.repeatRatio).toBeGreaterThan(0.4);
    expect(study.repeatRatio).toBeGreaterThan(0.5);
    expect(study.kanjiRatio).toBe(1);
  });

  it("counts punctuation cues used by the genome mapper", () => {
    const features = extractTextFeatures("!!!???……...");

    expect(features.exclamationCount).toBe(3);
    expect(features.questionCount).toBe(3);
    expect(features.ellipsisCount).toBe(3);
    expect(features.punctuationRatio).toBe(1);
  });

  it("recognizes mixed scripts, whitespace, and newlines", () => {
    const features = extractTextFeatures("ねむい ABC 123\nカナ");

    expect(features.hiraganaRatio).toBeGreaterThan(0);
    expect(features.katakanaRatio).toBeGreaterThan(0);
    expect(features.latinRatio).toBeGreaterThan(0);
    expect(features.digitRatio).toBeGreaterThan(0);
    expect(features.whitespaceRatio).toBeGreaterThan(0);
    expect(features.newlineCount).toBe(1);
  });

  it("returns stable zero values for empty input", () => {
    const features = extractTextFeatures("");

    expect(features.length).toBe(0);
    expect(features.repeatRatio).toBe(0);
    expect(features.rhythmVariance).toBe(0);
  });
});
