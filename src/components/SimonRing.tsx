import { cn } from "@/lib/utils";

/** The four-colour Simon ring — the app's fixed brand mark (never themed). */
export function SimonRing({
  size = 38,
  className,
  spin = false,
}: {
  size?: number;
  className?: string;
  spin?: boolean;
}) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const gap = c * 0.05;
  const arc = c / 4 - gap;
  const colors = [
    "var(--simon-green)",
    "var(--simon-red)",
    "var(--simon-yellow)",
    "var(--simon-blue)",
  ];
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("shrink-0", spin && "animate-spin", className)}
      style={{ display: "block" }}
      aria-hidden="true"
    >
      {colors.map((col, i) => (
        <circle
          key={i}
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={col}
          strokeWidth="16"
          strokeDasharray={`${arc} ${c - arc}`}
          transform={`rotate(${-90 + i * 90 + (gap / c) * 180} 50 50)`}
        />
      ))}
    </svg>
  );
}
