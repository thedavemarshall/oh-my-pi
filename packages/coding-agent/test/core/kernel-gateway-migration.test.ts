import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { migrateLegacyGatewayDir } from "@oh-my-pi/pi-coding-agent/kernel/gateway-coordinator";
import { TempDir } from "@oh-my-pi/pi-utils";

afterEach(() => {
	vi.restoreAllMocks();
});

async function exists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

describe("migrateLegacyGatewayDir", () => {
	it("is a no-op when the legacy dir does not exist", async () => {
		await using tempDir = await TempDir.create();

		await expect(migrateLegacyGatewayDir(tempDir.path())).resolves.toBeUndefined();
	});

	it("removes the legacy dir when it exists with no lockfile", async () => {
		await using tempDir = await TempDir.create();
		const legacyDir = path.join(tempDir.path(), "python-gateway");
		await fs.mkdir(legacyDir);
		await fs.writeFile(path.join(legacyDir, "leftover.json"), "{}");

		await migrateLegacyGatewayDir(tempDir.path());

		expect(await exists(legacyDir)).toBe(false);
	});

	it("attempts to kill the lockfile pid then removes the dir", async () => {
		await using tempDir = await TempDir.create();
		const legacyDir = path.join(tempDir.path(), "python-gateway");
		await fs.mkdir(legacyDir);
		await fs.writeFile(path.join(legacyDir, "gateway.lock"), JSON.stringify({ pid: 9_999_999 }));
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

		await migrateLegacyGatewayDir(tempDir.path());

		expect(killSpy).toHaveBeenCalledWith(9_999_999, "SIGTERM");
		expect(await exists(legacyDir)).toBe(false);
	});

	it("does not crash when the lockfile is malformed JSON", async () => {
		await using tempDir = await TempDir.create();
		const legacyDir = path.join(tempDir.path(), "python-gateway");
		await fs.mkdir(legacyDir);
		await fs.writeFile(path.join(legacyDir, "gateway.lock"), "{not json");

		await expect(migrateLegacyGatewayDir(tempDir.path())).resolves.toBeUndefined();
		expect(await exists(legacyDir)).toBe(false);
	});

	it("does not crash when the lockfile pid field is missing or non-numeric", async () => {
		await using tempDir = await TempDir.create();
		const legacyDir = path.join(tempDir.path(), "python-gateway");
		await fs.mkdir(legacyDir);
		await fs.writeFile(path.join(legacyDir, "gateway.lock"), JSON.stringify({ note: "no pid here" }));
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

		await migrateLegacyGatewayDir(tempDir.path());

		expect(killSpy).not.toHaveBeenCalled();
		expect(await exists(legacyDir)).toBe(false);
	});

	it("returns silently when the legacy path is a file, not a directory", async () => {
		await using tempDir = await TempDir.create();
		const legacyPath = path.join(tempDir.path(), "python-gateway");
		await fs.writeFile(legacyPath, "stray file at the legacy location");

		await migrateLegacyGatewayDir(tempDir.path());

		// File should still exist — the function only cleans up directories.
		expect(await exists(legacyPath)).toBe(true);
	});

	it("survives a swallowed kill failure and still removes the dir", async () => {
		await using tempDir = await TempDir.create();
		const legacyDir = path.join(tempDir.path(), "python-gateway");
		await fs.mkdir(legacyDir);
		await fs.writeFile(path.join(legacyDir, "gateway.lock"), JSON.stringify({ pid: 12345 }));
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw new Error("ESRCH");
		});

		await expect(migrateLegacyGatewayDir(tempDir.path())).resolves.toBeUndefined();
		expect(await exists(legacyDir)).toBe(false);
	});
});
