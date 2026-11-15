import { httpRouter } from "convex/server";

import { httpAction } from "./_generated/server";

const http = httpRouter();

// Sign-in can only come back to a web address, and the phone app has none. So a phone
// sign-in comes back here, and this hands it on to the app through its own link scheme.
// What is passed on is a one-time code that only works together with a secret the app that
// started the sign-in is holding, so it is no use to anything else that catches the link.
http.route({
  path: "/auth/return",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, { status: 302, headers: { Location: `bounce://auth${new URL(request.url).search}` } });
  }),
});

export default http;
