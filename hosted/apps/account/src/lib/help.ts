export const HELP_SITE = "https://trainstackhq.com/help";

export const helpTopics = [
  "getting-started",
  "add-activities",
  "fix-activities",
  "thresholds-and-zones",
  "activity-analysis",
  "fitness-and-form",
  "plan-your-week",
  "compliance",
  "workouts",
  "calendar-feed",
  "check-in",
  "strength-and-bouldering",
  "your-data",
] as const;

export type HelpTopic = (typeof helpTopics)[number];

export const helpUrl = (topic: HelpTopic) => `${HELP_SITE}/${topic}`;
