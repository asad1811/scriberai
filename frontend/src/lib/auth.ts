// src/lib/auth.ts

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

// Import the Prisma instance you created in prisma.ts
import prisma from "@/lib/prisma";

export const auth = betterAuth({
  baseURL: process.env.APP_URL!,        // Required
  secret: process.env.BETTER_AUTH_SECRET!, // Required

  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },
});
