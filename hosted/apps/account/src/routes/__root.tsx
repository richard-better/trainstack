import { QueryClientProvider } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { queryClient } from "../api";
import analysisStyles from "../styles/analysis.css?url";
import styles from "../styles/app.css?url";
import routeStyles from "../styles/route.css?url";
import calendarStyles from "../styles/calendar.css?url";
import checkInStyles from "../styles/check-in.css?url";
import trainingStyles from "../styles/training.css?url";
import logbookStyles from "../styles/logbook.css?url";
import workoutStyles from "../styles/workouts.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "dark" },
      { title: "Trainstack" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
      },
      { rel: "stylesheet", href: styles },
      { rel: "stylesheet", href: workoutStyles },
      { rel: "stylesheet", href: analysisStyles },
      { rel: "stylesheet", href: trainingStyles },
      { rel: "stylesheet", href: routeStyles },
      { rel: "stylesheet", href: calendarStyles },
      { rel: "stylesheet", href: checkInStyles },
      { rel: "stylesheet", href: logbookStyles },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  component: () => (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  ),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
