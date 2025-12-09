package scanner

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/codeguard-ai/cli/internal/api"
)

// Scanner scans directories for source files
type Scanner struct {
	root       string
	extensions []string
	ignore     []string
	maxFileSize int64
}

// DefaultExtensions are file extensions to scan
var DefaultExtensions = []string{
	".js", ".jsx", ".ts", ".tsx",
	".py",
	".go",
	".java",
	".rb",
	".php",
	".c", ".cpp", ".h", ".hpp",
	".cs",
	".rs",
	".swift",
	".kt", ".kts",
	".scala",
	".sol",
}

// DefaultIgnore are paths to ignore
var DefaultIgnore = []string{
	"node_modules",
	"vendor",
	".git",
	".svn",
	"dist",
	"build",
	"target",
	"__pycache__",
	".venv",
	"venv",
	".idea",
	".vscode",
	"coverage",
	".next",
	".nuxt",
}

// NewScanner creates a new scanner
func NewScanner(root string) *Scanner {
	return &Scanner{
		root:        root,
		extensions:  DefaultExtensions,
		ignore:      DefaultIgnore,
		maxFileSize: 100 * 1024, // 100KB max per file
	}
}

// ScanResult holds the scanning results
type ScanResult struct {
	Files       []api.FileContent
	TotalFiles  int
	SkippedFiles int
	Errors      []string
}

// Scan walks the directory and collects source files
func (s *Scanner) Scan() (*ScanResult, error) {
	result := &ScanResult{
		Files:  make([]api.FileContent, 0),
		Errors: make([]string, 0),
	}

	err := filepath.Walk(s.root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			result.Errors = append(result.Errors, err.Error())
			return nil
		}

		// Skip directories in ignore list
		if info.IsDir() {
			for _, ignore := range s.ignore {
				if info.Name() == ignore {
					return filepath.SkipDir
				}
			}
			return nil
		}

		// Check file extension
		ext := strings.ToLower(filepath.Ext(path))
		if !s.hasExtension(ext) {
			return nil
		}

		result.TotalFiles++

		// Skip large files
		if info.Size() > s.maxFileSize {
			result.SkippedFiles++
			return nil
		}

		// Read file content
		content, err := os.ReadFile(path)
		if err != nil {
			result.Errors = append(result.Errors, err.Error())
			return nil
		}

		// Get relative path
		relPath, err := filepath.Rel(s.root, path)
		if err != nil {
			relPath = path
		}

		result.Files = append(result.Files, api.FileContent{
			Path:    relPath,
			Content: string(content),
		})

		return nil
	})

	return result, err
}

func (s *Scanner) hasExtension(ext string) bool {
	for _, e := range s.extensions {
		if e == ext {
			return true
		}
	}
	return false
}

// SetExtensions sets custom extensions to scan
func (s *Scanner) SetExtensions(exts []string) {
	s.extensions = exts
}

// SetIgnore sets custom paths to ignore
func (s *Scanner) SetIgnore(paths []string) {
	s.ignore = paths
}

// SetMaxFileSize sets the maximum file size to scan
func (s *Scanner) SetMaxFileSize(size int64) {
	s.maxFileSize = size
}
