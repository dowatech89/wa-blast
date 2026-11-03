import { useEffect, useState } from "react";
import { Icon } from "./icons";

const EVENT = "wablast-toast";
const SHOW_MS = 2600;

/** Short "it worked" confirmation at the bottom of the screen. Errors stay inline, next to what failed. */
export function toast(text: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }));
}

export function Toaster() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const show = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = window.setTimeout(() => setText(null), SHOW_MS);
    };
    window.addEventListener(EVENT, show);
    return () => {
      window.removeEventListener(EVENT, show);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {text && (
        <p className="toast">
          <Icon name="siap" />
          {text}
        </p>
      )}
    </div>
  );
}
