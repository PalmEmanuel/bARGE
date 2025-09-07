module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat',     // New feature for the user (triggers minor version bump)
      'fix',      // Bug fix for the user (triggers patch version bump)
      'docs',     // Documentation changes only
      'style',    // Code style changes (formatting, semicolons, etc.) - no code logic changes
      'refactor', // Code changes that neither fix bugs nor add features
      'test',     // Add or modify tests
      'chore',    // Maintenance tasks, build changes, dependency updates
      'perf',     // Performance improvements
      'ci',       // CI/CD pipeline changes
      'build',    // Build system changes (esbuild, npm scripts, etc.)
      'revert'    // Revert changes
    ]],
    'scope-enum': [2, 'always', [
      'auth',     // Authentication and Azure service integration
      'results',  // Query results panel and data display
      'panel',    // Webview panels and UI components
      'query',    // KQL file handling and query execution
      'config',   // Configuration and settings
      'build',    // Build system and bundling
      'test',     // Testing infrastructure
      'release',  // Release process
    ]],
    // 'scope-empty': [1, 'never'], // Warn if scope is missing (but allow it)
    'subject-case': [2, 'always', 'sentence-case'],
    'subject-min-length': [2, 'always', 10]
  }
};
