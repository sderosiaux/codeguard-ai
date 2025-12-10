# Sharing Repository Results

Share your security analysis results with anyone using public share links.

## Creating a Share Link

1. Navigate to any repository in your dashboard
2. Click the **Share** button in the header
3. Choose an expiration time (optional):
   - **Never** - Link never expires
   - **1 day** - Expires in 24 hours
   - **7 days** - Expires in one week
   - **30 days** - Expires in one month
4. Click **Create Link**
5. Copy the generated URL

## What's Included

The public share page shows:

- Repository name and security grade
- Issue counts by severity (Critical, High, Medium, Low)
- Full file tree with issue indicators
- Code viewer with syntax highlighting
- Detailed issue information including:
  - Description
  - Affected line numbers
  - Remediation suggestions

## Managing Share Links

View and manage all share links for a repository:

1. Click the **Share** button on any repository
2. See all active share links with their:
   - Creation date
   - Expiration date (if set)
   - Link URL
3. Click the trash icon to revoke any share link

!!! warning "Revoking Links"
    Revoking a share link immediately invalidates it. Anyone with the old URL will no longer be able to access the results.

## Security Considerations

- Share links are read-only - viewers cannot modify anything
- Links use secure random tokens (32 hex characters)
- No authentication required to view shared results
- Consider using expiring links for sensitive codebases
- You can revoke links at any time

## Use Cases

### Code Reviews
Share security findings with team members or external reviewers without requiring them to sign up.

### Client Reports
Provide clients with a direct link to view their project's security status.

### Open Source Projects
Share public security reports with your community.

### Bug Bounty Programs
Share specific vulnerability findings with researchers.
