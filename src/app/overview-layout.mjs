/**
 * WHERE EVERY NAME SITS IN THE WHOLE-VAULT OVERVIEW. Pure arithmetic — no canvas, no DOM, no React.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A FORCE LAYOUT OVER THE WHOLE VAULT
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A vault of this shape is one large region and about three hundred small ones. A force simulation
 * run over all of it has NO FORCE between 99% of node pairs, so what actually decides where the
 * small ones sit is the gravity term — a knob. The picture is then arranged by a parameter rather
 * than by the data, it looks different every time it is drawn, and a reader who noticed that two
 * islands had moved apart would be reading a random seed.
 *
 * So the layout is in two halves, and each half is honest about what it is:
 *
 *   1. INSIDE a component, position means something — adjacency — and a relaxation is the right
 *      tool. It is seeded by a breadth-first radial placement from that component's own hub and
 *      uses no randomness at all, so the same component always draws the same picture.
 *
 *   2. BETWEEN components, position means NOTHING, and the layout says so by not pretending: they
 *      are packed largest-first into rows. The result is the one honest arrangement for a set of
 *      islands with no relationship to each other, and it has a property a force layout cannot
 *      offer — the eye reads size order across the canvas, so "one continent and a field of small
 *      things" is legible as a fact rather than inferred from a blob.
 *
 * DETERMINISM IS A FEATURE, NOT TIDINESS. This picture is a diagnostic. A diagnostic you run
 * fortnightly is only useful if what changed between two runs is the vault.
 */

/** The distance a relaxation tries to hold between two joined names, in layout units. */
const EDGE_LENGTH = 46;

/** Radius of a drawn name at degree 1. Degree scales it; see `nodeRadius`. */
export const BASE_RADIUS = 3.2;

/** Clear space kept around every component when it is packed. */
const COMPONENT_GAP = 26;

/**
 * A ONE-FACT ISLAND IS DRAWN SMALL AND CLOSE, so two hundred of them read as a field and not as
 * confetti. Two names joined by one statement carry no shape worth reading — the picture's job for
 * them is to show HOW MANY there are, and a tighter mark does that better than a larger one. They
 * are packed at two thirds of the edge length and half the gap; the canvas draws them smaller and
 * quieter as well. Anything with a third name in it is drawn at full size, because from three names
 * up there is a shape.
 */
const ISLAND_SIZE = 2;
const ISLAND_EDGE = 30;
const ISLAND_GAP = 13;
const isIsland = (size) => size <= ISLAND_SIZE;

/**
 * How hard a component is relaxed, by how many names are in it.
 *
 * A pair or a triangle has one legible arrangement and a relaxation cannot improve on the seed, so
 * it is skipped entirely — which is most of the vault and most of the saving. The one large region
 * gets the iterations, and it is the only place they change anything a reader can see.
 */
const iterationsFor = (size) => (size < 5 ? 0 : size < 20 ? 120 : 260);

/** A drawn name's radius. Square-rooted, so a degree-9 name reads as bigger and not as nine times. */
export const nodeRadius = (degree) => BASE_RADIUS + Math.sqrt(Math.max(0, degree ?? 0)) * 2.1;

/**
 * Lay out one component around its own hub, then relax it.
 *
 * The seed is breadth-first rings from the most-connected member, which is already a good drawing
 * for a tree — and these components are very nearly all trees. The relaxation is there to unfold
 * the few that braid, and because a seeded relaxation moves nodes a reader would otherwise see
 * sitting exactly on top of each other at the same ring position.
 */
function placeComponent(members, neighbours) {
	const positions = new Map();
	if (members.length === 1) {
		positions.set(members[0], { x: 0, y: 0 });
		return positions;
	}
	const edgeLength = isIsland(members.length) ? ISLAND_EDGE : EDGE_LENGTH;

	const hub = members.reduce((best, id) =>
		(neighbours.get(id)?.length ?? 0) > (neighbours.get(best)?.length ?? 0) ? id : best,
	);

	// Breadth-first depth from the hub, with a stable order so the seed cannot depend on Map order.
	const depth = new Map([[hub, 0]]);
	const queue = [hub];
	while (queue.length > 0) {
		const id = queue.shift();
		const next = [...(neighbours.get(id) ?? [])].sort();
		for (const other of next) {
			if (depth.has(other)) continue;
			depth.set(other, depth.get(id) + 1);
			queue.push(other);
		}
	}

	const rings = new Map();
	for (const id of members) {
		const d = depth.get(id) ?? 1;
		if (!rings.has(d)) rings.set(d, []);
		rings.get(d).push(id);
	}
	for (const [d, ids] of rings) {
		ids.sort();
		if (d === 0) {
			positions.set(ids[0], { x: 0, y: 0 });
			continue;
		}
		const radius = edgeLength * d;
		ids.forEach((id, index) => {
			// The half-step on alternating rings is what stops ring 2 hiding directly behind ring 1.
			const offset = d % 2 === 0 ? Math.PI / ids.length : 0;
			const angle = -Math.PI / 2 + offset + (index / ids.length) * Math.PI * 2;
			positions.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
		});
	}

	relax(members, neighbours, positions, iterationsFor(members.length));
	return positions;
}

/**
 * A SEEDED RELAXATION WITH SPRINGS ON THE EDGES AND REPULSION ONLY BETWEEN NEAR NEIGHBOURS.
 *
 * There is no random term anywhere in it, so the same component always draws the same picture.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY NOT PLAIN FRUCHTERMAN–REINGOLD, WHICH IS WHAT THIS WAS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * In classic FR every pair repels and only joined pairs attract. On a DENSE graph those balance. On
 * a near-tree — which every component in a vault of this shape is — there are barely more edges than
 * nodes, so with two hundred names there are twenty thousand repelling pairs against two hundred
 * attracting ones. The repulsion wins by two orders of magnitude and the component inflates until it
 * meets whatever is holding it.
 *
 * Whatever is holding it then becomes the picture. Clamping x and y drew the largest region in this
 * vault as a literal square with its nodes stacked along the sides. Clamping to a circle drew it as
 * a RING — which is not a bug in the clamp, it is the correct answer to the wrong question: mutually
 * repelling particles confined to a disc go to its boundary, exactly as charge does on a conductor.
 * Both pictures were drawings of the confinement, and both would have been read as a drawing of the
 * vault.
 *
 * So the model changed rather than the constant. Repulsion is CUT OFF past a short range, where its
 * only job is to stop names sitting on top of each other, and the edges are SPRINGS with a rest
 * length rather than an unbounded pull. The scale of the drawing is then set by the edges — which is
 * the thing that actually means something — and no frame decides anything. The clamp below survives
 * only as a backstop against a pathological input, at a radius the relaxation does not reach.
 */
function relax(members, neighbours, positions, iterations) {
	if (iterations <= 0) return;
	const k = EDGE_LENGTH;
	const n = members.length;

	/** Past this, two unjoined names do not push each other apart at all. */
	const cutoff = k * 2.2;
	/** How hard an edge pulls back to its rest length. */
	const spring = 0.5;
	/** A backstop, not a frame: the relaxation settles well inside it. */
	const bound = k * Math.sqrt(n) * 3;

	/*
	 * THE INNER LOOP RUNS ON NUMBERS, NOT ON SURFACES.
	 *
	 * It is O(n²) per iteration and the largest component in a vault of this shape is a couple of
	 * hundred names, so it executes a few million times per open. Reading and writing a `Map` keyed
	 * on a vault surface inside that loop — a string hash per access — was measured at roughly five
	 * times the cost of the arithmetic it was carrying. The surfaces go back on at the end.
	 */
	const index = new Map(members.map((id, at) => [id, at]));
	const px = new Float64Array(n);
	const py = new Float64Array(n);
	for (let i = 0; i < n; i += 1) {
		const point = positions.get(members[i]);
		px[i] = point.x;
		py[i] = point.y;
	}

	// The adjacency, flattened: `adj` holds neighbour indices and `start` says where each node's
	// run begins. One allocation instead of a Map of arrays walked n times per iteration.
	const start = new Int32Array(n + 1);
	for (let i = 0; i < n; i += 1) {
		start[i + 1] = start[i] + (neighbours.get(members[i]) ?? []).filter((id) => index.has(id)).length;
	}
	const adj = new Int32Array(start[n]);
	{
		let at = 0;
		for (let i = 0; i < n; i += 1) {
			for (const id of neighbours.get(members[i]) ?? []) {
				const other = index.get(id);
				if (other !== undefined) adj[at++] = other;
			}
		}
	}

	const dx = new Float64Array(n);
	const dy = new Float64Array(n);

	for (let step = 0; step < iterations; step += 1) {
		const temperature = (k * 0.7 * (iterations - step)) / iterations;
		dx.fill(0);
		dy.fill(0);

		for (let i = 0; i < n; i += 1) {
			const ax = px[i];
			const ay = py[i];
			for (let j = i + 1; j < n; j += 1) {
				let vx = ax - px[j];
				let vy = ay - py[j];
				let distance = Math.sqrt(vx * vx + vy * vy);
				if (distance > cutoff) continue;
				if (distance < 0.01) {
					// Two nodes exactly on top of each other. Separated along a direction derived from
					// their own indices, never from a random number: the picture must not move between
					// two draws of the same vault.
					vx = ((i % 7) - 3) * 0.1 + 0.01;
					vy = ((j % 7) - 3) * 0.1 + 0.01;
					distance = Math.sqrt(vx * vx + vy * vy);
				}
				const scale = (k * k) / (distance * distance);
				const ux = vx * scale;
				const uy = vy * scale;
				dx[i] += ux;
				dy[i] += uy;
				dx[j] -= ux;
				dy[j] -= uy;
			}
		}

		for (let i = 0; i < n; i += 1) {
			for (let at = start[i]; at < start[i + 1]; at += 1) {
				/*
				  A SPRING, NOT AN UNBOUNDED PULL. It is slack at the rest length, pulls in beyond it and
				  pushes out inside it, so a joined pair has a distance it wants rather than a distance
				  it is losing an argument about.

				  Each edge is walked from BOTH ends and each visit moves only the end it is walking
				  from, so over the two visits each endpoint receives the full force exactly once.
				*/
				const j = adj[at];
				const vx = px[i] - px[j];
				const vy = py[i] - py[j];
				const distance = Math.max(0.01, Math.sqrt(vx * vx + vy * vy));
				const force = ((distance - k) * spring) / distance;
				dx[i] -= vx * force;
				dy[i] -= vy * force;
			}
		}

		for (let i = 0; i < n; i += 1) {
			const magnitude = Math.max(0.01, Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]));
			const limit = Math.min(magnitude, temperature) / magnitude;
			let nx = px[i] + dx[i] * limit;
			let ny = py[i] + dy[i] * limit;
			const radius = Math.sqrt(nx * nx + ny * ny);
			if (radius > bound) {
				nx = (nx / radius) * bound;
				ny = (ny / radius) * bound;
			}
			px[i] = nx;
			py[i] = ny;
		}
	}

	// Re-centred on what the component actually holds. Without this the biggest circle in a
	// component can end up on that component's edge, which reads as though the thing everything is
	// joined to were peripheral.
	let cx = 0;
	let cy = 0;
	for (let i = 0; i < n; i += 1) {
		cx += px[i];
		cy += py[i];
	}
	cx /= n;
	cy /= n;
	for (let i = 0; i < n; i += 1) {
		positions.set(members[i], { x: px[i] - cx, y: py[i] - cy });
	}
}

/**
 * A stable angle in [0, 2π) from a surface's own characters. FNV-1a, because it is four lines and
 * the same string gives the same angle on every machine and in every Node version, forever.
 */
function angleFrom(surface) {
	let hash = 0x811c9dc5;
	const text = String(surface ?? '');
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return ((hash % 3600) / 3600) * Math.PI * 2;
}

/** Turn a placed component about its own centre. */
function rotate(members, positions, angle) {
	if (angle === 0) return;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	for (const id of members) {
		const point = positions.get(id);
		const x = point.x * cos - point.y * sin;
		const y = point.x * sin + point.y * cos;
		point.x = x;
		point.y = y;
	}
}

/** The circle that contains a placed component, including the ink of its largest node. */
function radiusOf(members, positions, degreeOf) {
	let radius = 0;
	for (const id of members) {
		const point = positions.get(id);
		radius = Math.max(radius, Math.hypot(point.x, point.y) + nodeRadius(degreeOf(id)));
	}
	return Math.max(radius, nodeRadius(degreeOf(members[0])));
}

/**
 * THE WHOLE LAYOUT.
 *
 * @param {Array}  nodes  `{ id, degree, componentId }` from `overviewElements`
 * @param {Array}  edges  `{ source, target }`
 * @param {number} aspect target width / height. The canvas is wide, so the packing should be.
 * @returns {{positions: Map<string,{x,y}>, bounds, components, elapsedMs}}
 *          `elapsedMs` is measured here rather than by the caller so the number reported on screen
 *          is the number this function actually spent, not a render pass around it.
 */
export function overviewLayout(nodes, edges, { aspect = 2.6 } = {}) {
	const startedAt = Date.now();

	const degreeOf = (() => {
		const degrees = new Map(nodes.map((node) => [node.id, node.degree ?? 0]));
		return (id) => degrees.get(id) ?? 0;
	})();

	const present = new Set(nodes.map((node) => node.id));
	const neighbours = new Map(nodes.map((node) => [node.id, []]));
	for (const edge of edges) {
		if (!present.has(edge.source) || !present.has(edge.target)) continue;
		if (edge.source === edge.target) continue;
		neighbours.get(edge.source).push(edge.target);
		neighbours.get(edge.target).push(edge.source);
	}

	// Components, from the ids the model already computed where it can, and by traversal where it
	// cannot. Recomputing them here unconditionally would be a second answer to a question the
	// model already answered, and the two would disagree the first time either changed.
	const groups = new Map();
	const untagged = [];
	for (const node of nodes) {
		if (node.componentId === undefined || node.componentId === null || node.componentId === -1) {
			untagged.push(node.id);
			continue;
		}
		if (!groups.has(node.componentId)) groups.set(node.componentId, []);
		groups.get(node.componentId).push(node.id);
	}
	if (untagged.length > 0) {
		const seen = new Set();
		for (const id of untagged) {
			if (seen.has(id)) continue;
			const members = [];
			const queue = [id];
			seen.add(id);
			while (queue.length > 0) {
				const next = queue.shift();
				members.push(next);
				for (const other of neighbours.get(next) ?? []) {
					if (seen.has(other)) continue;
					seen.add(other);
					queue.push(other);
				}
			}
			groups.set(`u${groups.size}`, members);
		}
	}

	// Largest first, with a total order, so the same vault packs the same way every time.
	const ordered = [...groups.entries()]
		.map(([id, members]) => ({ id, members: [...members].sort() }))
		.sort(
			(a, b) =>
				b.members.length - a.members.length || String(a.members[0]).localeCompare(String(b.members[0])),
		);

	const local = ordered.map((component) => {
		const positions = placeComponent(component.members, neighbours);
		/*
		  EVERY COMPONENT IS TURNED BY ITS OWN ANGLE, derived from the letters of its first member.

		  Without it, every two-name island is laid out identically — hub at the centre, its one
		  neighbour directly above — and three hundred of them pack into a regular grid of identical
		  vertical marks. That reads as structure, and there is none: the positions BETWEEN components
		  mean nothing, and a picture that looks engineered is making a claim the data is not. The
		  angle comes from the surface rather than from a counter or a random number, so it survives a
		  new memory arriving and re-ordering the pack.
		*/
		rotate(component.members, positions, angleFrom(component.members[0]));
		return { ...component, positions, radius: radiusOf(component.members, positions, degreeOf) };
	});

	// ── the pack ────────────────────────────────────────────────────────────────────────────────
	//
	// Rows, filled left to right, wrapping at a width chosen so the finished block is about the
	// canvas's shape. Because the input is sorted by size, the rows are too: the continent opens the
	// picture and the dust closes it, which is the reading the diagnostic is for.
	const gapFor = (component) => (isIsland(component.members.length) ? ISLAND_GAP : COMPONENT_GAP);
	const totalArea = local.reduce((sum, component) => sum + (2 * component.radius + gapFor(component)) ** 2, 0);
	const targetWidth = Math.max(
		local[0] ? local[0].radius * 2 + COMPONENT_GAP : 1,
		Math.sqrt(totalArea * aspect),
	);

	const placed = new Map();
	const boxes = [];
	let rowX = 0;
	let rowY = 0;
	let rowHeight = 0;

	for (const component of local) {
		const size = component.radius * 2 + gapFor(component);
		if (rowX > 0 && rowX + size > targetWidth) {
			rowX = 0;
			rowY += rowHeight;
			rowHeight = 0;
		}
		const cx = rowX + size / 2;
		const cy = rowY + size / 2;
		for (const id of component.members) {
			const point = component.positions.get(id);
			placed.set(id, { x: cx + point.x, y: cy + point.y });
		}
		boxes.push({
			id: component.id,
			size: component.members.length,
			x: cx,
			y: cy,
			radius: component.radius,
		});
		rowX += size;
		rowHeight = Math.max(rowHeight, size);
	}

	let minX = 0;
	let minY = 0;
	let maxX = 0;
	let maxY = 0;
	let first = true;
	for (const [id, point] of placed) {
		const r = nodeRadius(degreeOf(id));
		if (first) {
			minX = point.x - r;
			maxX = point.x + r;
			minY = point.y - r;
			maxY = point.y + r;
			first = false;
			continue;
		}
		minX = Math.min(minX, point.x - r);
		maxX = Math.max(maxX, point.x + r);
		minY = Math.min(minY, point.y - r);
		maxY = Math.max(maxY, point.y + r);
	}
	const pad = 30;

	return {
		positions: placed,
		components: boxes,
		bounds: {
			x: minX - pad,
			y: minY - pad,
			width: Math.max(1, maxX - minX + pad * 2),
			height: Math.max(1, maxY - minY + pad * 2),
		},
		elapsedMs: Date.now() - startedAt,
	};
}

/**
 * A grid over the placed nodes, so a pointer can find what is under it without walking all of them.
 *
 * Hover is per mouse-move. A linear scan of twelve hundred names per move is the difference between
 * a canvas that follows the pointer and one that lags behind it, and the lag is worst on exactly the
 * vault where the picture matters most.
 */
export function hitIndex(positions, cell = 40) {
	const buckets = new Map();
	const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
	for (const [id, point] of positions) {
		const at = key(point.x, point.y);
		if (!buckets.has(at)) buckets.set(at, []);
		buckets.get(at).push(id);
	}
	return {
		/** The nearest name within `radius` layout units of (x, y), or null. */
		at(x, y, radius = 12) {
			let best = null;
			let bestDistance = radius;
			const cx = Math.floor(x / cell);
			const cy = Math.floor(y / cell);
			const span = Math.ceil(radius / cell);
			for (let ix = cx - span; ix <= cx + span; ix += 1) {
				for (let iy = cy - span; iy <= cy + span; iy += 1) {
					for (const id of buckets.get(`${ix},${iy}`) ?? []) {
						const point = positions.get(id);
						const distance = Math.hypot(point.x - x, point.y - y);
						if (distance < bestDistance) {
							bestDistance = distance;
							best = id;
						}
					}
				}
			}
			return best;
		},
	};
}
