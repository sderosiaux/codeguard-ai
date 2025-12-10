import simpleGit from 'simple-git';

/**
 * Sanitize error messages for user display.
 * Removes internal paths, git config suggestions, and other technical details.
 */
export function sanitizeGitError(error: Error | unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error';

  // Check for specific error patterns and return user-friendly messages
  if (message.includes('dubious ownership')) {
    return 'Repository ownership conflict. Will re-clone.';
  }
  if (message.includes('Authentication failed') || message.includes('could not read Username')) {
    return 'Authentication failed. Please provide a valid access token.';
  }
  if (message.includes('not found') || message.includes('Repository not found')) {
    return 'Repository not found. Check the URL or provide an access token for private repos.';
  }
  if (message.includes('Permission denied')) {
    return 'Permission denied. Please provide an access token with repo access.';
  }

  // Generic sanitization: remove paths and git suggestions
  let sanitized = message
    // Remove absolute paths (Unix and Windows)
    .replace(/['"]?\/[\w\-\.\/]+['"]?/g, '[path]')
    .replace(/['"]?[A-Z]:\\[\w\-\.\\]+['"]?/g, '[path]')
    // Remove "To add an exception..." suggestions
    .replace(/To add an exception[^.]+\./gi, '')
    // Remove "call: git config..." suggestions
    .replace(/call:\s*git\s+config[^.]+\.?/gi, '')
    // Clean up extra whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // If sanitization removed everything meaningful, return generic message
  if (!sanitized || sanitized.length < 10) {
    return 'Failed to access repository. Please try again.';
  }

  return sanitized;
}

export async function cloneRepository(githubUrl: string, targetPath: string, accessToken?: string): Promise<void> {
  const git = simpleGit();

  // Inject token into URL for private repos: https://TOKEN@github.com/owner/repo
  let cloneUrl = githubUrl;
  if (accessToken) {
    cloneUrl = githubUrl.replace('https://github.com', `https://${accessToken}@github.com`);
  }

  try {
    // Shallow clone: only latest commit, single branch (most efficient)
    await git.clone(cloneUrl, targetPath, ['--depth', '1', '--single-branch']);
    console.log(`Successfully cloned ${githubUrl} to ${targetPath}`);
  } catch (error) {
    console.error(`Failed to clone ${githubUrl}:`, error);
    throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function pullRepository(repoPath: string): Promise<void> {
  const git = simpleGit(repoPath);

  try {
    // For shallow clones, fetch latest and reset to ensure fully up to date
    await git.fetch(['--depth', '1', 'origin']);
    await git.reset(['--hard', 'origin/HEAD']);
    console.log(`Successfully updated ${repoPath} to latest`);
  } catch (error) {
    console.error(`Failed to update ${repoPath}:`, error);
    throw new Error(`Failed to update repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function getDefaultBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);

  try {
    const branches = await git.branch();
    return branches.current;
  } catch (error) {
    console.error(`Failed to get default branch for ${repoPath}:`, error);
    return 'main'; // fallback
  }
}
