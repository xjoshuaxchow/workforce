export function nextDeliveryStatus(
  current: string | null,
  incoming: string,
): string {
  const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
  if (incoming === "failed")
    return current && (rank[current] ?? 0) >= 2 ? current : "failed";
  if (incoming in rank) {
    if (current === "failed" && incoming === "sent") return current;
    return (rank[incoming] ?? 0) > (rank[current ?? ""] ?? 0)
      ? incoming
      : (current ?? incoming);
  }
  return current ?? incoming;
}
export function retryDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  return (
    Math.min(300000, 1000 * 2 ** Math.max(0, attempt - 1)) +
    Math.floor(random() * 1000)
  );
}
