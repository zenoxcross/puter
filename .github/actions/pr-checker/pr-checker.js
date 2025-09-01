#!/usr/bin/env node

const fetch = require('node-fetch');
const CommentHandler = require('./comment-handler');

// Parse inputs from environment variables
const prNumber = process.env.PR_NUMBER;
const repository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const shouldComment = process.env.COMMENT_ON_PR === 'true';
const updateExisting = process.env.UPDATE_EXISTING_COMMENT !== 'false';

if (!prNumber || !repository || !githubToken) {
  console.error('::error::Missing required environment variables');
  console.error('Required: PR_NUMBER, GITHUB_REPOSITORY, GITHUB_TOKEN');
  process.exit(1);
}

const [owner, repo] = repository.split('/');
const baseURL = 'https://api.github.com';

class PRAnalyzer {
  constructor(options = {}) {
    this.githubToken = options.githubToken;
    this.anthropicApiKey = options.anthropicApiKey;
    this.owner = options.owner;
    this.repo = options.repo;
  }

  async analyzePR(prNumber) {
    try {
      console.log(`📊 Fetching PR data for #${prNumber}...`);
      
      // Step 1: Fetch PR details
      const prData = await this.fetchPRData(prNumber);
      console.log(`✅ PR Title: "${prData.title}"`);
      
      // Step 2: Extract linked issues
      const issueNumbers = this.extractIssueNumbers(prData);
      console.log(`🔗 Found ${issueNumbers.length} linked issues: ${issueNumbers.join(', ')}`);
      
      if (issueNumbers.length === 0) {
        return {
          success: false,
          error: 'No linked issues found in PR title or description. Please link issues using "fixes #123" or similar.',
          analysis: null
        };
      }

      // Step 3: Fetch linked issues
      const issues = await this.fetchIssues(issueNumbers);
      console.log(`✅ Fetched ${issues.length} issue details`);

      // Step 4: Fetch PR file changes
      const fileChanges = await this.fetchPRFiles(prNumber);
      console.log(`📁 Found ${fileChanges.length} changed files`);

      // Step 5: Analyze with Claude
      let analysis;
      if (this.anthropicApiKey) {
        console.log(`🤖 Analyzing with Claude AI...`);
        analysis = await this.analyzeWithClaude(prData, issues, fileChanges);
      } else {
        console.log(`📊 Using basic analysis (no Claude API key provided)`);
        analysis = this.performBasicAnalysis(prData, issues, fileChanges);
      }

      return {
        success: true,
        error: null,
        analysis: {
          ...analysis,
          linkedIssues: issueNumbers,
          prData: {
            title: prData.title,
            number: prData.number,
            user: prData.user.login,
            additions: prData.additions,
            deletions: prData.deletions,
            changedFiles: prData.changed_files
          }
        }
      };

    } catch (error) {
      console.error('❌ Analysis failed:', error.message);
      return {
        success: false,
        error: error.message,
        analysis: null
      };
    }
  }

  async fetchPRData(prNumber) {
    const response = await fetch(`${baseURL}/repos/${this.owner}/${this.repo}/pulls/${prNumber}`, {
      headers: {
        'Authorization': `token ${this.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PR-Issue-Checker'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PR data: ${response.statusText}`);
    }

    return await response.json();
  }

  extractIssueNumbers(prData) {
    const text = `${prData.title} ${prData.body || ''}`;
    
    // Patterns to match issue references
    const patterns = [
      /#(\d+)/g,                                               // #123
      /(?:fix(?:es)?|close(?:s)?|resolve(?:s)?)\s+#(\d+)/gi,  // fixes #123
      /(?:fix(?:es)?|close(?:s)?|resolve(?:s)?)\s+(\d+)/gi    // fixes 123
    ];
    
    const issueNumbers = new Set();
    
    patterns.forEach(pattern => {
      let match;
      pattern.lastIndex = 0; // Reset regex state
      while ((match = pattern.exec(text)) !== null) {
        issueNumbers.add(parseInt(match[1]));
      }
    });
    
    return Array.from(issueNumbers);
  }

  async fetchIssues(issueNumbers) {
    const issues = [];
    
    for (const issueNumber of issueNumbers) {
      try {
        const response = await fetch(`${baseURL}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
          headers: {
            'Authorization': `token ${this.githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'PR-Issue-Checker'
          }
        });

        if (response.ok) {
          const issue = await response.json();
          issues.push({
            number: issue.number,
            title: issue.title,
            body: issue.body || '',
            labels: issue.labels.map(l => l.name),
            state: issue.state,
            assignee: issue.assignee?.login || null
          });
        } else {
          console.warn(`⚠️  Issue #${issueNumber} not found or not accessible`);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to fetch issue #${issueNumber}:`, error.message);
      }
    }
    
    return issues;
  }

  async fetchPRFiles(prNumber) {
    const response = await fetch(`${baseURL}/repos/${this.owner}/${this.repo}/pulls/${prNumber}/files`, {
      headers: {
        'Authorization': `token ${this.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PR-Issue-Checker'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PR files: ${response.statusText}`);
    }

    const files = await response.json();
    
    // Return relevant file information
    return files.map(file => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ? file.patch.substring(0, 3000) : null // Limit patch size
    }));
  }

  async analyzeWithClaude(prData, issues, fileChanges) {
    const prompt = this.buildAnalysisPrompt(prData, issues, fileChanges);
    
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.anthropicApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 3000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Claude API error:', response.status, errorText);
        throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return this.parseClaudeResponse(result.content[0].text);
      
    } catch (error) {
      console.error('❌ Error analyzing with Claude, falling back to basic analysis:', error.message);
      return this.performBasicAnalysis(prData, issues, fileChanges);
    }
  }

  buildAnalysisPrompt(prData, issues, fileChanges) {
    const issuesText = issues.map(issue => 
      `### Issue #${issue.number}: ${issue.title}
**Description:** ${issue.body.substring(0, 1000)}${issue.body.length > 1000 ? '...' : ''}
**Labels:** ${issue.labels.join(', ') || 'None'}
**Status:** ${issue.state}`
    ).join('\n\n');

    const changesText = fileChanges.slice(0, 15).map(file => 
      `### File: ${file.filename} (${file.status})
**Changes:** +${file.additions} -${file.deletions}
${file.patch ? `**Code Changes:**\n\`\`\`diff\n${file.patch.substring(0, 1500)}\n\`\`\`` : '**No patch data available**'}`
    ).join('\n\n');

    return `Please analyze this pull request against its linked issues to determine if the implementation correctly addresses the requirements.

# PULL REQUEST DETAILS
**Title:** ${prData.title}
**Description:** ${prData.body ? prData.body.substring(0, 2000) : 'No description provided'}
**Author:** ${prData.user.login}
**Changes:** +${prData.additions} -${prData.deletions} lines across ${prData.changed_files} files

# LINKED ISSUES
${issuesText}

# CODE CHANGES
${changesText}

# ANALYSIS INSTRUCTIONS
Please provide a thorough analysis addressing:

1. **CORRECTNESS_SCORE** (0-10): How well does the PR implementation match the issue requirements?
2. **COMPLETENESS_SCORE** (0-10): Are all aspects of the linked issues addressed?
3. **RISK_LEVEL** (LOW/MEDIUM/HIGH): What is the risk level of these changes?
4. **MISSING_REQUIREMENTS**: What specific requirements from the issues appear to be unaddressed?
5. **IMPLEMENTATION_QUALITY**: Comments on code quality, approach, and best practices
6. **RECOMMENDATIONS**: Specific actionable suggestions for improvement

Please format your response as JSON with these exact keys:
{
  "correctness_score": <number>,
  "completeness_score": <number>, 
  "risk_level": "<LOW|MEDIUM|HIGH>",
  "missing_requirements": "<detailed list or 'None identified'>",
  "implementation_quality": "<assessment of code quality>",
  "recommendations": ["<recommendation 1>", "<recommendation 2>", "..."]
}`;
  }

  parseClaudeResponse(response) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          correctness_score: parsed.correctness_score || 'N/A',
          completeness_score: parsed.completeness_score || 'N/A',
          risk_level: parsed.risk_level || 'UNKNOWN',
          missing_requirements: parsed.missing_requirements || 'Unable to determine',
          implementation_quality: parsed.implementation_quality || 'Not assessed',
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [parsed.recommendations || 'No specific recommendations'],
          analysis_type: 'AI-Powered'
        };
      }
    } catch (error) {
      console.warn('⚠️  Failed to parse Claude JSON response, using text parsing');
    }

    // Fallback to text parsing
    return {
      correctness_score: this.extractScore(response, 'CORRECTNESS_SCORE'),
      completeness_score: this.extractScore(response, 'COMPLETENESS_SCORE'),
      risk_level: this.extractRiskLevel(response),
      missing_requirements: this.extractSection(response, 'MISSING_REQUIREMENTS'),
      implementation_quality: this.extractSection(response, 'IMPLEMENTATION_QUALITY'),
      recommendations: [this.extractSection(response, 'RECOMMENDATIONS') || 'See full analysis for details'],
      analysis_type: 'AI-Powered (Parsed)',
      raw_response: response.substring(0, 500) // First 500 chars for debugging
    };
  }

  performBasicAnalysis(prData, issues, fileChanges) {
    const totalChanges = fileChanges.reduce((sum, file) => sum + file.changes, 0);
    const fileCount = fileChanges.length;
    
    // Heuristic analysis
    const hasTests = fileChanges.some(file => 
      file.filename.includes('test') || 
      file.filename.includes('spec') ||
      file.filename.includes('__tests__') ||
      file.filename.includes('.test.') ||
      file.filename.includes('.spec.')
    );
    
    const hasDocumentation = fileChanges.some(file => 
      file.filename.includes('README') || 
      file.filename.includes('.md') ||
      file.filename.includes('docs/') ||
      file.filename.includes('documentation')
    );

    const riskFactors = [];
    if (totalChanges > 500) riskFactors.push('Large number of changes');
    if (fileCount > 20) riskFactors.push('Many files modified');
    if (!hasTests) riskFactors.push('No test files modified');
    
    const coreFiles = fileChanges.some(file => 
      file.filename.includes('config') ||
      file.filename.includes('package.json') ||
      file.filename.includes('requirements.txt') ||
      file.filename.includes('Dockerfile') ||
      file.filename.includes('.env')
    );
    if (coreFiles) riskFactors.push('Core configuration files modified');

    // Simple correctness heuristic based on issue keywords
    const issueText = issues.map(i => `${i.title} ${i.body}`).join(' ').toLowerCase();
    const prText = `${prData.title} ${prData.body || ''}`.toLowerCase();
    
    const keywordMatches = ['fix', 'add', 'update', 'implement', 'create', 'remove'].filter(keyword =>
      issueText.includes(keyword) && prText.includes(keyword)
    ).length;

    const correctnessScore = Math.min(10, Math.max(1, keywordMatches * 2 + (hasTests ? 2 : 0)));
    const completenessScore = Math.min(10, Math.max(1, 
      (issues.length <= 2 ? 8 : 6) + (hasDocumentation ? 1 : 0) + (hasTests ? 1 : 0)
    ));

    return {
      correctness_score: correctnessScore,
      completeness_score: completenessScore,
      risk_level: riskFactors.length > 2 ? 'HIGH' : riskFactors.length > 0 ? 'MEDIUM' : 'LOW',
      missing_requirements: riskFactors.length > 0 ? 'Potential concerns identified' : 'None identified with basic analysis',
      implementation_quality: `Basic analysis: ${fileCount} files changed, ${totalChanges} total changes. ${hasTests ? 'Tests included.' : 'No tests detected.'} ${hasDocumentation ? 'Documentation updated.' : ''}`,
      recommendations: [
        !hasTests && 'Consider adding or updating tests for the changes',
        !hasDocumentation && totalChanges > 100 && 'Consider updating documentation for significant changes',
        totalChanges > 300 && 'Consider breaking this into smaller PRs for easier review',
        riskFactors.length > 2 && 'High risk changes detected - consider additional review'
      ].filter(Boolean),
      analysis_type: 'Basic Heuristic',
      risk_factors: riskFactors
    };
  }

  // Helper methods for text parsing
  extractScore(text, scoreType) {
    const match = text.match(new RegExp(`${scoreType}[:\\s]*([0-9]+)`, 'i'));
    return match ? parseInt(match[1]) : null;
  }

  extractSection(text, section) {
    const match = text.match(new RegExp(`${section}[:\\s]*([^\\n]*(?:\\n(?!\\w+:)[^\\n]*)*)`, 'i'));
    return match ? match[1].trim() : null;
  }

  extractRiskLevel(text) {
    const match = text.match(/RISK_LEVEL[:\\s]*(LOW|MEDIUM|HIGH)/i);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
  }
}

async function main() {
  console.log(`🔍 Starting Claude-powered analysis for PR #${prNumber} in ${owner}/${repo}`);
  
  try {
    const analyzer = new PRAnalyzer({
      githubToken,
      anthropicApiKey,
      owner,
      repo
    });

    // Perform the analysis
    const result = await analyzer.analyzePR(prNumber);
    
    if (!result.success) {
      console.error(`❌ Analysis failed: ${result.error}`);
      
      // Set failure outputs
      console.log(`::set-output name=success::false`);
      console.log(`::set-output name=comment::## ❌ PR Analysis Failed\\n\\n**Error:** ${result.error}`);
      console.log(`::set-output name=risk_level::UNKNOWN`);
      console.log(`::set-output name=comment_posted::false`);
      
      return;
    }

    console.log(`✅ Analysis completed successfully!`);
    console.log(`📊 Correctness: ${result.analysis.correctness_score}/10`);
    console.log(`📋 Completeness: ${result.analysis.completeness_score}/10`);
    console.log(`⚠️  Risk Level: ${result.analysis.risk_level}`);
    
    // Generate comment
    const comment = generateComment(result, prNumber);
    
    // Set GitHub Actions outputs
    console.log(`::set-output name=success::${result.success}`);
    console.log(`::set-output name=comment::${comment.replace(/\n/g, '\\n').replace(/"/g, '\\"')}`);
    console.log(`::set-output name=risk_level::${result.analysis.risk_level}`);

    // Handle PR commenting
    let commentPosted = false;
    if (shouldComment) {
      try {
        const commentHandler = new CommentHandler({
          githubToken,
          owner,
          repo
        });
        
        commentPosted = await commentHandler.postOrUpdateComment(
          prNumber, 
          comment, 
          updateExisting
        );
        
        console.log(`::set-output name=comment_posted::${commentPosted}`);
        
      } catch (error) {
        console.error('::warning::Failed to post comment:', error.message);
        console.log(`::set-output name=comment_posted::false`);
      }
    } else {
      console.log('💬 Comment posting disabled');
      console.log(`::set-output name=comment_posted::false`);
    }

    // GitHub annotations
    if (result.analysis.risk_level === 'HIGH') {
      console.log('::warning::High risk changes detected in this PR');
    }
    if (result.analysis.correctness_score < 6) {
      console.log(`::warning::Low correctness score: ${result.analysis.correctness_score}/10`);
    }

    console.log('\n📝 Generated Comment Preview:');
    console.log('='.repeat(50));
    console.log(comment);
    console.log('='.repeat(50));
    console.log('\n🎉 Analysis complete!');

  } catch (error) {
    console.error('::error::Script execution failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

function generateComment(result, prNumber) {
  if (!result.success) {
    return `## ❌ PR Analysis Failed

**Error:** ${result.error}

Please check the workflow logs for more details or contact the repository maintainers.`;
  }

  const { analysis } = result;
  let comment = `## 📊 PR Issue Correctness Analysis\n\n`;
  comment += `🔗 **PR:** #${prNumber} by @${analysis.prData.user}\n`;
  comment += `📋 **Linked Issues:** ${analysis.linkedIssues.map(n => `#${n}`).join(', ')}\n`;
  comment += `📅 **Analysis Time:** ${new Date().toLocaleString()}\n`;
  comment += `🤖 **Analysis Type:** ${analysis.analysis_type}\n\n`;

  comment += `### 🎯 Analysis Results\n`;
  comment += `- ✅ **Correctness Score:** ${analysis.correctness_score}/10\n`;
  comment += `- 📋 **Completeness Score:** ${analysis.completeness_score}/10\n`;
  comment += `- ⚠️ **Risk Level:** ${analysis.risk_level}\n`;
  comment += `- 📁 **Files Changed:** ${analysis.prData.changedFiles}\n`;
  comment += `- 📈 **Lines:** +${analysis.prData.additions} -${analysis.prData.deletions}\n\n`;

  if (analysis.missing_requirements && analysis.missing_requirements !== 'None identified') {
    comment += `### ❌ Missing Requirements\n${analysis.missing_requirements}\n\n`;
  }

  if (analysis.implementation_quality) {
    comment += `### 🔍 Implementation Quality\n${analysis.implementation_quality}\n\n`;
  }

  if (analysis.recommendations && analysis.recommendations.length > 0) {
    comment += `### 💡 Recommendations\n`;
    analysis.recommendations.forEach(rec => {
      if (rec && rec.trim()) {
        comment += `- ${rec}\n`;
      }
    });
    comment += `\n`;
  }

  // Add risk level warning
  if (analysis.risk_level === 'HIGH') {
    comment += `### 🚨 High Risk Notice\nThis PR has been flagged as high risk. Please ensure thorough review and testing before merging.\n\n`;
  }

  comment += `---\n*🤖 Analysis performed by Claude-powered PR Issue Correctness Checker*`;
  
  return comment;
}

// Run the main function
main();