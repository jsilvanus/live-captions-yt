# NPX CLI Activation Plan

## Goal
Enable `npx lcyt` to run the CLI in interactive mode, providing a seamless experience for users who want to quickly send live captions to YouTube without installing the package globally.

---

## Current State Analysis

### What Already Works
- CLI entry point exists at `bin/lcyt` with proper shebang (`#!/usr/bin/env node`)
- `package.json` has `bin.lcyt` field pointing to `bin/lcyt`
- Interactive mode is fully implemented via `--interactive` or `-i` flag
- Package name is `lcyt` (short, easy to remember)

### Current Behavior
When running `lcyt` (or `npx lcyt`) with no arguments:
- If stream key is configured: Shows configuration display (URL, region, cue, sequence)
- If no stream key: Shows same config display with null values

### Desired Behavior for `npx lcyt`
- Quick onboarding: prompt for stream key if not set
- Default to interactive mode for immediate caption sending
- Zero-friction experience for first-time users
- **Direct setup via flag**: `npx lcyt --stream-key=xxxx` skips wizard, saves key, enters interactive mode

---

## Implementation Plan

### Phase 1: Improve Default Behavior (No Arguments)

#### Task 1.1: Add First-Run Detection & Direct Setup
- [ ] Detect when running without arguments AND no stream key configured
- [ ] Show a friendly welcome message with setup instructions
- [ ] Prompt user to enter stream key interactively (using readline)
- [ ] Save the stream key to config automatically
- [ ] **Support direct setup**: `npx lcyt --stream-key=xxxx` (or `-k xxxx`)
  - Skip the interactive wizard entirely
  - Save the provided key to config
  - Enter interactive mode immediately

#### Task 1.2: Make Interactive Mode the Default
- [ ] When no arguments provided AND stream key IS configured:
  - Start interactive mode automatically instead of showing config
- [ ] Add `--config` or `--show-config` flag to explicitly show configuration
- [ ] Add `--no-interactive` flag for scripts that want single-shot behavior
- [ ] Update help text to reflect new defaults

#### Task 1.3: Graceful npx Detection (Optional Enhancement)
- [ ] Detect if running via npx (check `npm_execpath` or `npm_lifecycle_event`)
- [ ] Adjust welcome message for npx users (mention they can install globally)

### Phase 2: Package.json Enhancements

#### Task 2.1: Verify bin Configuration
- [ ] Ensure `bin` field is correctly configured:
  ```json
  "bin": {
    "lcyt": "bin/lcyt"
  }
  ```
- [ ] Test that `npm link` works for local development
- [ ] Verify shebang line is correct (`#!/usr/bin/env node`)

#### Task 2.2: Add Package Metadata for npm
- [ ] Ensure `description` field is descriptive for npm search
- [ ] Add `keywords` for discoverability: `["youtube", "live", "captions", "closed-captions", "streaming", "cli"]`
- [ ] Verify `repository`, `homepage`, and `bugs` URLs are set
- [ ] Add `engines` field to specify Node.js version requirements
- [ ] Set `preferGlobal: false` (npx-friendly)

#### Task 2.3: Files Field Optimization
- [ ] Review `files` field to ensure only necessary files are published
- [ ] Include: `bin/`, `src/`, `dist/`, `README.md`, `LICENSE`
- [ ] Exclude: test files, scripts/, python/, docs (unless needed)

### Phase 3: User Experience Improvements

#### Task 3.1: Welcome/Onboarding Flow
- [ ] Create welcome banner for first-time users:
  ```
  ┌──────────────────────────────────────────┐
  │  LCYT - Live Captions for YouTube        │
  │  Send real-time captions to your stream  │
  └──────────────────────────────────────────┘
  ```
- [ ] Add step-by-step setup instructions inline
- [ ] Link to documentation for getting YouTube stream key

#### Task 3.2: Interactive Setup Wizard
- [ ] Prompt for stream key if missing: `Enter your YouTube stream key (cid):`
- [ ] Validate stream key format (basic check)
- [ ] Offer to send a test heartbeat to verify connection
- [ ] Confirm successful setup before entering interactive mode

#### Task 3.3: Improved Help Text
- [ ] Update `--help` with npx-friendly examples:
  ```
  Quick Start:
    npx lcyt                        # Interactive setup wizard (first run)
    npx lcyt --stream-key=YOUR_KEY  # Skip wizard, save key, enter interactive mode
    npx lcyt                        # Interactive mode (after setup)

  Examples:
    npx lcyt "Hello world"          # Send single caption
    npx lcyt --heartbeat            # Test connection
    npx lcyt -k NEW_KEY             # Update stream key and enter interactive mode
  ```

### Phase 4: Testing & Verification

#### Task 4.1: Local Testing
- [ ] Test `npm link` and run `lcyt` command
- [ ] Test `npx .` from project directory
- [ ] Test `npx /path/to/project` from another directory
- [ ] Verify all flags still work as expected

#### Task 4.2: Package Testing
- [ ] Run `npm pack` to create tarball
- [ ] Test `npx ./lcyt-x.x.x.tgz` to simulate npm install
- [ ] Verify bin script is executable after extraction

#### Task 4.3: Cross-Platform Testing
- [ ] Test on Linux (primary)
- [ ] Test on macOS (if available)
- [ ] Test on Windows (verify shebang handling)

### Phase 5: Documentation Updates

#### Task 5.1: README Updates
- [ ] Add prominent npx usage section at top
- [ ] Update installation instructions to show both:
  - `npx lcyt` (no install needed)
  - `npm install -g lcyt` (global install)
- [ ] Add quick start section for immediate use

#### Task 5.2: CLI Help Improvements
- [ ] Ensure `--help` output is comprehensive
- [ ] Add examples section in help output
- [ ] Document all available commands in interactive mode

---

## Implementation Details

### Code Changes Required

#### 1. `bin/lcyt` - Main CLI Entry Point

```javascript
// Add at the top (after imports)
const isFirstRun = !config.streamKey;
const hasArgs = process.argv.length > 2;
const onlyHasStreamKeyArg = /* check if only -k/--stream-key provided */;

// Modify the main logic flow:
if (!hasArgs) {
  if (isFirstRun) {
    // Run setup wizard
    await runSetupWizard();
  } else {
    // Default to interactive mode
    await startInteractiveMode();
  }
} else if (onlyHasStreamKeyArg) {
  // Direct setup: npx lcyt --stream-key=xxxx
  // Save the key and enter interactive mode
  config.streamKey = argv.streamKey;
  saveConfig(config, configPath);
  console.log('✓ Stream key saved!');
  await startInteractiveMode();
} else {
  // Existing argument handling (send caption, heartbeat, test, etc.)
}
```

#### 2. New Setup Wizard Function

```javascript
async function runSetupWizard() {
  console.log(welcomeBanner);
  console.log('\nFirst-time setup required.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const streamKey = await question(rl, 'Enter your YouTube stream key: ');

  // Validate and save
  config.streamKey = streamKey;
  saveConfig(config, configPath);

  console.log('\n✓ Configuration saved!\n');

  // Offer heartbeat test
  const testConnection = await question(rl, 'Test connection? (Y/n): ');
  if (testConnection.toLowerCase() !== 'n') {
    await sendHeartbeat();
  }

  // Enter interactive mode
  await startInteractiveMode();
}
```

#### 3. package.json Additions

```json
{
  "keywords": [
    "youtube",
    "live",
    "captions",
    "closed-captions",
    "streaming",
    "cli",
    "accessibility"
  ],
  "engines": {
    "node": ">=18.0.0"
  },
  "files": [
    "bin/",
    "src/",
    "dist/",
    "README.md",
    "LICENSE"
  ]
}
```

---

## Rollout Plan

1. **Development**: Implement changes on feature branch
2. **Local Testing**: Verify with `npm link` and `npx .`
3. **Version Bump**: Update to v1.2.0 (new feature)
4. **Documentation**: Update README and CHANGELOG
5. **Publish**: `npm publish` to make available via npx
6. **Announce**: Update any existing documentation/references

---

## Success Criteria

- [ ] `npx lcyt` works without prior installation
- [ ] First-time users are guided through setup wizard
- [ ] `npx lcyt --stream-key=xxxx` skips wizard and enters interactive mode
- [ ] Configured users enter interactive mode immediately
- [ ] All existing CLI functionality continues to work
- [ ] Help text is clear and shows npx examples
- [ ] Package size is reasonable (< 50KB excluding node_modules)

---

## Open Questions

1. Should we maintain backward compatibility with the current "show config" default?
   - Recommendation: Add `--show-config` flag, change default to interactive

2. Should the setup wizard be skippable?
   - **DECIDED**: Yes, via `--stream-key=xxxx` flag (or `-k xxxx`) or `LCYT_STREAM_KEY` env var
   - Running `npx lcyt --stream-key=xxxx` saves the key and enters interactive mode directly

3. Should we support environment variables for CI/CD usage?
   - Recommendation: Yes, add `LCYT_STREAM_KEY` environment variable support

---

## Timeline Estimate

- Phase 1: Core functionality changes
- Phase 2: Package configuration
- Phase 3: UX polish
- Phase 4: Testing
- Phase 5: Documentation

Total: Ready for implementation
