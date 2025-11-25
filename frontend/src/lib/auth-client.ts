import { createAuthClient } from "better-auth/react" // make sure to import from better-auth/react

export const authClient =  createAuthClient({
    baseURL: "http://localhost:3000"
    //you can pass client configuration here
})
export const { signIn, signUp, useSession } = createAuthClient()