import { rewriteJs } from "./js.ts";
import { rewriteCss } from "./css.ts";
import { proxify, absolutify } from "./utils.ts";
import { getPatches } from "./patches.ts";

import { Parser } from "htmlparser2";
import { DomHandler, DomUtils } from "htmlparser2";
import serialize from "dom-serializer";

export function rewriteHtml(
	html: string,
	baseUrl: string,
	host: string,
): Promise<string> {
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

			//srcset
			DomUtils.findAll(
				(el) => el.attribs?.srcset,
				dom,
			).forEach((el) => {
				const parts = el.attribs.srcset.split(/,\s+/);

				const rewritten = parts.map((part) => {
					const partpart = part.trim().split(/\s+/);

					if (partpart.length === 0) return "";

					const url = partpart[0];
					const descriptor = partpart.slice(1).join(" "); // e.g., "1x" or "1000w"

					const newUrl = proxify(absolutify(url, baseUrl));

					return descriptor ? `${newUrl} ${descriptor}` : newUrl;
				});

				el.attribs.srcset = rewritten.filter(Boolean).join(", ");
			});

			DomUtils.findAll(
				(el) => el.attribs?.style,
				dom,
			).forEach((el) => {
				const rewritten = rewriteCss(el.attribs.style, baseUrl);
				el.attribs["style"] = rewritten;
			});

			DomUtils.findAll(
				(el) => el.name === "script" && !el.attribs?.src && el.attribs.type != "application/json" && el.attribs.type != "application/ld+json",
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

			DomUtils.findAll((el) => el.name === "style", dom).forEach((el) => {
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

			let rewritten = serialize(dom, { encodeEntities: false });
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
			resolve(rewritten);
		});

		const parser = new Parser(handler, { decodeEntities: true });
		parser.write(html);
		parser.end();
	});
}
