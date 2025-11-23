
const PORT = Number(process.env.PORT || 8080);
const BASE = "https://html5.gamedistribution.com/";

Bun.serve({
	port: PORT,

	async fetch(req) {
		const url = new URL(req.url);

		// No path = instruction
		if (url.pathname === "/" || url.pathname === "") {
			return new Response("Usage: /<path to forward>\nExample: /games/game123/index.html", {
				status: 400,
			});
		}

		// Remove leading "/"
		const forwardPath = url.pathname.slice(1);

		// Construct target URL safely
		let target: URL;
		try {
			target = new URL(forwardPath, BASE);
		} catch {
			return new Response("Invalid target path.", { status: 400 });
		}

		// Clone headers but remove dangerous ones
		const headers = new Headers(req.headers);
		const hopByHop = [
			"host",
			"content-length",
			"transfer-encoding",
			"connection",
			"keep-alive",
			"proxy-authenticate",
			"proxy-authorization",
			"te",
			"trailer",
			"upgrade",
		];
		for (const h of hopByHop) headers.delete(h);

		// Copy request body only if necessary
		const body =
			req.method === "GET" || req.method === "HEAD"
				? undefined
				: await req.arrayBuffer();

		let upstream: Response;
		try {
			upstream = await fetch(target, {
				method: req.method,
				headers,
				body,
				redirect: "manual",
			});
		} catch (err) {
			return new Response("Upstream fetch failed: " + String(err), { status: 502 });
		}

		// Prepare outgoing headers
		const out = new Headers();
		upstream.headers.forEach((value, key) => {
			// Remove headers that break proxying
			const blocked = [
				"transfer-encoding",
				"content-encoding",
				"content-security-policy",
				"x-content-security-policy",
				"x-webkit-csp",
			];
			if (!blocked.includes(key.toLowerCase())) {
				out.set(key, value);
			}
		});

		// Optional: allow browser access (CORS)
		out.set("Access-Control-Allow-Origin", "*");

		// STREAM the upstream response (works for binary, images, WASM, etc.)
		return new Response(upstream.body, {
			status: upstream.status,
			headers: out,
		});
	},
});

console.log(`Proxy running on http://localhost:${PORT}`);

