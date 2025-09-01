#!/usr/bin/env node

const CommentHandler = require('./comment-handler');

// Parse inputs from environment variables
const prNumber = process.env.PR_NUMBER;
const repository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;
const shouldComment = process.env.COMMENT_ON_PR === 'true';
const updateExisting = process.env.UPDATE_EXISTING_COMMENT !== 'false';

if (!prNumber || !repository || !githubToken) {
  console.error('::error::Missing required environment variables');
  console.error('Required: PR_NUMBER, GITHUB_REPOSITORY, GITHUB_TOKEN');
  process.exit(1);
}

const [owner, repo] = repository.split('/');

async function main() {
  console.log(`🔍 Starting analysis for PR #${prNumber} in ${owner}/${repo}`);
  
  try {
    // Mock analysis for now - replace with your actual logic
    const mockAnalysisResult = {
      success: true,
      analysis: {
        risk_level: 'LOW',
        correctness_score: 8,
        completeness_score: 7,
        recommendations: [
          'Consider adding unit tests',
          'Update documentation if needed'
        ]
      }
    };

    // Generate comment
    const comment = generateComment(mockAnalysisResult, prNumber);
    
    // Set GitHub Actions outputs
    console.log(`::set-output name=success::${mockAnalysisResult.success}`);
    console.log(`::set-output name=comment::${comment.replace(/\n/g, '\\n').replace(/"/g, '\\"')}`);
    console.log(`::set-output name=risk_level::${mockAnalysisResult.analysis.risk_level}`);

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
      console.log('Comment posting disabled');
      console.log(`::set-output name=comment_posted::false`);
    }

    // GitHub annotations
    if (mockAnalysisResult.analysis.risk_level === 'HIGH') {
      console.log('::warning::High risk changes detected in this PR');
    }

    console.log('\n📝 Generated Comment Preview:');
    console.log(comment);
    console.log('\n✅ Analysis complete!');

  } catch (error) {
    console.error('::error::Script execution failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

function generateComment(result, prNumber) {
  if (!result.success) {
    return `## ❌ PR Analysis Failed
    
**Error:** Analysis could not be completed for PR #${prNumber}

Please check the workflow logs for details.`;
  }

  const { analysis } = result;
  let comment = `## 📊 PR Issue Correctness Analysis\n\n`;
  comment += `🔗 **PR:** #${prNumber}\n`;
  comment += `📅 **Analysis Time:** ${new Date().toLocaleString()}\n\n`;

  comment += `### 🎯 Analysis Results\n`;
  comment += `- ✅ **Correctness Score:** ${analysis.correctness_score}/10\n`;
  comment += `- 📋 **Completeness Score:** ${analysis.completeness_score}/10\n`;
  comment += `- ⚠️ **Risk Level:** ${analysis.risk_level}\n\n`;

  if (analysis.recommendations && analysis.recommendations.length > 0) {
    comment += `### 💡 Recommendations\n`;
    analysis.recommendations.forEach(rec => {
      comment += `- ${rec}\n`;
    });
    comment += `\n`;
  }

  comment += `---\n*🤖 Analysis performed by PR Issue Correctness Checker*`;
  
  return comment;
}

// Run the main function
main();