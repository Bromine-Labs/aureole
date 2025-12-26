import { parse } from 'meriyah';
import { walk } from 'zimmerframe';
import { absolutify, proxify } from "./utils.ts"
import * as recast from 'recast';


export function rewriteJs(js: string, baseUrl: string, host: string): string {
	const ast = recast.parse(js, {
		parser: {
			parse: (code) => parse(code, { module: true, preserveParens: false })
		}
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
				node.property.name = 'proxyLocation';
			}

			// location -> proxyLocation
			if (node.object.type === 'Identifier' && node.object.name === 'location' && !node.computed) {
				node.object.name = 'proxyLocation';
			}

			next();
		},

		// import(...) -> proxyImport(...)
		ImportExpression(node: any, { next }) {
			node.type = 'CallExpression';
			node.callee = {
				type: 'Identifier',
				name: 'proxyImport'
			};
			node.arguments = [node.source];
			delete node.source;
			const arg = node.arguments[0];
			if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
				arg.value = proxify(arg.value);
				arg.raw = `'${arg.value}'`;
			}
			next()
		},

		// fetch("..."), importScripts("...")
		CallExpression(node: any, { next }) {
			if (node.callee.type === 'Identifier' && funcNames.includes(node.callee.name)) {
				node.arguments.forEach((arg: any) => {
					if (arg.type === 'Literal' && typeof arg.value === 'string') {
						arg.value = proxify(arg.value);
						arg.raw = `'${arg.value}'`;
					}
				});
			}
							// navigator.sendBeacon("...")
							if (node.callee.type === 'MemberExpression' &&
								node.callee.object.type === 'Identifier' && node.callee.object.name === 'navigator' &&
								node.callee.property.type === 'Identifier' && node.callee.property.name === 'sendBeacon') {
								const arg = node.arguments[0];
								if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
									arg.value = proxify(arg.value);
									arg.raw = `'${arg.value}'`;
								}
							}			next()
		},

		// Constructor Calls: new Worker("..."), new URL("...")
		NewExpression(node: any, { next }) {
			if (node.callee.type === 'Identifier' && classNames.includes(node.callee.name)) {
				const arg = node.arguments[0];
				if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
					arg.value = proxify(arg.value);
					arg.raw = `'${arg.value}'`;
				}
			}
			next()
		},

		// Imports/Exports: import {x} from "..."
		'ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration'(node: any, { next }) {
			if (node.source && node.source.type === 'Literal' && typeof node.source.value === 'string') {
				node.source.value = proxify(node.source.value);
				node.source.raw = `'${node.source.value}'`;
			}
			next();
		},

		// proxify baseurl
		Literal(node: any, { next }) {
			if (node.value === baseUrl) {
				node.value = proxify(baseUrl);
				node.raw = `'${node.value}'`;
			}
			next();
		}

	});

	return recast.print(ast).code;
}
