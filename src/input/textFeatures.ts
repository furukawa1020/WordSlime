export type TextFeatures = {
  length: number;
  uniqueCharRatio: number;
  repeatRatio: number;
  punctuationRatio: number;
  whitespaceRatio: number;
  emojiRatio: number;
  hiraganaRatio: number;
  katakanaRatio: number;
  kanjiRatio: number;
  latinRatio: number;
  digitRatio: number;
  exclamationCount: number;
  questionCount: number;
  ellipsisCount: number;
  newlineCount: number;
  averageCharCodeDelta: number;
  rhythmVariance: number;
};

const MAX_CODE_POINT = 0x10ffff;

const RE_PUNCTUATION = /\p{Punctuation}/u;
const RE_WHITESPACE = /\s/u;
const RE_EMOJI = /\p{Extended_Pictographic}/u;
const RE_HIRAGANA = /\p{Script=Hiragana}/u;
const RE_KATAKANA = /\p{Script=Katakana}/u;
const RE_KANJI = /\p{Script=Han}/u;
const RE_LATIN = /\p{Script=Latin}/u;
const RE_DIGIT = /\p{Decimal_Number}/u;
const RE_NEWLINE = /\r\n|\r|\n/g;

export function extractTextFeatures(text: string): TextFeatures {
  const chars = Array.from(text);
  const length = chars.length;

  if (length === 0) {
    return emptyFeatures();
  }

  const counts = chars.reduce(
    (acc, char) => {
      if (RE_PUNCTUATION.test(char)) acc.punctuation += 1;
      if (RE_WHITESPACE.test(char)) acc.whitespace += 1;
      if (RE_EMOJI.test(char)) acc.emoji += 1;
      if (RE_HIRAGANA.test(char)) acc.hiragana += 1;
      if (RE_KATAKANA.test(char)) acc.katakana += 1;
      if (RE_KANJI.test(char)) acc.kanji += 1;
      if (RE_LATIN.test(char)) acc.latin += 1;
      if (RE_DIGIT.test(char)) acc.digit += 1;
      if (char === "!" || char === "！") acc.exclamation += 1;
      if (char === "?" || char === "？") acc.question += 1;
      return acc;
    },
    {
      punctuation: 0,
      whitespace: 0,
      emoji: 0,
      hiragana: 0,
      katakana: 0,
      kanji: 0,
      latin: 0,
      digit: 0,
      exclamation: 0,
      question: 0,
    },
  );

  return {
    length,
    uniqueCharRatio: uniqueRatio(chars),
    repeatRatio: repeatRatio(chars),
    punctuationRatio: counts.punctuation / length,
    whitespaceRatio: counts.whitespace / length,
    emojiRatio: counts.emoji / length,
    hiraganaRatio: counts.hiragana / length,
    katakanaRatio: counts.katakana / length,
    kanjiRatio: counts.kanji / length,
    latinRatio: counts.latin / length,
    digitRatio: counts.digit / length,
    exclamationCount: counts.exclamation,
    questionCount: counts.question,
    ellipsisCount: ellipsisCount(text),
    newlineCount: (text.match(RE_NEWLINE) ?? []).length,
    averageCharCodeDelta: averageCharCodeDelta(chars),
    rhythmVariance: rhythmVariance(chars),
  };
}

function emptyFeatures(): TextFeatures {
  return {
    length: 0,
    uniqueCharRatio: 0,
    repeatRatio: 0,
    punctuationRatio: 0,
    whitespaceRatio: 0,
    emojiRatio: 0,
    hiraganaRatio: 0,
    katakanaRatio: 0,
    kanjiRatio: 0,
    latinRatio: 0,
    digitRatio: 0,
    exclamationCount: 0,
    questionCount: 0,
    ellipsisCount: 0,
    newlineCount: 0,
    averageCharCodeDelta: 0,
    rhythmVariance: 0,
  };
}

function uniqueRatio(chars: string[]): number {
  return clamp01(new Set(chars).size / chars.length);
}

function repeatRatio(chars: string[]): number {
  if (chars.length <= 1) {
    return 0;
  }

  const adjacentRepeats =
    chars.filter((char, index) => index > 0 && char === chars[index - 1]).length /
    (chars.length - 1);

  const duplicatePressure = 1 - uniqueRatio(chars);
  const patternRepeats = repeatedPatternRatio(chars);

  return clamp01(Math.max(adjacentRepeats, duplicatePressure, patternRepeats));
}

function repeatedPatternRatio(chars: string[]): number {
  const maxUnit = Math.floor(chars.length / 2);
  let best = 0;

  for (let unitSize = 1; unitSize <= maxUnit; unitSize += 1) {
    const unit = chars.slice(0, unitSize).join("");
    let matched = 0;

    for (let index = 0; index < chars.length; index += unitSize) {
      if (chars.slice(index, index + unitSize).join("") === unit) {
        matched += unitSize;
      } else {
        break;
      }
    }

    if (matched > unitSize) {
      best = Math.max(best, (matched - unitSize) / chars.length);
    }
  }

  return clamp01(best);
}

function ellipsisCount(text: string): number {
  const leaderCount = Array.from(text).filter((char) => char === "…").length;
  const periodRuns = text.match(/\.{3,}/g) ?? [];
  const periodEllipses = periodRuns.reduce(
    (total, run) => total + Math.floor(run.length / 3),
    0,
  );

  return leaderCount + periodEllipses;
}

function averageCharCodeDelta(chars: string[]): number {
  if (chars.length <= 1) {
    return 0;
  }

  let total = 0;

  for (let index = 1; index < chars.length; index += 1) {
    total += Math.abs(codePoint(chars[index]) - codePoint(chars[index - 1]));
  }

  return clamp01(total / (chars.length - 1) / MAX_CODE_POINT);
}

function rhythmVariance(chars: string[]): number {
  if (chars.length <= 1) {
    return 0;
  }

  const weights = chars.map(charRhythmWeight);
  const average = weights.reduce((sum, value) => sum + value, 0) / weights.length;
  const variance =
    weights.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    weights.length;

  return clamp01(variance / 6);
}

function charRhythmWeight(char: string): number {
  if (RE_WHITESPACE.test(char)) return 0;
  if (RE_HIRAGANA.test(char)) return 1;
  if (RE_KATAKANA.test(char)) return 1.8;
  if (RE_KANJI.test(char)) return 2.4;
  if (RE_LATIN.test(char)) return 2;
  if (RE_DIGIT.test(char)) return 2.8;
  if (RE_PUNCTUATION.test(char)) return 3.6;
  if (RE_EMOJI.test(char)) return 4.2;
  return 1.4;
}

function codePoint(char: string): number {
  return char.codePointAt(0) ?? 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
