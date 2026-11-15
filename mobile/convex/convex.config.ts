import { defineApp } from "convex/server";
import { v } from "convex/values";
import auth from "@convex-dev/auth/convex.config.js";
import authApple from "@convex-dev/auth/components/apple/convex.config.js";
import authGoogle from "@convex-dev/auth/components/google/convex.config.js";

// Every variable here has to exist on the deployment before it will deploy. A provider that
// is not set up yet is given the value "unset" (see README), and the app hides its button.
const app = defineApp({
  env: {
    AUTH_GOOGLE_CLIENT_ID: v.string(),
    AUTH_GOOGLE_CLIENT_SECRET: v.string(),
    AUTH_APPLE_CLIENT_ID: v.string(),
    AUTH_APPLE_TEAM_ID: v.string(),
    AUTH_APPLE_KEY_ID: v.string(),
    AUTH_APPLE_PRIVATE_KEY: v.string(),
  },
});

app.use(auth);

// The prefix decides the address each provider sends people back to:
// <CONVEX_SITE_URL>/oauth/google/callback and <CONVEX_SITE_URL>/oauth/apple/callback.
app.use(authGoogle, {
  httpPrefix: "/oauth/google",
  env: {
    CLIENT_ID: app.env.AUTH_GOOGLE_CLIENT_ID,
    CLIENT_SECRET: app.env.AUTH_GOOGLE_CLIENT_SECRET,
  },
});

app.use(authApple, {
  httpPrefix: "/oauth/apple",
  env: {
    CLIENT_ID: app.env.AUTH_APPLE_CLIENT_ID,
    TEAM_ID: app.env.AUTH_APPLE_TEAM_ID,
    KEY_ID: app.env.AUTH_APPLE_KEY_ID,
    PRIVATE_KEY: app.env.AUTH_APPLE_PRIVATE_KEY,
  },
});

export default app;
