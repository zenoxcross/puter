const fetch = require('node-fetch');

/**
 * Pure PR Issue Checker class - no execution logic
 */
class PRIssueChecker {
  constructor(options = {}) {
    this.githubToken = options.githubToken || process.env.GITHUB_TOKEN;
    this.baseURL = options.baseURL || 'https://api.github.com';
    this.anthropicApiKey = options.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  }

  // ... all your existing methods here ...
  // checkPRCorrectness, fetchPRData, analyzeWithClaude, etc.
  // NO execution logic, NO main(), just pure class methods
}

module.exports = PRIssueChecker;