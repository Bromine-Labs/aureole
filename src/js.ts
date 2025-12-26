import { parse } from 'meriyah';
import { walk } from 'zimmerframe';
import { isUrl, proxify } from "./utils.ts"
import MagicString from 'magic-string';

// function proxify(url: string | null | undefined, baseUrl: string): string {
// 	if (!url || typeof url !== 'string') return url || '';
// 	if (url.startsWith('/proxy?q=')) return url;
//
// 	if (/^(#|about:|data:|blob:|mailto:|javascript:|tel:|sms:|\{|\*)/.test(url)) return url;
//
// 	try {
// 		const absolute = new URL(url, baseUrl).href;
// 		return `/proxy?q=${encodeURIComponent(absolute)}`;
// 	} catch (e) {
// 		return url;
// 	}
// }

export function rewriteJs(js: string, baseUrl: string, host: string): string {
	const s = new MagicString(js);

	const ast = parse(js, {
		sourceType: 'module',
		preserveParens: false,
	}) as any;



	const funcNames = ['fetch', 'importScripts', 'proxyImport'];
	const classNames = ['Request', 'URL', 'EventSource', 'Worker', 'SharedWorker'];

	walk(ast as node, {}, (node: any) => {
		if (node.type === 'MemberExpression') {
			// window.location -> window.proxyLocation
			if (node.object.type === 'Identifier' && node.object.name === 'window' &&
				node.property.type === 'Identifier' && node.property.name === 'location') {
				s.overwrite(node.property.start, node.property.end, 'proxyLocation');
			}

			// location -> proxyLocation
			if (node.object.type === 'Identifier' && node.object.name === 'location' && !node.computed) {
				s.overwrite(node.object.start, node.object.end, 'proxyLocation');
			}
		}

		// import(...) -> proxyImport(...)
		if (node.type === 'ImportExpression') {
			s.overwrite(node.start, node.start + 6, 'proxyImport');
			if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
				s.overwrite(node.source.start + 1, node.source.end - 1, proxify(node.source.value));
			}
		}

		// fetch("..."), importScripts("...")
		if (node.type === 'CallExpression') {
			if (node.callee.type === 'Identifier' && funcNames.includes(node.callee.name)) {
				node.arguments.forEach((arg: any) => {
					if (arg.type === 'Literal' && typeof arg.value === 'string') {
						s.overwrite(arg.start + 1, arg.end - 1, proxify(arg.value));
					}
				});
			}
			// navigator.sendBeacon("...")
			if (node.callee.type === 'MemberExpression' &&
				node.callee.object.type === 'Identifier' && node.callee.object.name === 'navigator' &&
				node.callee.property.type === 'Identifier' && node.callee.property.name === 'sendBeacon') {
				const arg = node.arguments[0];
				if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
					s.overwrite(arg.start + 1, arg.end - 1, proxify(arg.value));
				}
			}
		}

		// Constructor Calls: new Worker("..."), new URL("...")
		if (node.type === 'NewExpression') {
			if (node.callee.type === 'Identifier' && classNames.includes(node.callee.name)) {
				const arg = node.arguments[0];
				if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
					s.overwrite(arg.start + 1, arg.end - 1, proxify(arg.value));
				}
			}
		}

		// Imports/Exports: import {x} from "..."
		if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
			if (node.source && node.source.type === 'Literal' && typeof node.source.value === 'string') {
				s.overwrite(node.source.start + 1, node.source.end - 1, proxify(node.source.value));
			}
		}

		// proxify baseurl
		if (node.type === 'Literal' && node.value === baseUrl) {
			s.overwrite(node.start + 1, node.end - 1, proxify(baseUrl));
		}

	});

	return s.toString();
}
