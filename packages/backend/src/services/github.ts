import simpleGit from 'simple-git';
import { promises as fs } from 'fs';
import path from 'path';

// Binary file extensions to clean up after cloning (we only analyze code)
const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.tiff', '.psd',
  // Media
  '.mp4', '.mp3', '.wav', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4a', '.ogg',
  // Binaries & executables
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.lib', '.wasm', '.pyc', '.pyo', '.class',
  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz', '.jar', '.war', '.ear',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
  // Data files
  '.sqlite', '.db', '.mdb', '.parquet', '.pickle', '.pkl',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Other large files
  '.iso', '.dmg', '.img', '.vmdk', '.onnx', '.pt', '.pth', '.h5', '.hdf5',
  // Lock files and generated (often large)
  '.lock', '.map',
]);

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

/**
 * Recursively clean up binary/non-code files from a directory.
 * This saves disk space and speeds up analysis.
 */
async function cleanupBinaryFiles(dirPath: string): Promise<{ deleted: number; savedBytes: number }> {
  let deleted = 0;
  let savedBytes = 0;

  async function walkDir(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // Skip .git directory
        if (entry.name === '.git') continue;
        // Skip node_modules, vendor, etc. (often huge and not analyzed)
        if (['node_modules', 'vendor', '.vendor', 'bower_components', '__pycache__', '.venv', 'venv'].includes(entry.name)) {
          try {
            const stats = await fs.stat(fullPath);
            await fs.rm(fullPath, { recursive: true, force: true });
            deleted++;
            // Can't easily get dir size, estimate based on typical sizes
            console.log(`Deleted directory: ${entry.name}`);
          } catch {
            // Ignore errors
          }
          continue;
        }
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          try {
            const stats = await fs.stat(fullPath);
            savedBytes += stats.size;
            await fs.unlink(fullPath);
            deleted++;
          } catch {
            // Ignore errors
          }
        }
      }
    }
  }

  try {
    await walkDir(dirPath);
    if (deleted > 0) {
      console.log(`Cleanup: removed ${deleted} binary files/dirs, saved ${(savedBytes / 1024 / 1024).toFixed(2)} MB`);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }

  return { deleted, savedBytes };
}

export async function cloneRepository(githubUrl: string, targetPath: string, accessToken?: string): Promise<void> {
  const git = simpleGit();

  // Inject token into URL for private repos: https://TOKEN@github.com/owner/repo
  let cloneUrl = githubUrl;
  if (accessToken) {
    cloneUrl = githubUrl.replace('https://github.com', `https://${accessToken}@github.com`);
  }

  try {
    // Partial clone: skip blobs >300KB, shallow (depth 1), single branch
    // This significantly reduces clone size for repos with large binaries
    await git.clone(cloneUrl, targetPath, [
      '--filter=blob:limit=300k',
      '--depth', '1',
      '--single-branch',
    ]);
    console.log(`Successfully cloned ${githubUrl} to ${targetPath}`);

    // Clean up any binary files that were still downloaded
    await cleanupBinaryFiles(targetPath);
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
