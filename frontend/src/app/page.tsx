"use client";

import { useState, FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Required for BetterAuth redirects
  const callbackURL =
    typeof window !== "undefined"
      ? `${window.location.origin}/dashboard`
      : "/dashboard";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "register") {
        await authClient.signUp.email({
          email,
          password,
          name,
          callbackURL,
        });
      } else {
        await authClient.signIn.email({
          email,
          password,
          callbackURL,
        });
      }
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("Something went wrong");
    }

    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-white text-black dark:bg-black dark:text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md p-10 bg-white dark:bg-neutral-900 rounded-3xl shadow-[0_2px_25px_rgba(0,0,0,0.06)] dark:shadow-[0_0_25px_rgba(255,255,255,0.06)] transition">

        {/* Logo / Title */}
        <h1 className="text-3xl font-semibold tracking-tight text-center mb-8">
          {mode === "login" ? "Welcome Back" : "Create Your Account"}
        </h1>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === "register" && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Name</label>
              <input
                type="text"
                value={name}
                required
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white transition"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              required
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white transition"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              value={password}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white transition"
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm font-medium pt-1">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 mt-2 text-lg font-medium rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Sign In"
              : "Create Account"}
          </button>
        </form>

        {/* Switch Mode */}
        <p className="text-center text-sm mt-6 text-neutral-600 dark:text-neutral-400">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => setMode("register")}
                className="underline font-medium"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
                className="underline font-medium"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
