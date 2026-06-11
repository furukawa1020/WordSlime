export type TextSubmitHandler = (text: string) => void;
export type TextDraftHandler = (text: string) => void;

const MAX_INPUT_LENGTH = 280;
const RAPID_SUBMIT_WINDOW_MS = 1000;
const RAPID_SUBMIT_LIMIT = 5;

export type TextInputController = {
  destroy(): void;
};

export function attachTextInput(
  form: HTMLFormElement,
  textarea: HTMLTextAreaElement,
  onSubmit: TextSubmitHandler,
  onQueued: (count: number) => void,
  onDraft?: TextDraftHandler,
): TextInputController {
  let isComposing = false;
  let submitTimes: number[] = [];
  const queuedTexts: string[] = [];
  let queueTimer: number | undefined;

  const flushQueue = () => {
    const next = queuedTexts.shift();
    onQueued(queuedTexts.length);

    if (next) {
      onSubmit(next);
    }

    if (queuedTexts.length > 0) {
      queueTimer = window.setTimeout(flushQueue, 220);
    } else {
      queueTimer = undefined;
    }
  };

  const submitText = () => {
    const text = sanitizeInput(textarea.value);

    if (!text) {
      return;
    }

    textarea.value = "";
    autoSizeTextarea(textarea);
    onDraft?.("");

    const now = performance.now();
    submitTimes = submitTimes.filter(
      (time) => now - time <= RAPID_SUBMIT_WINDOW_MS,
    );
    submitTimes.push(now);

    if (submitTimes.length > RAPID_SUBMIT_LIMIT) {
      queuedTexts.push(text);
      onQueued(queuedTexts.length);

      if (queueTimer === undefined) {
        queueTimer = window.setTimeout(flushQueue, 220);
      }
      return;
    }

    onSubmit(text);
  };

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submitText();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      textarea.value = "";
      autoSizeTextarea(textarea);
      onDraft?.("");
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || isComposing) {
      return;
    }

    event.preventDefault();
    submitText();
  };

  const handleInput = () => {
    if (Array.from(textarea.value).length > MAX_INPUT_LENGTH) {
      textarea.value = Array.from(textarea.value)
        .slice(0, MAX_INPUT_LENGTH)
        .join("");
    }

    autoSizeTextarea(textarea);
    onDraft?.(textarea.value);
  };

  const handleCompositionStart = () => {
    isComposing = true;
  };

  const handleCompositionEnd = () => {
    isComposing = false;
  };

  form.addEventListener("submit", handleSubmit);
  textarea.addEventListener("keydown", handleKeyDown);
  textarea.addEventListener("input", handleInput);
  textarea.addEventListener("compositionstart", handleCompositionStart);
  textarea.addEventListener("compositionend", handleCompositionEnd);

  return {
    destroy() {
      form.removeEventListener("submit", handleSubmit);
      textarea.removeEventListener("keydown", handleKeyDown);
      textarea.removeEventListener("input", handleInput);
      textarea.removeEventListener("compositionstart", handleCompositionStart);
      textarea.removeEventListener("compositionend", handleCompositionEnd);

      if (queueTimer !== undefined) {
        window.clearTimeout(queueTimer);
      }
    },
  };
}

function sanitizeInput(input: string): string {
  const text = Array.from(input).slice(0, MAX_INPUT_LENGTH).join("");

  if (text.trim().length === 0) {
    return "";
  }

  return text;
}

function autoSizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
}
