/** Returns time-based greeting: Selamat pagi, siang, sore, or malam */
export function getGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "Selamat pagi";
  if (hour >= 11 && hour < 15) return "Selamat siang";
  if (hour >= 15 && hour < 18) return "Selamat sore";
  return "Selamat malam";
}

/** Message exactly as a customer receives it. Must match compose_caption in agent/wablast/worker.py. */
export function composeCaption(
  message: string,
  name: string | null,
  footer: string,
  outlet = "",
  date: Date = new Date()
): string {
  const greeting = getGreeting(date);
  const text = message
    .replaceAll("{nama}", name?.trim() || "Kak")
    .replaceAll("{outlet}", outlet.trim())
    .replaceAll("{salam}", greeting);
  return footer.trim() ? `${text}\n\n${footer.trim()}` : text;
}
