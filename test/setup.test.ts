import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isUnix, resolveSetupValue, extractCommands } from '../src/utils/setup.js';

/**
 * Setup Tests
 *
 * These tests verify the setup command parsing and OS-specific key handling
 * for worktrees.json configuration files.
 */

/**
 * Helper to mock process.platform for cross-platform testing
 */
const mockPlatform = (platform: NodeJS.Platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
};

describe('Setup Utilities', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('isUnix', () => {
        it('should return true on Unix platforms (macOS)', () => {
            mockPlatform('darwin');
            expect(isUnix()).toBe(true);
        });

        it('should return true on Unix platforms (Linux)', () => {
            mockPlatform('linux');
            expect(isUnix()).toBe(true);
        });

        it('should return false on Windows', () => {
            mockPlatform('win32');
            expect(isUnix()).toBe(false);
        });
    });

    describe('resolveSetupValue', () => {
        const repoRoot = '/test/repo';

        it('should return array values as-is', () => {
            const commands = ['npm install', 'npm run build'];
            const result = resolveSetupValue(commands, repoRoot);
            expect(result).toEqual(commands);
        });

        it('should convert string filepath to array with resolved path', () => {
            const scriptPath = './scripts/setup.sh';
            const result = resolveSetupValue(scriptPath, repoRoot);
            expect(result).toEqual([join(repoRoot, '.cursor', scriptPath)]);
        });

        it('should handle script path without leading ./', () => {
            const scriptPath = 'scripts/setup.sh';
            const result = resolveSetupValue(scriptPath, repoRoot);
            expect(result).toEqual([join(repoRoot, '.cursor', scriptPath)]);
        });
    });

    describe('extractCommands', () => {
        const repoRoot = '/test/repo';

        describe('plain array format (legacy)', () => {
            it('should return the array directly', () => {
                const data = ['npm install', 'npm run build'];
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual(data);
            });
        });

        describe('object format with setup-worktree key', () => {
            it('should extract commands from setup-worktree array', () => {
                const data = {
                    'setup-worktree': ['npm install', 'npm run build']
                };
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual(['npm install', 'npm run build']);
            });

            it('should handle setup-worktree as script filepath', () => {
                const data = {
                    'setup-worktree': './scripts/setup.sh'
                };
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual([join(repoRoot, '.cursor', './scripts/setup.sh')]);
            });
        });

        describe('OS-specific key priority', () => {
            it('should prefer setup-worktree-unix on Unix systems', () => {
                mockPlatform('darwin');

                const data = {
                    'setup-worktree': ['fallback command'],
                    'setup-worktree-unix': ['unix command'],
                    'setup-worktree-windows': ['windows command']
                };
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual(['unix command']);
            });

            it('should prefer setup-worktree-windows on Windows systems', () => {
                mockPlatform('win32');

                const data = {
                    'setup-worktree': ['fallback command'],
                    'setup-worktree-unix': ['unix command'],
                    'setup-worktree-windows': ['windows command']
                };
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual(['windows command']);
            });

            it('should fall back to setup-worktree when OS-specific key is missing on Unix', () => {
                mockPlatform('darwin');

                const data = {
                    'setup-worktree': ['fallback command']
                };
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual(['fallback command']);
            });

            it('should fall back to setup-worktree when OS-specific key is missing on Windows', () => {
                mockPlatform('win32');

                const data = {
                    'setup-worktree': ['fallback command']
                };
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual(['fallback command']);
            });

            it('should handle OS-specific key as script filepath on Unix', () => {
                mockPlatform('darwin');

                const data = {
                    'setup-worktree-unix': './scripts/setup-unix.sh',
                    'setup-worktree': ['fallback command']
                };
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual([join(repoRoot, '.cursor', './scripts/setup-unix.sh')]);
            });

            it('should handle OS-specific key as script filepath on Windows', () => {
                mockPlatform('win32');

                const data = {
                    'setup-worktree-windows': './scripts/setup-windows.bat',
                    'setup-worktree': ['fallback command']
                };
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual([join(repoRoot, '.cursor', './scripts/setup-windows.bat')]);
            });
        });

        describe('empty/missing data', () => {
            it('should return empty array for empty object', () => {
                const data = {};
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual([]);
            });

            it('should return empty array when no setup keys are present', () => {
                const data = {
                    'some-other-key': ['value']
                };
                const result = extractCommands(data, repoRoot);
                expect(result).toEqual([]);
            });
        });
    });
});

describe('Setup File Loading', () => {
    let testDir: string;

    beforeEach(async () => {
        testDir = join(tmpdir(), `wt-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await mkdir(testDir, { recursive: true });
        await mkdir(join(testDir, '.cursor'), { recursive: true });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        try {
            await rm(testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('file location priority', () => {
        it('should parse .cursor/worktrees.json with Unix-specific keys', async () => {
            mockPlatform('darwin');

            const config = {
                'setup-worktree-unix': ['echo "Unix setup"'],
                'setup-worktree-windows': ['echo Windows setup'],
                'setup-worktree': ['echo "Fallback"']
            };
            await writeFile(
                join(testDir, '.cursor', 'worktrees.json'),
                JSON.stringify(config)
            );

            const commands = extractCommands(config, testDir);
            expect(commands).toEqual(['echo "Unix setup"']);
        });

        it('should parse .cursor/worktrees.json with Windows-specific keys', async () => {
            mockPlatform('win32');

            const config = {
                'setup-worktree-unix': ['echo "Unix setup"'],
                'setup-worktree-windows': ['echo Windows setup'],
                'setup-worktree': ['echo "Fallback"']
            };
            await writeFile(
                join(testDir, '.cursor', 'worktrees.json'),
                JSON.stringify(config)
            );

            const commands = extractCommands(config, testDir);
            expect(commands).toEqual(['echo Windows setup']);
        });

        it('should parse worktrees.json with plain array format', async () => {
            const config = ['npm install', 'npm run build'];
            await writeFile(
                join(testDir, 'worktrees.json'),
                JSON.stringify(config)
            );

            const commands = extractCommands(config, testDir);
            expect(commands).toEqual(['npm install', 'npm run build']);
        });

        it('should parse worktrees.json with script filepath on Unix', async () => {
            mockPlatform('darwin');

            const config = {
                'setup-worktree-unix': './scripts/setup.sh'
            };
            await writeFile(
                join(testDir, '.cursor', 'worktrees.json'),
                JSON.stringify(config)
            );

            const commands = extractCommands(config, testDir);
            expect(commands).toEqual([join(testDir, '.cursor', './scripts/setup.sh')]);
        });

        it('should parse worktrees.json with script filepath on Windows', async () => {
            mockPlatform('win32');

            const config = {
                'setup-worktree-windows': './scripts/setup.bat'
            };
            await writeFile(
                join(testDir, '.cursor', 'worktrees.json'),
                JSON.stringify(config)
            );

            const commands = extractCommands(config, testDir);
            expect(commands).toEqual([join(testDir, '.cursor', './scripts/setup.bat')]);
        });
    });
});
