import pino from "pino";
import { env } from "@trainstack/prehab-env/server";

export const logger = pino({ level: env.LOG_LEVEL });
