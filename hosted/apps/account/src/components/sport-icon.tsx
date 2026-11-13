import type { SportFamily } from "../lib/sports";

const paths: Record<SportFamily, string> = {
  ride: "M5.5 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm13 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5.5 14l4-6.5h5.5l3.5 6.5M9.5 7.5 12 14h-6.5M8 5h3",
  run: "M14.5 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM7 21l3-5.5 3 2.5v4.5M6 11.5l2.5-3.5 4.5-.5 3 4 3 1M10 15.5l3-7",
  swim: "M2.5 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5M7 13.5l4.5-4-2.5-3 4.5-1.5M17 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM11.5 9.5l4 4",
  strength: "M3 9.5v5M6 7v10M18 7v10M21 9.5v5M6 12h12",
  climb: "M2.5 19.5 9 8l3.5 5.5L15 10l6.5 9.5Z",
  other: "M3 12h4l2.5-6 5 12 2.5-6H21",
};

export function SportIcon({ family }: { family: SportFamily }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[family]} />
    </svg>
  );
}
