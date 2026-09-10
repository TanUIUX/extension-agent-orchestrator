/** Additive safety marker for a VS Code terminal attachment. The daemon treats
 * an unset role as primary; VS Code must never win the shared PTY resize race. */
export function withSecondaryRole(frame: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(frame);
	} catch {
		return frame;
	}
	if (typeof parsed !== "object" || parsed === null) return frame;
	const record = parsed as Record<string, unknown>;
	if (record.ch !== "terminal" || record.type !== "open") return frame;
	return JSON.stringify({ ...record, role: "secondary" });
}
