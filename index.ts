import { Parser } from "htmlparser2";
import ipaddr from "ipaddr.js";
import { DomHandler, DomUtils } from "htmlparser2";
import serialize from "dom-serializer";

const PORT = Number(process.env.PORT || 8080);

/* -------------------------------------------------------------------------- */
/*                                UTILITIES                                   */
/* -------------------------------------------------------------------------- */


function isUrl(u: string): boolean {
	try {
		const parsed = new URL(u);

		if (!["http:", "https:"].includes(parsed.protocol)) return false;

		const hostname = parsed.hostname;

		if (ipaddr.isValid(hostname)) {
			const addr = ipaddr.parse(hostname);
			if (
				addr.range() === "private" ||
				addr.range() === "loopback" ||
				addr.range() === "linkLocal"
			) {
				return false;
			}
		} else {
			if (hostname === "localhost") return false;
		}

		return true;
	} catch {
		return false;
	}
}

function proxify(url: string): string {
	return url.match(/^(#|about:|data:|blob:|mailto:|javascript:|{|\*)/) || url.includes("/proxy") ? url : `/proxy?q=${encodeURIComponent(url)}`;
}

function absolutify(url: string, base: string) {
	try {
		return new URL(url).toString()
	} catch {
		try {
			return new URL(url, base).toString();
		} catch {
			return url
		}
	}
}



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
				"x-webkit-csp",
			].includes(key.toLowerCase())
		) {
			headers.set(key, value);
		}
	});
	return headers;
}

/* -------------------------------------------------------------------------- */
/*                                    CSS                                     */
/* -------------------------------------------------------------------------- */


function rewriteCss(css: string, baseUrl: string): string {
	// regex from vk6 (https://github.com/ading2210)
	const Atruleregex =
		/@import\s+(url\s*?\(.{0,9999}?\)|['"].{0,9999}?['"]|.{0,9999}?)($|\s|;)/gm;
	css = css.replace(Atruleregex, (match, importStatement) => {
		return match.replace(
			importStatement,
			importStatement.replace(
				/^(url\(['"]?|['"]|)(.+?)(['"]|['"]?\)|)$/gm,
				(match, firstQuote, url, endQuote) => {
					if (firstQuote.startsWith("url")) {
						return match;
					}
					const encodedUrl = proxify(url.trim())

					return `${firstQuote}${encodedUrl}${endQuote}`;
				}
			)
		);
	});


	const urlRegex = /url\(['"]?(.+?)['"]?\)/gm;
	css = new String(css).toString();
	css = css.replace(urlRegex, (match, url) => {
		const encodedUrl = proxify(url.trim())

		return match.replace(url, encodedUrl);
	});

	return css;
}

/* -------------------------------------------------------------------------- */
/*                                     JS                                     */
/* -------------------------------------------------------------------------- */
function getPatches() {
	return `
  const oldOpen = XMLHttpRequest.prototype.open;
  const proxy = "/proxy?q=";
  const oldFetch = window.fetch;

function absolutify(url) {
	try {
		return new URL(url, window.location.hostname).toString();
	} catch {
		return url;
	}
}

function proxify(url) {
	return url.match(/^(#|about:|data:|blob:|mailto:|javascript:|{|\\*)/) ? url : \`/proxy?q=\${encodeURIComponent(url)}\`;
}

  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    return oldOpen.call(this, method, proxify(url), async, user, password);
  };    

  window.proxyImport = (url) => {
return import(proxify(url))
}

  window.fetch = function(input, init) {
    if (input && typeof input === "object" && "url" in input) {
      const newReq = new Request(proxify(input.url), input);
      return oldFetch(newReq, init);
    }

	  // handle absolute urls
    let url = typeof input === "string" ? input : input.toString();
	  try {
	    new URL(url);
	  } catch(e) {
	    url = new URL(url, location.origin).href;
	  }
	  return oldFetch(proxify(url), init);
  };`
}

function rewriteJs(js: string, baseUrl: string, host: string): string {
	js = js.replaceAll(baseUrl, proxify(baseUrl));
	js = js.replaceAll("import(", "proxyImport(");

	return js;
}

/* -------------------------------------------------------------------------- */
/*                                    HTML                                    */
/* -------------------------------------------------------------------------- */

function rewriteHtml(html: string, baseUrl: string, host: string): Promise<string> {
	return new Promise((resolve) => {
		const handler = new DomHandler((err, dom) => {
			if (err) return resolve(html);

			const rewriteAttr = (name: string, attr: string) => {
				DomUtils.findAll(
					(el) => el.name === name && el.attribs?.[attr],
					dom,
				).forEach((el) => {
					el.attribs[attr] = proxify(absolutify(el.attribs[attr], baseUrl));
				});
			};

			rewriteAttr("script", "src");
			rewriteAttr("img", "src");
			rewriteAttr("video", "src");
			rewriteAttr("embed", "src");
			rewriteAttr("iframe", "src");
			rewriteAttr("audio", "src");
			rewriteAttr("input", "src");
			rewriteAttr("source", "src");
			rewriteAttr("track", "src");
			rewriteAttr("link", "href");
			rewriteAttr("a", "href");
			rewriteAttr("video", "poster");
			rewriteAttr("object", "data");
			rewriteAttr("area", "href");
			rewriteAttr("form", "action");

			DomUtils.findAll(
				(el) => el.name === "script" && !el.attribs?.src,
				dom,
			).forEach((el) => {
				const rewritten = rewriteJs(DomUtils.textContent(el), baseUrl, host);
				// Replace children with a single text node containing rewritten JS
				el.children = [
					{
						type: "text",
						data: rewritten,
						parent: el,
					},
				];
			});

			DomUtils.findAll(
				(el) => el.name === "style",
				dom,
			).forEach((el) => {
				const rewritten = rewriteCss(DomUtils.textContent(el), baseUrl);
				// Replace children with a single text node containing rewritten JS
				el.children = [
					{
						type: "text",
						data: rewritten,
						parent: el,
					},
				];
			});

			resolve(serialize(dom, { encodeEntities: false }));
		});

		const parser = new Parser(handler, { decodeEntities: true });
		parser.write(html);
		parser.end();
	});
}

/* -------------------------------------------------------------------------- */
/*                                    SERVER                                  */
/* -------------------------------------------------------------------------- */

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname !== "/proxy") {
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
		const headers = removeCsp(upstream);

		// HTML
		if (ct.includes("text/html")) {
			const raw = await upstream.text();
			let rewritten = await rewriteHtml(raw, finalUrl, host);
			if (rewritten.includes("</head>")) {
				rewritten = rewritten.replace(
					"</head>",
					`
<script>
${getPatches()}
</script>
			` + "</head>",
				);
			}
			return new Response(rewritten, { status: upstream.status, headers });
		}

		// CSS
		if (ct.includes("text/css") || currentUrl.endsWith(".css")) {
			const raw = await upstream.text();
			const rewritten = rewriteCss(raw, currentUrl);
			headers.set("Content-Type", "text/css");
			return new Response(rewritten, { status: upstream.status, headers });
		}

		// JS
		if (ct.includes("javascript") || currentUrl.endsWith(".js")) {
			const raw = await upstream.text();
			let rewritten = rewriteJs(raw, currentUrl, host);
			rewritten = getPatches() + rewritten
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
