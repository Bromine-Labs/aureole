import { rewriteJs } from "./src/js.ts";
import { rewriteCss } from "./src/css.ts";
import { absolutify, isUrl } from "./src/utils.ts";
import { rewriteHtml } from "./src/html.ts";

import { serveStatic } from 'hono/bun'


const PORT = Number(process.env.PORT || 8080);

/* -------------------------------------------------------------------------- */
/*                                UTILITIES                                   */
/* -------------------------------------------------------------------------- */
function fixHeaders(req: Request): Record<string, string> {
	const headers: Record<string, string> = {};

	req.headers.forEach((value, key) => {
		const lowerKey = key.toLowerCase();
		if (
			![
				"host",
				"transfer-encoding",
				"content-encoding",
				"content-security-policy",
				"x-content-security-policy",
				"x-webkit-csp",
				"origin",
				"referer",
			].includes(lowerKey)
		) {
			headers[key] = value;
		}
	});

	if (!headers["user-agent"]) {
		headers["user-agent"] =
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
	}
	if (!headers["accept"]) {
		headers["accept"] =
			"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
	}
	if (!headers["accept-language"]) {
		headers["accept-language"] = "en-US,en;q=0.9";
	}
	if (!headers["accept-encoding"]) {
		headers["accept-encoding"] = "gzip, deflate, br";
	}

	return headers;
}

function removeCsp(upstream: Response): Headers {
	const headers = new Headers();
	upstream.headers.forEach((value, key) => {
		if (
			![
				"transfer-encoding",
				"content-encoding",
				"content-security-policy",
				"x-content-security-policy",
				"content-security-policy-report-only",
				"x-webkit-csp",
			].includes(key.toLowerCase())
		) {
			headers.set(key, value);
		}
	});
	return headers;
}

/* -------------------------------------------------------------------------- */
/*                                    SERVER                                  */
/* -------------------------------------------------------------------------- */

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname !== "/proxy") {
			const publicPath = url.pathname === "/" ? "/index.html" : url.pathname;
			const file = Bun.file("./public" + publicPath);

			if (await file.exists()) return new Response(file);

			return new Response("Not found", { status: 404 });
		}

		const target = url.searchParams.get("q");
		if (!target) {
			return new Response("Missing 'q' query parameter", { status: 400 });
		}

		const finalUrl = isUrl(target)
			? target
			: isUrl("http://" + target)
				? "http://" + target
				: null;

		if (!finalUrl) {
			return new Response("Invalid or blocked URL", { status: 400 });
		}

		/* ----------------------------- Fetch upstream ---------------------------- */

		let upstream: Response = new Response("Internal Server Error", {
			status: 500,
		});
		let currentUrl = finalUrl;
		let host = new URL(currentUrl).hostname;

		const options: RequestInit = {
			method: req.method,
			mode: (req.headers.get("Sec-Fetch-Mode") as RequestMode) || "cors",
			headers: fixHeaders(req),
		};

		if (!["GET", "HEAD"].includes(req.method)) {
			options.body = await req.text();
		}

		let redirects = 0;
		const maxRedirects = 10;

		while (redirects < maxRedirects) {
			upstream = await fetch(currentUrl, { ...options, redirect: "manual" });

			if (upstream.status < 300 || upstream.status >= 400) break;

			const loc = upstream.headers.get("location");
			if (!loc) break;

			currentUrl = absolutify(loc, currentUrl);
			redirects++;
		}

		/* ---------------------------- Handle content ---------------------------- */


		const ct = upstream.headers.get("content-type") || "";
		const sfd = req.headers.get("Sec-Fetch-Dest") || "";
		const headers = removeCsp(upstream);

		// HTML
		if (ct.includes("text/html")) {
			const raw = await upstream.text();
			let rewritten = await rewriteHtml(raw, finalUrl, host);

			return new Response(rewritten, { status: upstream.status, headers });
		}

		// CSS
		if (sfd.includes("style")) {
			const raw = await upstream.text();
			const rewritten = rewriteCss(raw, currentUrl);
			headers.set("Content-Type", "text/css");
			return new Response(rewritten, { status: upstream.status, headers });
		}

		// JS
		if (sfd.includes("script")) {
			const raw = await upstream.text();
			let rewritten = rewriteJs(raw, currentUrl, host);
			headers.set("Content-Type", "application/javascript");
			return new Response(rewritten, {
				status: upstream.status,
				headers,
			});
		}

		// Stream everything else
		return new Response(upstream.body, {
			status: upstream.status,
			headers,
		});
	},
});

console.log("Proxy running on port", PORT);
