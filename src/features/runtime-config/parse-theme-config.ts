type ConfigValue =
	| string
	| number
	| boolean
	| null
	| ConfigValue[]
	| ConfigObject;
type ConfigObject = { [key: string]: ConfigValue };

class ConfigLiteralParser {
	private index = 0;

	constructor(private readonly source: string) {}

	parse(): ConfigValue {
		return this.readValue();
	}

	private skipTrivia() {
		while (this.index < this.source.length) {
			const char = this.source[this.index];
			if (/\s/.test(char)) {
				this.index += 1;
				continue;
			}
			if (char === "/" && this.source[this.index + 1] === "/") {
				this.index += 2;
				while (
					this.index < this.source.length &&
					this.source[this.index] !== "\n"
				)
					this.index += 1;
				continue;
			}
			if (char === "/" && this.source[this.index + 1] === "*") {
				const end = this.source.indexOf("*/", this.index + 2);
				if (end < 0) throw new Error("Unclosed comment");
				this.index = end + 2;
				continue;
			}
			break;
		}
	}

	private readValue(): ConfigValue {
		this.skipTrivia();
		const char = this.source[this.index];
		if (char === "{") return this.readObject();
		if (char === "[") return this.readArray();
		if (char === "'" || char === '"') return this.readString();
		if (char === "-" || /\d/.test(char ?? "")) return this.readNumber();
		const identifier = this.readIdentifier();
		if (identifier === "true") return true;
		if (identifier === "false") return false;
		if (identifier === "null") return null;
		throw new Error("Unsupported value");
	}

	private readObject(): ConfigObject {
		const result: ConfigObject = Object.create(null);
		this.index += 1;
		this.skipTrivia();
		while (this.source[this.index] !== "}") {
			const char = this.source[this.index];
			const key =
				char === "'" || char === '"'
					? this.readString()
					: this.readIdentifier();
			if (typeof key !== "string" || !key)
				throw new Error("Invalid object key");
			this.skipTrivia();
			if (this.source[this.index] !== ":") throw new Error("Expected colon");
			this.index += 1;
			result[key] = this.readValue();
			this.skipTrivia();
			if (this.source[this.index] === "}") break;
			if (this.source[this.index] !== ",") throw new Error("Expected comma");
			this.index += 1;
			this.skipTrivia();
			if (this.source[this.index] === "}") break;
		}
		if (this.source[this.index] !== "}") throw new Error("Unclosed object");
		this.index += 1;
		return result;
	}

	private readArray(): ConfigValue[] {
		const result: ConfigValue[] = [];
		this.index += 1;
		this.skipTrivia();
		while (this.source[this.index] !== "]") {
			result.push(this.readValue());
			this.skipTrivia();
			if (this.source[this.index] === "]") break;
			if (this.source[this.index] !== ",") throw new Error("Expected comma");
			this.index += 1;
			this.skipTrivia();
			if (this.source[this.index] === "]") break;
		}
		if (this.source[this.index] !== "]") throw new Error("Unclosed array");
		this.index += 1;
		return result;
	}

	private readString(): string {
		const quote = this.source[this.index++];
		let result = "";
		while (this.index < this.source.length) {
			const char = this.source[this.index++];
			if (char === quote) return result;
			if (char !== "\\") {
				result += char;
				continue;
			}
			const escaped = this.source[this.index++];
			const simpleEscapes: Record<string, string> = {
				"0": "\0",
				b: "\b",
				f: "\f",
				n: "\n",
				r: "\r",
				t: "\t",
				v: "\v",
			};
			if (escaped === "u") {
				const digits = this.source.slice(this.index, this.index + 4);
				if (!/^[\da-f]{4}$/i.test(digits))
					throw new Error("Invalid unicode escape");
				result += String.fromCharCode(Number.parseInt(digits, 16));
				this.index += 4;
			} else if (escaped === "x") {
				const digits = this.source.slice(this.index, this.index + 2);
				if (!/^[\da-f]{2}$/i.test(digits))
					throw new Error("Invalid hex escape");
				result += String.fromCharCode(Number.parseInt(digits, 16));
				this.index += 2;
			} else if (escaped === "\n" || escaped === "\r") {
				if (escaped === "\r" && this.source[this.index] === "\n")
					this.index += 1;
			} else {
				result += simpleEscapes[escaped] ?? escaped;
			}
		}
		throw new Error("Unclosed string");
	}

	private readNumber(): number {
		const match = /^-?(?:0[xX][\da-f]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/i.exec(
			this.source.slice(this.index),
		);
		if (!match) throw new Error("Invalid number");
		this.index += match[0].length;
		const value = Number(match[0]);
		if (!Number.isFinite(value)) throw new Error("Invalid number");
		return value;
	}

	private readIdentifier(): string {
		const match = /^[$A-Z_a-z][$A-Z_a-z0-9]*/.exec(
			this.source.slice(this.index),
		);
		if (!match) throw new Error("Invalid identifier");
		this.index += match[0].length;
		return match[0];
	}
}

function codeWithoutCommentsAndStrings(code: string) {
	const chars = code.split("");
	let state: "code" | "single" | "double" | "template" | "line" | "block" =
		"code";
	let escaped = false;
	for (let index = 0; index < chars.length; index += 1) {
		const current = code[index];
		const next = code[index + 1];
		if (state === "line") {
			if (current === "\n") state = "code";
			else if (current !== "\r") chars[index] = " ";
			continue;
		}
		if (state === "block") {
			if (current === "*" && next === "/") {
				chars[index] = chars[index + 1] = " ";
				index += 1;
				state = "code";
			} else if (current !== "\n" && current !== "\r") chars[index] = " ";
			continue;
		}
		if (state !== "code") {
			if (current !== "\n" && current !== "\r") chars[index] = " ";
			if (escaped) escaped = false;
			else if (current === "\\") escaped = true;
			else if (
				(state === "single" && current === "'") ||
				(state === "double" && current === '"') ||
				(state === "template" && current === "`")
			)
				state = "code";
			continue;
		}
		if (current === "/" && next === "/") {
			chars[index] = chars[index + 1] = " ";
			index += 1;
			state = "line";
		} else if (current === "/" && next === "*") {
			chars[index] = chars[index + 1] = " ";
			index += 1;
			state = "block";
		} else if (current === "'") state = "single";
		else if (current === '"') state = "double";
		else if (current === "`") state = "template";
	}
	return chars.join("");
}

function findAssignment(code: string, key: string): RegExpExecArray | null {
	const masked = codeWithoutCommentsAndStrings(code);
	const assignment = new RegExp(
		`(?:\\b(?:window|globalThis)\\s*\\.\\s*)?\\b${key}\\s*=`,
		"g",
	);
	let match = assignment.exec(masked);
	while (match) {
		if (masked[match.index - 1] !== ".") return match;
		match = assignment.exec(masked);
	}
	return null;
}

function findAssignmentValue(code: string, match: RegExpExecArray): unknown {
	let source = code.slice(match.index + match[0].length);
	// The setting field may contain both <style> and <script> blocks.
	const scriptEnd = source.indexOf("</script>");
	if (scriptEnd >= 0) source = source.slice(0, scriptEnd);
	return new ConfigLiteralParser(source.trim()).parse();
}

export function parseThemeConfig(
	code: string,
): Record<string, unknown> | undefined {
	const match = findAssignment(code, "ArsnThemeConfig");
	if (!match) return undefined;
	let value: unknown;
	try {
		value = findAssignmentValue(code, match);
	} catch {
		throw new Error(
			"ArsnThemeConfig must be a plain object containing only static strings, numbers, booleans, arrays, and objects.",
		);
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return value as Record<string, unknown>;
}

export function parseThemeConfigValue(code: string, key: string): unknown {
	const match = findAssignment(code, key);
	return match ? findAssignmentValue(code, match) : undefined;
}
