#!/usr/bin/env node

const PRIssueChecker = require('./PRIssueChecker');
const CommentHandler = require('./CommentHandler');

// Parse inputs
const prNumber = process.env.PR_NUMBER;
const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
const shouldComment = process.env.COMMENT_ON_PR === 'true';
const updateExisting = process.env.UPDATE_EXISTING_COMMENT === 'true';

if (!prNumber || !owner || !repo) {
  console.error('::error::Missing required inputs');
  process.exit(1);
}

async function main() {
  const checker = new PRIssueChecker();
  
  // Run analysis
  const result = await checker.checkPRCorrectness(owner, repo, prNumber);
  const comment = checker.generateGitHubComment(result);
  
  // Set outputs
  console.log(`::set-output name=success::${result.success}`);
  console.log(`::set-output name=comment::${comment.replace(/\n/g, '\\n').replace(/"/g, '\\"')}`);
  console.log(`::set-output name=risk_level::${result.success ? result.analysis.risk_level : 'UNKNOWN'}`);
  
  // Handle PR commenting
  let commentPosted = false;
  if (shouldComment && result.success) {
    try {
      const commentHandler = new CommentHandler({
        githubToken: process.env.GITHUB_TOKEN,
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
    }
  }
  
  // GitHub annotations
  if (result.success && result.analysis.risk_level === 'HIGH') {
    console.log('::warning::High risk changes detected');
  }
  
  console.log('\n📝 Analysis Results:');
  console.log(comment);
}

main().catch(error => {
  console.error('::error::Analysis failed:', error.message);
  process.exit(1);
});