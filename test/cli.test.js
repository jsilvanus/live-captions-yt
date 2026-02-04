import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLI_PATH = path.join(process.cwd(), 'bin', 'lcyt');

// Helper to run CLI and capture output
function runCLI(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      env: { ...process.env, ...options.env },
      timeout: options.timeout || 5000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', reject);

    // Send input if provided
    if (options.input) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    }
  });
}

// Helper to create a temporary config file
function createTempConfig(config = {}) {
  const tempDir = os.tmpdir();
  const configPath = path.join(tempDir, `.lcyt-test-${Date.now()}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

// Helper to clean up temp config
function removeTempConfig(configPath) {
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

describe('CLI', () => {
  describe('--help', () => {
    it('should display help text', async () => {
      const { code, stdout } = await runCLI(['--help']);
      assert.strictEqual(code, 0);
      assert.ok(stdout.includes('Usage:'));
      assert.ok(stdout.includes('--stream-key'));
      assert.ok(stdout.includes('--interactive'));
      assert.ok(stdout.includes('--heartbeat'));
    });

    it('should show -h alias for help', async () => {
      const { code, stdout } = await runCLI(['-h']);
      assert.strictEqual(code, 0);
      assert.ok(stdout.includes('Usage:'));
    });
  });

  describe('--version', () => {
    it('should display version number', async () => {
      const { code, stdout } = await runCLI(['--version']);
      assert.strictEqual(code, 0);
      assert.ok(/\d+\.\d+\.\d+/.test(stdout.trim()), 'Should output a semver version');
    });
  });

  describe('default behavior (no arguments)', () => {
    it('should show config when stream key is configured', async () => {
      const configPath = createTempConfig({
        streamKey: 'test-key-123',
        baseUrl: 'http://upload.youtube.com/closedcaption',
        region: 'reg1',
        cue: 'cue1',
        sequence: 0
      });

      try {
        const { code, stdout } = await runCLI(['--config', configPath]);
        assert.strictEqual(code, 0);
        assert.ok(stdout.includes('LCYT Configuration'), 'Should show config header');
        assert.ok(stdout.includes('test-key-123'), 'Should show stream key');
        assert.ok(stdout.includes('Usage:'), 'Should show usage hints');
      } finally {
        removeTempConfig(configPath);
      }
    });

    it('should show config with (not set) when no stream key', async () => {
      const configPath = createTempConfig({
        baseUrl: 'http://upload.youtube.com/closedcaption',
        region: 'reg1',
        cue: 'cue1',
        sequence: 0
      });

      try {
        // Use --show-config to skip wizard
        const { code, stdout } = await runCLI(['--show-config', '--config', configPath]);
        assert.strictEqual(code, 0);
        assert.ok(stdout.includes('(not set)'), 'Should show stream key as not set');
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('--stream-key', () => {
    it('should save stream key to config', async () => {
      const configPath = createTempConfig({});

      try {
        const { code, stdout } = await runCLI(['--stream-key', 'NEW_KEY_456', '--config', configPath]);
        assert.strictEqual(code, 0);
        assert.ok(stdout.includes('Configuration saved'), 'Should confirm save');

        // Verify the config was saved
        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(savedConfig.streamKey, 'NEW_KEY_456');
      } finally {
        removeTempConfig(configPath);
      }
    });

    it('should accept -k alias', async () => {
      const configPath = createTempConfig({});

      try {
        const { code, stdout } = await runCLI(['-k', 'ALIAS_KEY', '--config', configPath]);
        assert.strictEqual(code, 0);

        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(savedConfig.streamKey, 'ALIAS_KEY');
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('--show-config', () => {
    it('should display current configuration', async () => {
      const configPath = createTempConfig({
        streamKey: 'show-config-key',
        baseUrl: 'http://upload.youtube.com/closedcaption',
        region: 'reg1',
        cue: 'cue1',
        sequence: 42
      });

      try {
        const { code, stdout } = await runCLI(['--show-config', '--config', configPath]);
        assert.strictEqual(code, 0);
        assert.ok(stdout.includes('LCYT Configuration'));
        assert.ok(stdout.includes('show-config-key'));
        assert.ok(stdout.includes('42'), 'Should show sequence');
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('--reset', () => {
    it('should reset sequence counter to 0', async () => {
      const configPath = createTempConfig({
        streamKey: 'test-key',
        sequence: 100
      });

      try {
        const { code, stdout } = await runCLI(['--reset', '--config', configPath]);
        assert.strictEqual(code, 0);
        assert.ok(stdout.includes('Sequence counter reset to 0'));

        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(savedConfig.sequence, 0);
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('--base-url', () => {
    it('should save custom base URL', async () => {
      const configPath = createTempConfig({ streamKey: 'existing-key' });

      try {
        const { code } = await runCLI(['--base-url', 'http://custom.url/captions', '--config', configPath]);
        assert.strictEqual(code, 0);

        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(savedConfig.baseUrl, 'http://custom.url/captions');
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('--region', () => {
    it('should save custom region', async () => {
      const configPath = createTempConfig({ streamKey: 'existing-key' });

      try {
        const { code } = await runCLI(['--region', 'reg2', '--config', configPath]);
        assert.strictEqual(code, 0);

        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(savedConfig.region, 'reg2');
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('--cue', () => {
    it('should save custom cue', async () => {
      const configPath = createTempConfig({ streamKey: 'existing-key' });

      try {
        const { code } = await runCLI(['--cue', 'cue2', '--config', configPath]);
        assert.strictEqual(code, 0);

        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(savedConfig.cue, 'cue2');
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('sending captions (without real server)', () => {
    it('should error when sending caption without stream key', async () => {
      // Use --show-config to set a flag that prevents setup wizard
      // Then try to send a caption which should fail due to missing URL
      const configPath = createTempConfig({ streamKey: null });

      try {
        // First verify config shows no stream key
        const { stdout: configOut } = await runCLI(['--show-config', '--config', configPath]);
        assert.ok(configOut.includes('(not set)'));

        // Now try sending without a key - this should fail
        const { code, stderr } = await runCLI(['Hello world', '--config', configPath]);
        assert.strictEqual(code, 1);
        assert.ok(stderr.includes('No ingestion URL configured') || stderr.includes('stream-key'));
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('--heartbeat (without real server)', () => {
    it('should attempt heartbeat and fail gracefully without server', async () => {
      const configPath = createTempConfig({
        streamKey: 'test-heartbeat-key',
        baseUrl: 'http://localhost:99999/test' // Non-existent server
      });

      try {
        const { code, stderr } = await runCLI(['--heartbeat', '--config', configPath], { timeout: 10000 });
        // Should fail because server doesn't exist
        assert.strictEqual(code, 1);
        assert.ok(stderr.length > 0, 'Should have error output');
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('multiple config options', () => {
    it('should save multiple options at once', async () => {
      const configPath = createTempConfig({});

      try {
        const { code } = await runCLI([
          '--stream-key', 'multi-key',
          '--region', 'reg3',
          '--cue', 'cue3',
          '--config', configPath
        ]);
        assert.strictEqual(code, 0);

        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(savedConfig.streamKey, 'multi-key');
        assert.strictEqual(savedConfig.region, 'reg3');
        assert.strictEqual(savedConfig.cue, 'cue3');
      } finally {
        removeTempConfig(configPath);
      }
    });
  });

  describe('npx detection', () => {
    it('should detect npx execution via npm_command env var', async () => {
      // This tests the isRunningViaNpx function indirectly
      // When npm_command=exec, it should be detected as npx
      const configPath = createTempConfig({});

      try {
        // Can't easily test the welcome banner without triggering setup wizard
        // Just verify the CLI runs with the env var set
        const { code } = await runCLI(['--show-config', '--config', configPath], {
          env: { npm_command: 'exec' }
        });
        assert.strictEqual(code, 0);
      } finally {
        removeTempConfig(configPath);
      }
    });
  });
});
