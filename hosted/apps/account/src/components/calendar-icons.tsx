const shapes = {
  previous: "M10 3 5 8l5 5",
  next: "M6 3l5 5-5 5",
  plus: "M8 3v10M3 8h10",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  done: "M3.5 8.5 6.5 11.5 12.5 4.5",
  skipped: "M4 4l8 8M12 4l-8 8",
  missed: "M8 4.5v4M8 11.5h.01",
  note: "M4 3h8v10H4zM6 6h4M6 8.5h4",
  rest: "M11.5 10.5A5 5 0 0 1 6 3.5a5 5 0 1 0 5.5 7Z",
  moving: "M8 2v12M2 8h12M8 2 6 4M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2",
} as const;

export type CalendarIconName = keyof typeof shapes;

export function CalendarIcon({ name, size = 14 }: { name: CalendarIconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 2.6 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={shapes[name]} />
    </svg>
  );
}
