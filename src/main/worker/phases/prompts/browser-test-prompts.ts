/**
 * Browser Test Prompts
 *
 * Prompt templates for AI-powered browser E2E test generation and fixing.
 * Supports web apps (with dev server) and static apps (file:// protocol).
 */

import type { AppType } from '../../../../shared/types/interfaces/e2e-test'

export interface BrowserPromptContext {
  appType: AppType
  baseUrl: string
  changedFiles: string[]
  cardTitle: string
  cardBody: string
  testDirectory: string
  existingTests: string[]
  framework: 'playwright'
}

/**
 * Build prompt for AI to create browser E2E tests for web apps.
 */
export function buildWebAppE2ECreationPrompt(ctx: BrowserPromptContext): string {
  const existingTestsSection =
    ctx.existingTests.length > 0
      ? `
## Existing Tests
The following test files already exist in the project:
${ctx.existingTests.map((f) => `- ${f}`).join('\n')}

Please follow the patterns and conventions used in these existing tests.`
      : ''

  return `# Task: Create Playwright E2E Tests for Web Application

## Context
You are testing a web application running at: ${ctx.baseUrl}
The following files were modified:
${ctx.changedFiles.map((f) => `- ${f}`).join('\n')}

## Issue Being Implemented
Title: ${ctx.cardTitle}
Description: ${ctx.cardBody || 'No description provided'}
${existingTestsSection}

## Requirements
1. Create Playwright tests using @playwright/test
2. Test the user-facing functionality added/modified by this issue
3. Place tests in: ${ctx.testDirectory}
4. Follow existing test patterns if any exist
5. Tests should connect to: ${ctx.baseUrl}

## Playwright Browser Test Structure
\`\`\`typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('${ctx.baseUrl}');
  });

  test('should display the feature correctly', async ({ page }) => {
    // Wait for content to load
    await expect(page.locator('h1')).toBeVisible();

    // Interact with the feature
    await page.click('button[data-testid="submit"]');

    // Verify the result
    await expect(page.locator('.success-message')).toHaveText('Success!');
  });

  test('should handle error cases', async ({ page }) => {
    // Test error handling
    await page.fill('input[name="email"]', 'invalid-email');
    await page.click('button[type="submit"]');

    await expect(page.locator('.error')).toBeVisible();
  });
});
\`\`\`

## Best Practices
1. Use data-testid attributes for reliable selectors
2. Use \`expect\` with built-in auto-retry for assertions
3. Use \`waitForSelector\` or \`waitForLoadState\` for dynamic content
4. Avoid hard-coded waits (setTimeout) - use Playwright's auto-waiting
5. Keep tests independent - each test should work in isolation
6. Use descriptive test names that explain what is being tested

## Instructions
1. Analyze the changed files to understand what functionality was added
2. Create comprehensive E2E tests that verify the user-facing behavior
3. Focus on testing the happy path and important edge cases
4. Ensure tests are stable and not flaky

Create the E2E tests now.`
}

/**
 * Build prompt for AI to create E2E tests for static apps (file:// protocol).
 */
export function buildStaticAppE2ECreationPrompt(ctx: BrowserPromptContext): string {
  const existingTestsSection =
    ctx.existingTests.length > 0
      ? `
## Existing Tests
The following test files already exist in the project:
${ctx.existingTests.map((f) => `- ${f}`).join('\n')}

Please follow the patterns and conventions used in these existing tests.`
      : ''

  return `# Task: Create Playwright E2E Tests for Static Web Application

## Context
You are testing a static web application (no dev server required).
Tests should load local HTML files using the file:// protocol.
The following files were modified:
${ctx.changedFiles.map((f) => `- ${f}`).join('\n')}

## Issue Being Implemented
Title: ${ctx.cardTitle}
Description: ${ctx.cardBody || 'No description provided'}
${existingTestsSection}

## Requirements
1. Create Playwright tests using @playwright/test
2. Use file:// protocol to load local HTML files
3. Test the user-facing functionality added/modified by this issue
4. Place tests in: ${ctx.testDirectory}

## Playwright Static File Test Structure
\`\`\`typescript
import { test, expect } from '@playwright/test';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Helper to get the project root
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(__dirname, '..');

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Load the main HTML file
    const indexPath = join(projectRoot, 'index.html');
    await page.goto(\`file://\${indexPath}\`);
  });

  test('should display content correctly', async ({ page }) => {
    // Wait for the page to load
    await expect(page.locator('body')).toBeVisible();

    // Verify content
    await expect(page.locator('h1')).toHaveText('Expected Title');
  });

  test('should handle user interactions', async ({ page }) => {
    // Interact with elements
    await page.click('#button-id');

    // Verify results
    await expect(page.locator('#result')).toBeVisible();
  });
});
\`\`\`

## Important Notes for Static Apps
1. Use absolute paths with file:// protocol
2. Be aware of CORS restrictions - some features may not work with file://
3. Use \`join()\` from 'path' to construct file paths
4. Test any JavaScript functionality that runs client-side

## Instructions
1. Analyze the changed files to understand what functionality was added
2. Create comprehensive E2E tests that verify the user-facing behavior
3. Focus on testing the happy path and important edge cases
4. Handle file path resolution correctly

Create the E2E tests now.`
}

/**
 * Build prompt for AI to fix failing browser E2E tests.
 */
export function buildBrowserE2EFixPrompt(
  ctx: BrowserPromptContext,
  errorOutput: string,
  attempt: number,
  maxAttempts: number
): string {
  const appTypeDescription =
    ctx.appType === 'static'
      ? 'a static web application (file:// protocol)'
      : `a web application running at ${ctx.baseUrl}`

  return `# Task: Fix Failing E2E Tests

## Test Failure Output
\`\`\`
${errorOutput}
\`\`\`

## Attempt
This is fix attempt ${attempt} of ${maxAttempts}.

## Context
You are testing ${appTypeDescription}.

## Issue Being Tested
Title: ${ctx.cardTitle}
Description: ${ctx.cardBody || 'No description provided'}

## Instructions
Analyze the test failure and fix either:
1. The test code if the test expectations are wrong
2. The application code if the implementation is incorrect
3. Both if needed

## Common Issues and Solutions
- **Element not found**: Check selector, add wait, use data-testid
- **Timeout**: Increase timeout or use proper waiting strategy
- **Assertion failed**: Verify expected values match actual behavior
- **Flaky test**: Add proper waits, avoid race conditions

## Best Practices for Fixes
1. Don't use hard-coded sleeps - use Playwright's auto-waiting
2. Use more specific selectors if elements are ambiguous
3. Add retry logic for network-dependent operations
4. Ensure test isolation - each test should clean up after itself

Focus on making the tests pass while ensuring the intended functionality works correctly.

Fix the failing tests now.`
}

/**
 * Build the appropriate E2E creation prompt based on app type.
 */
export function buildBrowserE2ECreationPrompt(ctx: BrowserPromptContext): string {
  if (ctx.appType === 'static') {
    return buildStaticAppE2ECreationPrompt(ctx)
  }

  return buildWebAppE2ECreationPrompt(ctx)
}
