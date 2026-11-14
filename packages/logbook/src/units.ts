import { z } from "zod";

export const KILOGRAMS_PER_POUND = 0.45359237;

export const massUnitSchema = z.enum(["kg", "lb"]);
export type MassUnit = z.infer<typeof massUnitSchema>;

export const MAX_MASS = 2000;

export const massSchema = z.object({
  value: z.number().finite().nonnegative().max(MAX_MASS),
  unit: massUnitSchema,
});
export type Mass = z.infer<typeof massSchema>;

export const kilogramsOf = ({ value, unit }: Mass) =>
  unit === "kg" ? value : value * KILOGRAMS_PER_POUND;

export const inUnit = (kilograms: number, unit: MassUnit) =>
  unit === "kg" ? kilograms : kilograms / KILOGRAMS_PER_POUND;
