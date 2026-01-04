import express from "express";
import type { Request, Response as ExResponse } from "express";
import { rewriteJs } from "./src/js.ts";
import { rewriteCss } from "./src/css.ts";
import { absolutify, isUrl } from "./src/utils.ts";
import { rewriteHtml } from "./src/html.ts";
import { Readable } from "stream";



import { paymentMiddleware } from "x402-express";


const payTo = "0xYourAddress";

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.use(express.text({ type: "*/*", limit: "50mb" }));


app.use(
	paymentMiddleware(
		payTo,
		{
			"GET /proxy": {
				price: "$1",
				network: "solana",
				config: {
					description: "Proxy access to any URL",
					mimeType: "text/html",
				}
			},
		}
	),
);

function fixHeaders(req: Request): Record<string, string> {
	const headers: Record<string, string> = {};

	Object.entries(req.headers).forEach(([key, value]) => {
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
			if (value) headers[key] = Array.isArray(value) ? value.join(", ") : value;
		}
	});

	headers["user-agent"] =
		headers["user-agent"] ||
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
	headers["accept"] =
		headers["accept"] ||
		"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
	headers["accept-language"] = headers["accept-language"] || "en-US,en;q=0.9";
	headers["accept-encoding"] =
		headers["accept-encoding"] || "gzip, deflate, br";

	return headers;
}

function copyHeaders(upstreamHeaders: Headers, res: ExResponse) {
	upstreamHeaders.forEach((value, key) => {
		const lowerKey = key.toLowerCase();
		if (
			![
				"transfer-encoding",
				"content-encoding",
				"content-security-policy",
				"x-content-security-policy",
				"content-security-policy-report-only",
				"x-webkit-csp",
			].includes(lowerKey)
		) {
			res.setHeader(key, value);
		}
	});
}

/* -------------------------------------------------------------------------- */
/*                                    SERVER                                  */
/* -------------------------------------------------------------------------- */

app.use(express.static("public"));

app.all("/proxy", async (req: Request, res: ExResponse) => {
	const target = req.query.q as string;

	if (!target) {
		return res.status(400).send("Missing 'q' query parameter");
	}

	const finalUrl = isUrl(target)
		? target
		: isUrl("http://" + target)
			? "http://" + target
			: null;

	if (!finalUrl) {
		return res.status(400).send("Invalid or blocked URL");
	}

	/* ----------------------------- Fetch upstream ---------------------------- */

	let currentUrl = finalUrl;
	let host = new URL(currentUrl).hostname;

	const options: RequestInit = {
		method: req.method,
		headers: fixHeaders(req),
	};

	if (!["GET", "HEAD"].includes(req.method)) {
		options.body = req.body;
	}

	let upstream: Response;
	let redirects = 0;
	const maxRedirects = 10;

	while (true) {
		upstream = await fetch(currentUrl, { ...options, redirect: "manual" });

		if (
			upstream.status >= 300 &&
			upstream.status < 400 &&
			redirects < maxRedirects
		) {
			const loc = upstream.headers.get("location");
			if (loc) {
				currentUrl = absolutify(loc, currentUrl);
				redirects++;
				continue;
			}
		}
		break;
	}

	/* ---------------------------- Handle content ---------------------------- */
	const ct = upstream.headers.get("content-type") || "";
	const sfd = (req.headers["sec-fetch-dest"] as string) || "";

	copyHeaders(upstream.headers, res);
	res.status(upstream.status);

	// HTML
	if (ct.includes("text/html")) {
		const raw = await upstream.text();
		const rewritten = await rewriteHtml(raw, finalUrl, host);
		return res.send(rewritten);
	}

	// CSS
	if (sfd.includes("style") || ct.includes("text/css")) {
		const raw = await upstream.text();
		const rewritten = rewriteCss(raw, currentUrl);
		res.setHeader("Content-Type", "text/css");
		return res.send(rewritten);
	}

	// JS
	if (sfd.includes("script") || ct.includes("javascript")) {
		const raw = await upstream.text();
		const rewritten = rewriteJs(raw, currentUrl, host);
		res.setHeader("Content-Type", "application/javascript");
		return res.send(rewritten);
	}

	if (upstream.body) {
		const stream = Readable.fromWeb(upstream.body as any);
		stream.pipe(res);
	} else {
		res.end();
	}
});

app.listen(PORT, () => {
	console.log(`Proxy running on port ${PORT}`);
});
