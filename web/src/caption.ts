/** Message exactly as a customer receives it. Must match compose_caption in agent/wablast/worker.py. */
export function composeCaption(message: string, name: string | null, footer: string, outlet = ""): string {
  const text = message.replaceAll("{nama}", name?.trim() || "Kak").replaceAll("{outlet}", outlet.trim());
  return footer.trim() ? `${text}\n\n${footer.trim()}` : text;
}
