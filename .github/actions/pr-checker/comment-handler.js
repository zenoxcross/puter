const fetch = require('node-fetch');

class CommentHandler {
  constructor(options) {
    this.githubToken = options.githubToken;
    this.owner = options.owner;
    this.repo = options.repo;
    this.baseURL = 'https://api.github.com';
  }

  async postOrUpdateComment(prNumber, comment, updateExisting = true) {
    try {
      if (updateExisting) {
        const existingComment = await this.findExistingComment(prNumber);
        
        if (existingComment) {
          return await this.updateComment(existingComment.id, comment);
        }
      }
      
      return await this.createComment(prNumber, comment);
      
    } catch (error) {
      console.error('Error handling PR comment:', error);
      return false;
    }
  }

  async findExistingComment(prNumber) {
    const response = await fetch(
      `${this.baseURL}/repos/${this.owner}/${this.repo}/issues/${prNumber}/comments`,
      {
        headers: {
          'Authorization': `token ${this.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'PR-Issue-Checker'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.statusText}`);
    }

    const comments = await response.json();
    
    return comments.find(comment => 
      comment.user.type === 'Bot' && 
      comment.body.includes('PR Issue Correctness Analysis')
    );
  }

  async updateComment(commentId, comment) {
    const response = await fetch(
      `${this.baseURL}/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `token ${this.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'PR-Issue-Checker'
        },
        body: JSON.stringify({ body: comment })
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to update comment: ${response.statusText}`);
    }

    console.log('Updated existing PR comment');
    return true;
  }

  async createComment(prNumber, comment) {
    const response = await fetch(
      `${this.baseURL}/repos/${this.owner}/${this.repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${this.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'PR-Issue-Checker'
        },
        body: JSON.stringify({ body: comment })
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to create comment: ${response.statusText}`);
    }

    console.log('Posted new PR comment');
    return true;
  }
}

module.exports = CommentHandler;