#!/usr/bin/env node

/**
 * Database Test Matrix Runner
 * 
 * Runs the same test suite against both SQLite and PostgreSQL
 * to ensure zero regressions and database compatibility.
 * 
 * Usage:
 *   node test/matrix.js
 *   npm run test:matrix
 * 
 * Environment:
 *   SQLITE_URL="sqlite://dev.db"
 *   POSTGRES_URL="postgresql://user:pass@localhost/lcyt"
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SQLITE_URL = process.env.SQLITE_URL || 'file:./dev.db';
const POSTGRES_URL = process.env.POSTGRES_URL || 'postgresql://lcyt_user:dev-password-change-me@localhost:5432/lcyt';

const TEST_CONFIG = {
  sqlite: {
    name: 'SQLite',
    url: SQLITE_URL,
    env: {
      DATABASE_URL: SQLITE_URL,
      NODE_ENV: 'test',
    },
  },
  postgres: {
    name: 'PostgreSQL',
    url: POSTGRES_URL,
    env: {
      DATABASE_URL: POSTGRES_URL,
      NODE_ENV: 'test',
    },
  },
};

/**
 * Run tests for a specific database
 */
async function runTests(dbType) {
  return new Promise((resolve) => {
    const config = TEST_CONFIG[dbType];
    const startTime = Date.now();

    const env = {
      ...process.env,
      ...config.env,
    };

    const proc = spawn('npm', ['test'], {
      stdio: 'pipe',
      env,
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
      const duration = Date.now() - startTime;
      const testCount = (stdout.match(/✓/g) || []).length;
      const failureCount = (stdout.match(/✗/g) || []).length;

      resolve({
        type: dbType,
        name: config.name,
        url: config.url,
        code,
        duration,
        testCount,
        failureCount,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Parse test output and extract metrics
 */
function parseTestOutput(output) {
  const testMatch = output.match(/(\d+)\s+test[s]?/);
  const passMatch = output.match(/(\d+)\s+passed/);
  const failMatch = output.match(/(\d+)\s+failed/);
  const skipMatch = output.match(/(\d+)\s+skipped/);

  return {
    total: testMatch ? parseInt(testMatch[1]) : 0,
    passed: passMatch ? parseInt(passMatch[1]) : 0,
    failed: failMatch ? parseInt(failMatch[1]) : 0,
    skipped: skipMatch ? parseInt(skipMatch[1]) : 0,
  };
}

/**
 * Format results table
 */
function formatResults(results) {
  const maxNameLen = Math.max(...results.map((r) => r.name.length));
  const maxUrlLen = Math.max(...results.map((r) => r.url.length));

  console.log('');
  console.log('┌' + '─'.repeat(78) + '┐');
  console.log(
    '│ ' +
    'Database Test Matrix Results'.padEnd(76) +
    ' │'
  );
  console.log('├' + '─'.repeat(78) + '┤');

  for (const result of results) {
    const status = result.code === 0 ? '✅ PASS' : '❌ FAIL';
    const duration = (result.duration / 1000).toFixed(2) + 's';
    const tests = result.testCount + ' test' + (result.testCount !== 1 ? 's' : '');
    const line = `│ ${result.name.padEnd(
      maxNameLen
    )} │ ${status} │ ${tests.padEnd(15)} │ ${duration.padStart(7)} │`;
    console.log(line);
  }

  console.log('├' + '─'.repeat(78) + '┤');

  // Summary line
  const allPassed = results.every((r) => r.code === 0);
  const summary = allPassed
    ? '✅ All databases passed'
    : '❌ One or more databases failed';
  console.log('│ ' + summary.padEnd(76) + ' │');
  console.log('└' + '─'.repeat(78) + '┘');
  console.log('');

  return allPassed;
}

/**
 * Main entry point
 */
async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log(
    '║ LCYT Database Test Matrix                                                        ║'
  );
  console.log('║ Running tests against multiple databases...                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('📦 Test Configuration:');
  console.log(`   SQLite:      ${SQLITE_URL}`);
  console.log(`   PostgreSQL:  ${POSTGRES_URL}`);
  console.log('');

  console.log('⏱️  Running tests...');
  console.log('');

  // Run tests sequentially (can be parallelized later)
  const results = [];

  console.log('  1️⃣  SQLite...');
  const sqliteResult = await runTests('sqlite');
  results.push(sqliteResult);
  console.log(
    `      ✓ Complete in ${(sqliteResult.duration / 1000).toFixed(2)}s`
  );

  console.log('');
  console.log('  2️⃣  PostgreSQL...');
  const postgresResult = await runTests('postgres');
  results.push(postgresResult);
  console.log(
    `      ✓ Complete in ${(postgresResult.duration / 1000).toFixed(2)}s`
  );

  console.log('');

  // Format and display results
  const allPassed = formatResults(results);

  // Print detailed failures if any
  for (const result of results) {
    if (result.code !== 0) {
      console.log(`\n❌ ${result.name} Test Output:`);
      console.log('─'.repeat(80));
      console.log(result.stdout);
      if (result.stderr) {
        console.log('Errors:');
        console.log(result.stderr);
      }
      console.log('─'.repeat(80));
    }
  }

  // Exit with appropriate code
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
