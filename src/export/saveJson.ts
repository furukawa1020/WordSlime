import type { AppSettings } from "../app/settings";
import type { WordSeed } from "../app/state";

export type WordSlimeSaveData = {
  version: string;
  createdAt: string;
  seeds: WordSeed[];
  settings: AppSettings;
};

export function saveWordSlimeJson(data: {
  seeds: WordSeed[];
  settings: AppSettings;
}): string {
  const payload: WordSlimeSaveData = {
    version: "0.1.0",
    createdAt: new Date().toISOString(),
    seeds: data.seeds,
    settings: data.settings,
  };
  const filename = `wordslime_${formatTimestamp(new Date())}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);

  return filename;
}

function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear().toString();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
