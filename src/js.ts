import { parse } from 'meriyah';
import { walk } from 'zimmerframe';
import { absolutify, proxify } from "./utils.ts"
import MagicString from 'magic-string';


export function rewriteJs(js: string, baseUrl: string, host: string): string {
	const s = new MagicString(js);

	const ast = parse(js, {
		sourceType: 'module',
		preserveParens: false,
	}) as any;


	const funcNames = ['fetch', 'importScripts', 'proxyImport'];
	const classNames = ['Request', 'URL', 'EventSource', 'Worker', 'SharedWorker'];

	walk(ast, null, {
		_(node, { next }) {
			next();
		},
		MemberExpression(node: any, { next }) {
			// window.location -> window.proxyLocation
			if (node.object.type === 'Identifier' && node.object.name === 'window' &&
				node.property.type === 'Identifier' && node.property.name === 'location') {
				s.overwrite(node.property.start, node.property.end, 'proxyLocation');
			}

			// location -> proxyLocation
			if (node.object.type === 'Identifier' && node.object.name === 'location' && !node.computed) {
				s.overwrite(node.object.start, node.object.end, 'proxyLocation');
			}

			next();
		},

		// import(...) -> proxyImport(...)
		ImportExpression(node: any, { next }) {
			s.overwrite(node.start, node.start + 6, 'proxyImport');
			if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
				s.overwrite(node.source.start + 1, node.source.end - 1, proxify(node.source.value));
			}
			next()
		},

		// fetch("..."), importScripts("...")
		CallExpression(node: any, { next }) {
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
			next()
		},

		// Constructor Calls: new Worker("..."), new URL("...")
		NewExpression(node: any, { next }) {
			if (node.callee.type === 'Identifier' && classNames.includes(node.callee.name)) {
				const arg = node.arguments[0];
				if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
					s.overwrite(arg.start + 1, arg.end - 1, proxify(arg.value));
				}
			}
			next()
		},

		// Imports/Exports: import {x} from "..."
		'ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration'(node: any, { next }) {
			if (node.source && node.source.type === 'Literal' && typeof node.source.value === 'string') {
				s.overwrite(node.source.start + 1, node.source.end - 1, proxify(node.source.value));
			}
			next();
		},

		// proxify baseurl
		Literal(node: any, { next }) {
			if (node.value === baseUrl) {
				s.overwrite(node.start + 1, node.end - 1, proxify(baseUrl));
			}
			next();
		}

	});

	return s.toString();
}
