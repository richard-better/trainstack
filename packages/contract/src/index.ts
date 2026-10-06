import { oc, type ContractRouterClient } from "@orpc/contract";
import { z } from "zod";

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const appContract = {
  healthCheck: oc.output(z.literal("OK")),
  privateData: oc.errors({ UNAUTHORIZED: {} }).output(
    z.object({
      message: z.literal("This is private"),
      user: userSchema,
    }),
  ),
};

export type AppContractClient = ContractRouterClient<typeof appContract>;
