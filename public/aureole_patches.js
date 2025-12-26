
if (!window.patched) {
	window.patched = true;

	[window, document].forEach(targetParent => {
		Object.defineProperty(targetParent, 'proxyLocation', {
			get: function() {
				return new Proxy({}, {
					get(_, prop) {
						const cleanUrlString = new URLSearchParams(window.location.search).get('q') || window.location.href;
						const cleanUrlObj = new URL(cleanUrlString);

						if (prop === 'href' || prop === 'toString' || prop === Symbol.toPrimitive) {
							return prop === 'href' ? cleanUrlObj.href : () => cleanUrlObj.href;
						}

						if (prop === 'assign' || prop === 'replace') {
							return (newAddr) => {
								const resolved = new URL(newAddr, cleanUrlObj.href).href;
								window.location[prop]('/proxy?q=' + encodeURIComponent(resolved));
							};
						}

						if (prop === 'reload') {
							return () => window.location.reload();
						}

						const val = cleanUrlObj[prop];
						return typeof val === 'function' ? val.bind(cleanUrlObj) : val;
					},

					set(_, prop, val) {
						const cleanUrlString = new URLSearchParams(window.location.search).get('q') || window.location.href;
						const cleanUrlObj = new URL(cleanUrlString);

						if (prop === 'href') {
							const resolved = new URL(val, cleanUrlObj.href).href;
							window.location.href = '/proxy?q=' + encodeURIComponent(resolved);
						} else if (prop in cleanUrlObj) {
							cleanUrlObj[prop] = val;
							window.location.href = '/proxy?q=' + encodeURIComponent(cleanUrlObj.href);
						}
						return true;
					}
				});
			},
			set: function(val) {
				const cleanUrlString = new URLSearchParams(window.location.search).get('q') || window.location.href;
				const resolved = new URL(val, cleanUrlString).href;
				window.location.href = '/proxy?q=' + encodeURIComponent(resolved);
			},
			configurable: true
		});
	});

	const oldOpen = XMLHttpRequest.prototype.open;
	const oldFetch = window.fetch;

	function proxify(url) {
		url = decodeURIComponent(url);
		const isExcluded = /^(#|about:|data:|blob:|mailto:|javascript:|\{|\*)/.test(url);
		const isProxied = url.includes("/proxy?q=");

		return isExcluded || isProxied
			? url
			: "/proxy?q=" + encodeURIComponent(url);
	}

	XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
		return oldOpen.call(this, method, proxify(url), async, user, password);
	};

	window.proxyImport = (url) => {
		return import(proxify(url));
	};

	window.fetch = function(input, init) {
		if (input && typeof input === "object" && "url" in input) {
			const newReq = new Request(proxify(input.url), input);
			return oldFetch(newReq, init);
		}

		let url = typeof input === "string" ? input : input.toString();
		try {
			new URL(url);
		} catch (e) {
			url = new URL(url, location.origin).href;
		}
		return oldFetch(proxify(url), init);
	};
}
