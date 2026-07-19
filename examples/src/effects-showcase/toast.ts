import { TextComponent } from "@yagejs/renderer";

let toastText: TextComponent | undefined;
let toastTimer = 0;

/** Point showToast at the scene's in-canvas toast text. Called once from the scene. */
export function bindToast(text: TextComponent): void {
  toastText = text;
}

/** Flash a transient message, hidden again after 1.5s. */
export function showToast(msg: string): void {
  if (!toastText) return;
  toastText.setText(msg);
  toastText.visible = true;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastText) toastText.visible = false;
  }, 1500);
}
