import { useEffect, useRef, useCallback, useState } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useFileContent } from '../hooks/useApi';
import type { Issue } from '../lib/api';
import IssueHoverCard from './IssueHoverCard';

interface CodeEditorProps {
  repoId: string;
  filePath: string;
  issues: Issue[];
  onSelectIssue: (issue: Issue) => void;
  selectedIssue?: Issue | null;
  highlightLines?: { start: number; end: number } | null;
  owner?: string;
  name?: string;
}

export default function CodeEditor({
  repoId,
  filePath,
  issues,
  onSelectIssue,
  selectedIssue,
  highlightLines,
  owner,
  name,
}: CodeEditorProps) {
  const { data: content, isLoading } = useFileContent(repoId, filePath);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveringCardRef = useRef<boolean>(false);
  const hoveredIssueIdRef = useRef<string | number | null>(null);
  const issuesRef = useRef<Issue[]>(issues);

  // Keep issues ref in sync
  useEffect(() => {
    issuesRef.current = issues;
  }, [issues]);

  // State for custom hover card
  const [hoveredIssue, setHoveredIssue] = useState<Issue | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Clear any pending hover timeout
  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const getLanguage = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      go: 'go',
      rs: 'rust',
      rb: 'ruby',
      php: 'php',
      html: 'html',
      css: 'css',
      json: 'json',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      sh: 'shell',
      sql: 'sql',
    };
    return languageMap[ext || ''] || 'plaintext';
  };

  // Apply decorations to the editor
  const applyDecorations = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) {
      return;
    }

    // Clear existing decorations if no issues
    if (!issues || issues.length === 0) {
      if (decorationsRef.current.length > 0) {
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      }
      return;
    }

    // Create decorations for each issue
    const newDecorations: editor.IModelDeltaDecoration[] = issues.map((issue) => {
      const startLine = issue.lineStart || 1;
      const endLine = issue.lineEnd || startLine;

      // Determine decoration class based on severity
      const severityClass = `issue-line-${issue.severity}`;
      const glyphClass = `issue-glyph-${issue.severity}`;

      // Get severity colors
      const severityColors: Record<string, string> = {
        critical: '#ef4444',
        high: '#f97316',
        medium: '#eab308',
        low: '#22c55e',
      };
      const color = severityColors[issue.severity] || severityColors.medium;

      return {
        range: new monaco.Range(startLine, 1, endLine, 1),
        options: {
          isWholeLine: true,
          className: severityClass,
          glyphMarginClassName: glyphClass,
          glyphMarginHoverMessage: { value: '' }, // Disable default hover
          overviewRuler: {
            color,
            position: monaco.editor.OverviewRulerLane.Right,
          },
          minimap: {
            color,
            position: monaco.editor.MinimapPosition.Inline,
          },
        },
      };
    });

    // Apply new decorations
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }, [issues]);

  // Apply decorations when editor content is ready or issues change
  useEffect(() => {
    // Wait for both editor and content to be ready
    if (!editorRef.current || !monacoRef.current || !content) {
      return;
    }

    // Small delay to ensure editor has rendered the content
    const timeoutId = setTimeout(() => {
      applyDecorations();
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [applyDecorations, content]);

  // Scroll to selected issue
  useEffect(() => {
    if (!editorRef.current || !selectedIssue || !selectedIssue.lineStart) return;

    editorRef.current.revealLineInCenter(selectedIssue.lineStart);
  }, [selectedIssue]);

  // Scroll to highlighted lines from URL (takes priority over first issue)
  useEffect(() => {
    if (!editorRef.current || !content || !highlightLines) return;

    // Small delay to ensure editor has rendered
    setTimeout(() => {
      editorRef.current?.revealLineInCenter(highlightLines.start);
    }, 200);
  }, [content, highlightLines, filePath]);

  // Scroll to first issue when file is opened (only if no highlightLines)
  useEffect(() => {
    if (!editorRef.current || !content || issues.length === 0 || highlightLines) return;

    // Find the first issue by line number
    const firstIssue = issues.reduce((first, issue) => {
      const firstLine = first.lineStart || Infinity;
      const currentLine = issue.lineStart || Infinity;
      return currentLine < firstLine ? issue : first;
    }, issues[0]);

    if (firstIssue?.lineStart) {
      // Small delay to ensure editor has rendered
      setTimeout(() => {
        editorRef.current?.revealLineInCenter(firstIssue.lineStart!);
      }, 200);
    }
  }, [content, issues, filePath, highlightLines]);

  // Find issue at a specific line (uses ref to always have latest issues)
  const findIssueAtLine = useCallback((lineNumber: number): Issue | undefined => {
    return issuesRef.current.find((i) => {
      const start = i.lineStart || 1;
      const end = i.lineEnd || start;
      return lineNumber >= start && lineNumber <= end;
    });
  }, []);

  const handleEditorDidMount = useCallback((
    editor: editor.IStandaloneCodeEditor,
    monaco: Monaco
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Configure editor
    editor.updateOptions({
      readOnly: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      glyphMargin: true,
      lineDecorationsWidth: 5,
    });

    // Add click listener for glyph margin and decorated lines
    editor.onMouseDown((e) => {
      if (e.target.position) {
        const line = e.target.position.lineNumber;
        // Check if click was on glyph margin or decorated line
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
            e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) {
          const issue = findIssueAtLine(line);
          if (issue) {
            hoveredIssueIdRef.current = null;
            setHoveredIssue(null); // Hide hover card
            onSelectIssue(issue);
          }
        }
      }
    });

    // Add mouse move listener for custom hover card
    editor.onMouseMove((e) => {
      // Don't process if hovering the card itself
      if (isHoveringCardRef.current) return;

      clearHoverTimeout();

      if (e.target.position) {
        const line = e.target.position.lineNumber;
        const issue = findIssueAtLine(line);

        if (issue) {
          // Only update position if it's a different issue
          // This prevents the popup from jumping when moving within multi-line issues
          if (hoveredIssueIdRef.current !== issue.id) {
            hoveredIssueIdRef.current = issue.id;
            setHoverPosition({
              x: e.event.posx,
              y: e.event.posy,
            });
            setHoveredIssue(issue);
          }
        } else {
          // Hide if not on an issue line (with delay to allow moving to card)
          hoverTimeoutRef.current = setTimeout(() => {
            if (!isHoveringCardRef.current) {
              hoveredIssueIdRef.current = null;
              setHoveredIssue(null);
            }
          }, 150);
        }
      }
    });

    // Hide hover on mouse leave (but check if moving to card)
    editor.onMouseLeave(() => {
      clearHoverTimeout();
      hoverTimeoutRef.current = setTimeout(() => {
        if (!isHoveringCardRef.current) {
          hoveredIssueIdRef.current = null;
          setHoveredIssue(null);
        }
      }, 300);
    });

    // Apply decorations after editor is fully mounted
    requestAnimationFrame(() => {
      setTimeout(() => applyDecorations(), 50);
    });
  }, [onSelectIssue, applyDecorations, findIssueAtLine, clearHoverTimeout]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <div className="text-gray-500">Loading file...</div>
      </div>
    );
  }

  const issueCountBySeverity = issues.reduce(
    (acc, issue) => {
      acc[issue.severity] = (acc[issue.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-white flex flex-col">
      <div className="border-b border-gray-200 px-4 py-2 bg-gray-50 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 font-mono">{filePath}</span>
        {issues.length > 0 && (
          <div className="flex items-center gap-2">
            {issueCountBySeverity.critical && (
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {issueCountBySeverity.critical}
              </span>
            )}
            {issueCountBySeverity.high && (
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                {issueCountBySeverity.high}
              </span>
            )}
            {issueCountBySeverity.medium && (
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                {issueCountBySeverity.medium}
              </span>
            )}
            {issueCountBySeverity.low && (
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {issueCountBySeverity.low}
              </span>
            )}
            <span className="text-xs text-gray-500 ml-1">
              {issues.length} issue{issues.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <Editor
          key={filePath} // Force remount when file changes
          height="100%"
          language={getLanguage(filePath)}
          value={content || ''}
          onMount={handleEditorDidMount}
          theme="vs-light"
          options={{
            readOnly: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            glyphMargin: true,
            folding: true,
            lineDecorationsWidth: 5,
            lineNumbersMinChars: 4,
            renderLineHighlight: 'all',
            smoothScrolling: true,
          }}
        />

        {/* Custom visual hover card */}
        {hoveredIssue && (
          <IssueHoverCard
            issue={hoveredIssue}
            position={hoverPosition}
            onMouseEnter={() => {
              isHoveringCardRef.current = true;
              clearHoverTimeout();
            }}
            onClose={() => {
              isHoveringCardRef.current = false;
              hoveredIssueIdRef.current = null;
              setHoveredIssue(null);
            }}
            onClick={() => {
              isHoveringCardRef.current = false;
              hoveredIssueIdRef.current = null;
              onSelectIssue(hoveredIssue);
              setHoveredIssue(null);
            }}
            shareUrl={hoveredIssue.lineStart && owner && name ? (() => {
              const lineParam = hoveredIssue.lineEnd && hoveredIssue.lineEnd !== hoveredIssue.lineStart
                ? `${hoveredIssue.lineStart}-${hoveredIssue.lineEnd}`
                : `${hoveredIssue.lineStart}`;
              return `${window.location.origin}/app/repos/${owner}/${name}/code/${encodeURIComponent(filePath)}?L=${lineParam}`;
            })() : undefined}
          />
        )}
      </div>
    </div>
  );
}
