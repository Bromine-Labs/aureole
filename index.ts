
import express, { Request, Response } from "express";
import * as htmlparser2 from "htmlparser2";
import { DomHandler, DomUtils } from "htmlparser2";
import serialize from "dom-serializer";

const PORT = parseInt(process.env.PORT || "8080", 10);
const app = express();

app.get("/proxy", async (req: Request, res: Response) => {
	try {
		const path = req.query.q as string;
		if (!path) return res.status(400).send("Missing 'q' query parameter");

		const url = path.startsWith("http://") || path.startsWith("https://")
			? path
			: `http://${path}`;

		const upstream = await fetch(url);

		// Set headers, except encoding/transfer
		upstream.headers.forEach((value, key) => {
			if (!["transfer-encoding", "content-encoding"].includes(key.toLowerCase())) {
				res.setHeader(key, value);
			}
		});

		res.status(upstream.status);

		const type = upstream.headers.get("Content-Type") || "";
		const body = await upstream.text();

		if (type.includes("html")) {
			const handler = new DomHandler((error, dom) => {
				if (error) {
					console.error("DOM parsing error:", error);
					res.send(body);
					return;
				}

				// Rewrite <script src="">
				DomUtils.findAll(
					(elem) => elem.type === "script" && elem.attribs?.src,
					dom
				).forEach((script) => {
					const src = script.attribs.src;
					if (!src) return;
					try {
						const absoluteUrl = new URL(src, url).toString();
						script.attribs.src = `/proxy?q=${encodeURIComponent(absoluteUrl)}`;
					} catch {}
				});

				// Rewrite <link rel="stylesheet" href="">
				DomUtils.findAll(
					(elem) =>
						elem.type === "tag" &&
						elem.name === "link" &&
						elem.attribs?.rel?.toLowerCase() === "stylesheet" &&
						elem.attribs.href,
					dom
				).forEach((link) => {
					const href = link.attribs.href;
					if (!href) return;
					try {
						const absoluteUrl = new URL(href, url).toString();
						link.attribs.href = `/proxy?q=${encodeURIComponent(absoluteUrl)}`;
					} catch {}
				});

				// Rewrite <img src="">
				DomUtils.findAll(
					(elem) => elem.type === "tag" && elem.name === "img" && elem.attribs?.src,
					dom
				).forEach((img) => {
					const src = img.attribs.src;
					if (!src) return;
					try {
						const absoluteUrl = new URL(src, url).toString();
						img.attribs.src = `/proxy?q=${encodeURIComponent(absoluteUrl)}`;
					} catch {}
				});

				res.send(serialize(dom, { encodeEntities: false }));
			});

			const parser = new htmlparser2.Parser(handler, { decodeEntities: true });
			parser.write(body);
			parser.end();
		} else {
			// If JS or CSS, set correct content type
			if (type.includes("javascript") || url.endsWith(".js")) {
				res.setHeader("Content-Type", "application/javascript");
			} else if (type.includes("css") || url.endsWith(".css")) {
				res.setHeader("Content-Type", "text/css");
			}

			res.send(body);
		}
	} catch (err) {
		console.error(err);
		res.status(500).send("Error fetching the URL");
	}
});

app.listen(PORT, () => {
	console.log(`Listening on http://localhost:${PORT}`);
});
