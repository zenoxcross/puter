# PR Issue Checker Action

Analyzes pull requests against their linked issues to ensure correctness and completeness.

## Usage

```yaml
- name: Check PR correctness
  uses: ./.github/actions/pr-checker
  with:
    pr_number: ${{ github.event.pull_request.number }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}